// console-electron/src/main/ipc/ai.ts
//
// Multi-provider AI: the `console:ai.*` handlers. Streaming clones the
// runner.ts pattern: chat.start returns a chatId synchronously, then the
// main process pushes deltas over console:ai.chat.delta / .done / .error and
// the renderer subscribes via the preload onDelta/onDone/onError wrappers.
// Nothing throws across IPC; every handler is total.
//
// Keys ride the safeStorage keystore. setKey validates the candidate with a
// tiny probe BEFORE encrypting + storing, so a bad key never lands on disk.
// Raw keys never return to the renderer and are never logged.
import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';

import { getProvider, listProviders, listAllModels, listAvailableModels, type ProviderInfo } from '../ai/registry';
import { setKey, clearKey, keyStatus, KEYED_PROVIDERS } from '../ai/keystore';
import { validateKey } from '../ai/validate';
import { loadAi } from '../ai/sdkLoader';
import { buildProjectTools, buildProjectContext } from '../ai/tools';
import type { PermissionGate, PermissionDecision } from '../ai/tools';
import { appendUsageEvent, readUsageEvents } from '../ai-usage';
import { attributeSpend, type SpendReport } from '../spend-attribution';
import type { ChatMessage, ModelOption, ProviderId } from '../ai/ModelProvider';

// One AbortController per live chat, exactly like runner.ts's `running` map.
const chats = new Map<string, AbortController>();

// Pending write approvals: a write tool's execute() blocks on a promise stored
// here, keyed by requestId; the renderer resolves it via respondPermission. A
// chat in sessionAllowWrites auto-allows further writes for that turn-session.
const pendingWrites = new Map<string, { chatId: string; resolve: (d: PermissionDecision) => void }>();
const sessionAllowWrites = new Set<string>();
// ask_user questions block in the tool's execute() on a promise stored here,
// keyed by requestId; the renderer resolves it via respondQuestion with the
// user's answer (or '' on dismiss / cancel).
const pendingQuestions = new Map<string, { chatId: string; resolve: (answer: string) => void }>();

function denyPendingForChat(chatId: string): void {
    for (const [id, p] of pendingWrites) {
        if (p.chatId === chatId) { p.resolve('deny'); pendingWrites.delete(id); }
    }
    // Resolve any hung question with '' (dismiss) so a cancel/done never leaves
    // the assistant's ask_user awaiting a promise that can no longer be answered.
    for (const [id, p] of pendingQuestions) {
        if (p.chatId === chatId) { p.resolve(''); pendingQuestions.delete(id); }
    }
    sessionAllowWrites.delete(chatId);
}

// UUID, not Date.now()+short-random: two chats started in the same millisecond
// (e.g. from two windows) could otherwise collide and cross their streams.
function newChatId(): string {
    return `chat-${randomUUID()}`;
}

