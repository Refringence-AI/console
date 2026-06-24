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

export function useAiChat(model: string, opts?: { system?: string; projectRoot?: string }): UseAiChat {
    const system = opts?.system;
    const projectRoot = opts?.projectRoot;
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const activeChatId = useRef<string | null>(null);

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

        const offDone = bridge.ai.chat.onDone((e: AiChatDone) => {
            if (e.chatId !== activeChatId.current) return;
            activeChatId.current = null;
            setStreaming(false);
        });

        const offError = bridge.ai.chat.onError((e: AiChatError) => {
            if (e.chatId !== activeChatId.current) return;
            activeChatId.current = null;
            setStreaming(false);
            setError(e.error);
        });

        return () => { offDelta(); offToolCall(); offToolResult(); offDone(); offError(); };
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
                const { chatId } = await bridge.ai.chat.start({ model, messages: history, system, projectRoot });
                activeChatId.current = chatId;
            } catch (e) {
                setStreaming(false);
                setError(e instanceof Error ? e.message : String(e));
            }
        },
        [messages, model, system, projectRoot, streaming],
    );

    const stop = useCallback((): void => {
        const id = activeChatId.current;
        if (!id) return;
        void bridge.ai.chat.cancel(id);
        activeChatId.current = null;
        setStreaming(false);
    }, []);

    const reset = useCallback((): void => {
        const id = activeChatId.current;
        if (id) void bridge.ai.chat.cancel(id);
        activeChatId.current = null;
        setStreaming(false);
        setError(null);
        setMessages([]);
    }, []);

    return { messages, streaming, error, send, stop, reset };
}
