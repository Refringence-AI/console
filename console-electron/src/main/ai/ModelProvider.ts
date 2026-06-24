// console-electron/src/main/ai/ModelProvider.ts
//
// The provider seam. Each cloud / local backend implements this one
// interface so the registry and the ipc/ai.ts handlers stay backend-
// agnostic. The shape borrows from the desktop app's providers/ModelProvider,
// trimmed to the advisor stage (text streaming only, no tools yet).

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'kimi';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
    role: ChatRole;
    content: string;
}

export interface ModelOption {
    id: string;
    label: string;
    provider: ProviderId;
    /** Context window in tokens, when known. */
    context?: number;
    /** One-line capability note shown under the model in the picker. */
    description?: string;
}

export interface ToolCallEvent { id: string; name: string; input: unknown; }
export interface ToolResultEvent { id: string; name: string; output: unknown; }

export interface StreamParams {
    model: string;
    messages: ChatMessage[];
    /** Optional standalone system prompt, applied ahead of `messages`. */
    system?: string;
    /**
     * Agentic tools the model may call (AI SDK tool() definitions, keyed by
     * name). When present, streaming runs the multi-step tool loop; tool calls
     * + results surface via onToolCall / onToolResult.
     */
    tools?: Record<string, unknown>;
    /** Aborts the in-flight request when the renderer cancels the chat. */
    signal: AbortSignal;
    onTextDelta: (delta: string) => void;
    onToolCall?: (e: ToolCallEvent) => void;
    onToolResult?: (e: ToolResultEvent) => void;
    onDone: () => void;
    onError: (message: string) => void;
}

export interface ModelProvider {
    id: ProviderId;
    name: string;
    /** Static cloud catalogue, or a live probe (Ollama hits its tags API). */
    listModels(): Promise<ModelOption[]>;
    /**
     * The models actually usable RIGHT NOW: the catalogue intersected with what
     * the stored key can reach (a live /models probe). Optional; when a provider
     * omits it the registry falls back to listModels() for keyed providers.
     */
    listAvailableModels?(): Promise<ModelOption[]>;
    /** True when a usable key is stored, or always true for keyless local. */
    hasCredentials(): Promise<boolean>;
    /**
     * Stream a completion. Implementations must resolve normally on success
     * AND on failure: they call onError + onDone instead of rejecting, so a
     * thrown error never crosses the IPC boundary.
     */
    stream(params: StreamParams): Promise<void>;
}
