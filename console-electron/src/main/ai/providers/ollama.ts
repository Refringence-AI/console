// console-electron/src/main/ai/providers/ollama.ts
//
// Local, keyless provider. We never bundle or auto-install Ollama: we detect
// a running instance on the default port and forward to it. ollama-ai-provider
// targets the SDK's old LanguageModelV1 spec and is incompatible with `ai` v6
// (which wants V2/V3 models), so we route streaming through @ai-sdk/openai
// pointed at Ollama's OpenAI-compatible /v1 endpoint, and we list models from
// Ollama's native /api/tags (the OpenAI-compat /v1/models is less reliable
// across builds). The fetch helper is lifted from ipc/ollama.ts.
import { loadAi, loadOpenAi } from '../sdkLoader';
import { streamWithModel } from './stream';
import type { ModelProvider, ModelOption, StreamParams } from '../ModelProvider';

const HOST = 'http://localhost:11434';
const OPENAI_COMPAT_BASE_URL = `${HOST}/v1`;

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
    } finally {
        clearTimeout(timer);
    }
}

export const ollamaProvider: ModelProvider = {
    id: 'ollama',
    name: 'Ollama (local)',

    async listModels() {
        try {
            const tags = await fetchJson<{ models?: Array<{ name?: string }> }>(
                `${HOST}/api/tags`,
                { method: 'GET' },
                5_000,
            );
            const names = Array.isArray(tags.models)
                ? tags.models.map((m) => (typeof m.name === 'string' ? m.name : '')).filter((n) => n.length > 0)
                : [];
            return names.map<ModelOption>((name) => ({ id: name, label: name, provider: 'ollama', description: 'Local model. Runs on your machine, no key.' }));
        } catch {
            // Not running, or /api/tags disabled. An empty list is the honest
            // answer; the picker shows no local models rather than erroring.
            return [];
        }
    },

    // Local Ollama needs no key. The renderer still gates on a running
    // instance via the existing console:ollama.detect channel.
    async hasCredentials() {
        return true;
    },

    async stream(params: StreamParams): Promise<void> {
        const [ai, openai] = await Promise.all([loadAi(), loadOpenAi()]);
        // Ollama ignores the key but the OpenAI client requires a non-empty
        // string, so we pass a placeholder.
        const client = openai.createOpenAI({ apiKey: 'ollama', baseURL: OPENAI_COMPAT_BASE_URL });
        await streamWithModel(ai, client(params.model), params);
    },
};
