// console-shell/src/lib/ai/useAiChat.ts
//
// Renderer-side state for one streaming AI conversation. Subscribes once to
// chat.onDelta / onToolCall / onToolResult / onDone / onError, accumulates the
// assistant message (text + tool-use cards) by chatId, and exposes a small
// surface { messages, send, stop, streaming, error }. One conversation in
// component state; no session persistence yet.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    bridge,
    type AiChatMessage,
    type AiChatDelta,
    type AiChatDone,
    type AiChatError,
    type AiChatToolCall,
    type AiChatToolResult,
    type AiPermissionRequest,
    type AiPermissionDecision,
    type AiQuestionRequest,
    type AiChatUsage,
} from '../bridge';

export interface ChatToolUse {
    id: string;
    name: string;
    input: unknown;
    output?: unknown;
    done: boolean;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    tools?: ChatToolUse[];
}

export interface UseAiChat {
    messages: ChatMessage[];
    streaming: boolean;
    error: string | null;
    usage: { contextTokens: number; totalTokens: number } | null;
    pendingPermission: AiPermissionRequest | null;
    respondPermission(decision: AiPermissionDecision): void;
    pendingQuestion: AiQuestionRequest | null;
    respondQuestion(answer: string): void;
    send(text: string): Promise<void>;
    stop(): void;
    reset(): void;
}

// Get-or-create the trailing assistant message and apply a mutation, so tool
// events that arrive before any text still attach to the right turn.
function upsertAssistant(prev: ChatMessage[], mutate: (m: ChatMessage) => ChatMessage): ChatMessage[] {
    const next = prev.slice();
    const last = next[next.length - 1];
    if (last && last.role === 'assistant') {
        next[next.length - 1] = mutate(last);
    } else {
        next.push(mutate({ role: 'assistant', content: '' }));
    }
    return next;
}

// Persist a conversation per project so it survives reload. Tool outputs (which
// can be large file dumps) are dropped from the stored copy to stay well under
// the localStorage quota; the conversation text is what matters on restore.
function chatStoreKey(projectRoot?: string): string | null {
    return projectRoot ? `refringence-console-ai-chat:${projectRoot.replace(/\\/g, '/').toLowerCase()}` : null;
}
function forStorage(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((m) => (m.tools ? { ...m, tools: m.tools.map((t) => ({ ...t, output: undefined })) } : m));
}