function send(win: BrowserWindow | null, channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function isKeyedProvider(id: unknown): id is ProviderId {
    return typeof id === 'string' && (KEYED_PROVIDERS as string[]).includes(id);
}

// Resolve a model id to its provider. Model ids are unique across our static
// catalogue + live Ollama tags, so the first match wins.
async function providerForModel(model: string): Promise<ProviderId | null> {
    const all = await listAllModels();
    const hit = all.find((m) => m.id === model);
    return hit ? hit.provider : null;
}

interface ChatStartOpts {
    model: string;
    messages: ChatMessage[];
    system?: string;
    /** When set, the assistant gets read-only tools + context for this project. */
    projectRoot?: string;
    /** Read-only plan mode: write/run tools are auto-denied; reads + ask_user stay live. */
    planMode?: boolean;
}

export function registerAiHandlers(): void {
    ipcMain.handle('console:ai.providers', async (): Promise<ProviderInfo[]> => {
        try {
            return await listProviders();
        } catch {
            return [];
        }
    });

    ipcMain.handle('console:ai.listModels', async (): Promise<ModelOption[]> => {
        try {
            return await listAllModels();
        } catch {
            return [];
        }
    });

    // The models usable with the currently-stored keys (the picker uses this,
    // not the full catalogue, so it never offers a model that fails on send).
    ipcMain.handle('console:ai.availableModels', async (): Promise<ModelOption[]> => {
        try {
            return await listAvailableModels();
        } catch {
            return [];
        }
    });

    ipcMain.handle('console:ai.getKeyStatus', async (): Promise<Record<string, boolean>> => {
        try {
            return keyStatus();
        } catch {
            return {};
        }
    });

    // Validate first, store only on success. Returns booleans + an error
    // string; never the key itself.
    ipcMain.handle(
        'console:ai.setKey',
        async (_e, id: string, key: string): Promise<{ ok: boolean; valid?: boolean; error?: string }> => {
            if (!isKeyedProvider(id)) return { ok: false, error: 'Unknown provider.' };
            if (typeof key !== 'string' || key.trim().length === 0) {
                return { ok: false, error: 'A key is required.' };
            }
            const trimmed = key.trim();
            try {
                const probe = await validateKey(id, trimmed);
                if (!probe.valid) return { ok: false, valid: false, error: probe.error };
                const stored = setKey(id, trimmed);
                if (!stored) {
                    return { ok: false, valid: true, error: 'Secure storage is unavailable on this system, so the key was not saved.' };
                }
                return { ok: true, valid: true };
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    ipcMain.handle('console:ai.clearKey', async (_e, id: string): Promise<{ ok: boolean }> => {
        if (!isKeyedProvider(id)) return { ok: false };
        try {
            clearKey(id);
            return { ok: true };
        } catch {
            return { ok: false };
        }
    });

    // Returns a chatId immediately, then streams. A bad request still returns
    // a (empty) chatId shape rather than throwing.
    ipcMain.handle('console:ai.chat.start', (e, opts: ChatStartOpts): { chatId: string } => {
        try {
            const win = BrowserWindow.fromWebContents(e.sender);
            if (!opts || typeof opts.model !== 'string' || !Array.isArray(opts.messages)) {
                return { chatId: '' };
            }
            const chatId = newChatId();
            const controller = new AbortController();
            chats.set(chatId, controller);

            // Kick off streaming after returning the id. We do not await it.
            void (async () => {
                try {
                    const providerId = await providerForModel(opts.model);
                    const provider = providerId ? getProvider(providerId) : null;
                    if (!provider) {
                        send(win, 'console:ai.chat.error', { chatId, error: `Unknown model: ${opts.model}` });
                        send(win, 'console:ai.chat.done', { chatId });
                        chats.delete(chatId);
                        return;
                    }

                    // With a project open, give the assistant read-only tools +
                    // a context block so it can ground answers in the real code.
                    let tools: Record<string, unknown> | undefined;
                    let system = typeof opts.system === 'string' ? opts.system : undefined;
                    if (typeof opts.projectRoot === 'string' && opts.projectRoot.length > 0) {
                        try {
                            const ai = await loadAi();
                            const gate: PermissionGate = {
                                request: (req) => {
                                    // allow-session only fast-tracks WRITES; a command run
                                    // always prompts, so a file-write consent can never
                                    // silently authorize run_command (CWE-863).
                                    if (req.kind === 'write' && sessionAllowWrites.has(chatId)) return Promise.resolve('allow' as PermissionDecision);
                                    const requestId = newChatId();
                                    send(win, 'console:ai.chat.permissionRequest', { requestId, ...req });
                                    return new Promise<PermissionDecision>((resolve) => {
                                        pendingWrites.set(requestId, { chatId, resolve });
                                    });
                                },
                                // A clarifying question always reaches the user: not
                                // short-circuited by allow-session, not blocked by plan mode.
                                ask: (req) => {
                                    // Only one question shows at a time. A second ask
                                    // auto-dismisses the first (the renderer already
                                    // shows only the latest) so no promise is stranded.
                                    for (const [id, p] of pendingQuestions) {
                                        if (p.chatId === chatId) { p.resolve(''); pendingQuestions.delete(id); }
                                    }
                                    const requestId = newChatId();
                                    send(win, 'console:ai.chat.questionRequest', { requestId, chatId, question: req.question, placeholder: req.placeholder, options: req.options });
                                    return new Promise<string>((resolve) => {
                                        pendingQuestions.set(requestId, { chatId, resolve });
                                    });
                                },
                            };
                            tools = buildProjectTools(ai, opts.projectRoot, {
                                gate,
                                chatId,
                                onFocusPanel: (panel) => send(win, 'console:ai.focusPanel', panel),
                                planMode: opts.planMode === true,
                            });
                            const ctx = buildProjectContext(opts.projectRoot);
                            const planNote = opts.planMode === true
                                ? '\n\nPlan mode is ON: you are read-only. Investigate with the read tools and PROPOSE a plan or answer; do not attempt to write files or run commands (they will be blocked). You may still use ask_user to clarify.'
                                : '';
                            system = (system ? `${ctx}\n\n${system}` : ctx) + planNote;
                        } catch { /* fall back to plain chat */ }
                    }

                    await provider.stream({
                        model: opts.model,
                        messages: opts.messages,
                        system,
                        tools,
                        signal: controller.signal,
                        onTextDelta: (delta) => send(win, 'console:ai.chat.delta', { chatId, delta }),
                        onToolCall: (ev) => send(win, 'console:ai.chat.toolCall', { chatId, ...ev }),
                        onToolResult: (ev) => send(win, 'console:ai.chat.toolResult', { chatId, ...ev }),
                        onUsage: (usage) => {
                            send(win, 'console:ai.chat.usage', { chatId, ...usage });
                            // Persist a per-turn usage event (counts + model only, no
                            // content) so spend can be sliced per model over time.
                            appendUsageEvent({
                                provider: providerId ?? 'unknown',
                                model: opts.model,
                                inputTokens: usage.inputTokens ?? 0,
                                outputTokens: usage.outputTokens ?? 0,
                                sessionId: chatId,
                                at: new Date().toISOString(),
                            });
                        },
                        onDone: () => {
                            send(win, 'console:ai.chat.done', { chatId });
                            chats.delete(chatId);
                            denyPendingForChat(chatId);
                        },
                        onError: (message) => {
                            // An in-loop stream error can arrive before onDone; drain any
                            // pending write/question for this chat now so a tool awaiting
                            // approval or an answer is never stranded.
                            denyPendingForChat(chatId);
                            send(win, 'console:ai.chat.error', { chatId, error: message });
                        },
                    });
                } catch (err) {
                    send(win, 'console:ai.chat.error', { chatId, error: err instanceof Error ? err.message : String(err) });
                    send(win, 'console:ai.chat.done', { chatId });
                    chats.delete(chatId);
                    denyPendingForChat(chatId);
                }
            })();

            return { chatId };
        } catch {
            return { chatId: '' };
        }
    });

    ipcMain.handle('console:ai.chat.cancel', (_e, chatId: string): void => {
        try {
            if (typeof chatId !== 'string') return;
            const controller = chats.get(chatId);
            if (controller) {
                controller.abort();
                chats.delete(chatId);
            }
            denyPendingForChat(chatId);
        } catch {
            /* never throw across IPC */
        }
    });

    // The renderer's answer to a write-approval card. A missing requestId is a
    // no-op (the chat may have ended); allow-session remembers the chat.
    ipcMain.handle('console:ai.chat.respondPermission', (_e, requestId: string, decision: PermissionDecision): void => {
        try {
            if (typeof requestId !== 'string') return;
            const p = pendingWrites.get(requestId);
            if (!p) return;
            const d: PermissionDecision = decision === 'allow' || decision === 'allow-session' ? decision : 'deny';
            if (d === 'allow-session') sessionAllowWrites.add(p.chatId);
            p.resolve(d);
            pendingWrites.delete(requestId);
        } catch {
            /* never throw across IPC */
        }
    });

    // The renderer's answer to an ask_user question. '' means dismissed. A missing
    // requestId is a no-op (the chat may have ended).
    ipcMain.handle('console:ai.chat.respondQuestion', (_e, requestId: string, answer: string): void => {
        try {
            if (typeof requestId !== 'string') return;
            const p = pendingQuestions.get(requestId);
            if (!p) return;
            p.resolve(typeof answer === 'string' ? answer : '');
            pendingQuestions.delete(requestId);
        } catch {
            /* never throw across IPC */
        }
    });

    // AN-5: the assistant's own token spend, sliced per model / session over a
    // window, from the persisted usage log. Never includes prompt content.
    ipcMain.handle('console:ai.spend', (_e, windowDays?: number): SpendReport => {
        try {
            return attributeSpend(readUsageEvents(), typeof windowDays === 'number' ? windowDays : 30, new Date().toISOString());
        } catch {
            return {
                total: { tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, costUsd: { input: 0, output: 0, total: 0 } },
                byModel: [], byRoute: [], bySession: [], unknownModels: [],
                windowDays: typeof windowDays === 'number' ? windowDays : 30,
                sampledAt: new Date().toISOString(),
            };
        }
    });
}
