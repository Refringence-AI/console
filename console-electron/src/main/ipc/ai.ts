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

import { getProvider, listProviders, listAllModels, listAvailableModels, type ProviderInfo } from '../ai/registry';
import { setKey, clearKey, keyStatus, KEYED_PROVIDERS } from '../ai/keystore';
import { validateKey } from '../ai/validate';
import { loadAi } from '../ai/sdkLoader';
import { buildProjectTools, buildProjectContext } from '../ai/tools';
import type { ChatMessage, ModelOption, ProviderId } from '../ai/ModelProvider';

// One AbortController per live chat, exactly like runner.ts's `running` map.
const chats = new Map<string, AbortController>();

function newChatId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
                            tools = buildProjectTools(ai, opts.projectRoot);
                            const ctx = buildProjectContext(opts.projectRoot);
                            system = system ? `${ctx}\n\n${system}` : ctx;
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
                        onDone: () => {
                            send(win, 'console:ai.chat.done', { chatId });
                            chats.delete(chatId);
                        },
                        onError: (message) => send(win, 'console:ai.chat.error', { chatId, error: message }),
                    });
                } catch (err) {
                    send(win, 'console:ai.chat.error', { chatId, error: err instanceof Error ? err.message : String(err) });
                    send(win, 'console:ai.chat.done', { chatId });
                    chats.delete(chatId);
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
        } catch {
            /* never throw across IPC */
        }
    });
}