export function useAiChat(model: string, opts?: { system?: string; projectRoot?: string; planMode?: boolean }): UseAiChat {
    const system = opts?.system;
    const projectRoot = opts?.projectRoot;
    const planMode = opts?.planMode;
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingPermission, setPendingPermission] = useState<AiPermissionRequest | null>(null);
    const [pendingQuestion, setPendingQuestion] = useState<AiQuestionRequest | null>(null);
    const [usage, setUsage] = useState<{ contextTokens: number; totalTokens: number } | null>(null);

    const activeChatId = useRef<string | null>(null);
    const storeKey = chatStoreKey(projectRoot);

    // Restore the saved conversation for this project on mount / project switch.
    useEffect(() => {
        if (!storeKey) { setMessages([]); return; }
        try {
            const raw = localStorage.getItem(storeKey);
            setMessages(raw ? (JSON.parse(raw) as ChatMessage[]) : []);
        } catch { setMessages([]); }
    }, [storeKey]);

    // Persist after each settled turn (never mid-stream; never remove here, or a
    // remount's stale empty-messages closure would wipe the saved conversation
    // before the restore effect runs - reset clears explicitly instead).
    useEffect(() => {
        if (!storeKey || streaming || !messages.length) return;
        try {
            localStorage.setItem(storeKey, JSON.stringify(forStorage(messages)));
        } catch { /* quota or serialization issue; skip persisting this turn */ }
    }, [messages, streaming, storeKey]);

    useEffect(() => {
        const offDelta = bridge.ai.chat.onDelta((e: AiChatDelta) => {
            if (e.chatId !== activeChatId.current) return;
            setMessages((prev) => upsertAssistant(prev, (m) => ({ ...m, content: m.content + e.delta })));
        });

        const offToolCall = bridge.ai.chat.onToolCall((e: AiChatToolCall) => {
            if (e.chatId !== activeChatId.current) return;
            setMessages((prev) => upsertAssistant(prev, (m) => ({
                ...m,
                tools: [...(m.tools ?? []), { id: e.id, name: e.name, input: e.input, done: false }],
            })));
        });

        const offToolResult = bridge.ai.chat.onToolResult((e: AiChatToolResult) => {
            if (e.chatId !== activeChatId.current) return;
            setMessages((prev) => upsertAssistant(prev, (m) => ({
                ...m,
                tools: (m.tools ?? []).map((t) => (t.id === e.id ? { ...t, output: e.output, done: true } : t)),
            })));
        });

        const offUsage = bridge.ai.chat.onUsage((e: AiChatUsage) => {
            if (e.chatId !== activeChatId.current) return;
            setUsage((prev) => ({
                contextTokens: e.inputTokens ?? prev?.contextTokens ?? 0,
                totalTokens: (prev?.totalTokens ?? 0) + (e.totalTokens ?? 0),
            }));
        });

        const offPerm = bridge.ai.chat.onPermissionRequest((e: AiPermissionRequest) => {
            if (e.chatId !== activeChatId.current) return;
            setPendingPermission(e);
        });

        const offQuestion = bridge.ai.chat.onQuestionRequest((e: AiQuestionRequest) => {
            if (e.chatId !== activeChatId.current) return;
            setPendingQuestion(e);
        });

        const offDone = bridge.ai.chat.onDone((e: AiChatDone) => {
            if (e.chatId !== activeChatId.current) return;
            activeChatId.current = null;
            setStreaming(false);
            setPendingPermission(null);
            setPendingQuestion(null);
        });

        const offError = bridge.ai.chat.onError((e: AiChatError) => {
            if (e.chatId !== activeChatId.current) return;
            activeChatId.current = null;
            setStreaming(false);
            setError(e.error);
            setPendingPermission(null);
            setPendingQuestion(null);
        });

        return () => { offDelta(); offToolCall(); offToolResult(); offUsage(); offPerm(); offQuestion(); offDone(); offError(); };
    }, []);

    const respondPermission = useCallback((decision: AiPermissionDecision): void => {
        setPendingPermission((p) => {
            if (p) void bridge.ai.chat.respondPermission(p.requestId, decision);
            return null;
        });
    }, []);

    const respondQuestion = useCallback((answer: string): void => {
        setPendingQuestion((p) => {
            if (p) void bridge.ai.chat.respondQuestion(p.requestId, answer);
            return null;
        });
    }, []);

    const send = useCallback(
        async (text: string): Promise<void> => {
            const trimmed = text.trim();
            if (!trimmed || streaming) return;
            setError(null);

            // Only role + text cross turns; within-turn tool detail stays local.
            const history: AiChatMessage[] = [
                ...messages.map((m): AiChatMessage => ({ role: m.role, content: m.content })),
                { role: 'user', content: trimmed },
            ];

            setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
            setStreaming(true);

            try {
                const { chatId } = await bridge.ai.chat.start({ model, messages: history, system, projectRoot, planMode });
                activeChatId.current = chatId;
            } catch (e) {
                setStreaming(false);
                setError(e instanceof Error ? e.message : String(e));
            }
        },
        [messages, model, system, projectRoot, planMode, streaming],
    );

    const stop = useCallback((): void => {
        const id = activeChatId.current;
        if (!id) return;
        void bridge.ai.chat.cancel(id);
        activeChatId.current = null;
        setStreaming(false);
        setPendingPermission(null);
        setPendingQuestion(null);
    }, []);

    const reset = useCallback((): void => {
        const id = activeChatId.current;
        if (id) void bridge.ai.chat.cancel(id);
        activeChatId.current = null;
        setStreaming(false);
        setError(null);
        setMessages([]);
        setPendingPermission(null);
        setPendingQuestion(null);
        setUsage(null);
        if (storeKey) { try { localStorage.removeItem(storeKey); } catch { /* ignore */ } }
    }, [storeKey]);

    return { messages, streaming, error, usage, pendingPermission, respondPermission, pendingQuestion, respondQuestion, send, stop, reset };
}
