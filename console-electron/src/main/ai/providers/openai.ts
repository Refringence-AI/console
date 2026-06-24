// console-electron/src/main/ai/providers/openai.ts
import { loadAi, loadOpenAi } from '../sdkLoader';
import { getKey, hasKey } from '../keystore';
import { streamWithModel } from './stream';
import type { ModelProvider, ModelOption, StreamParams } from '../ModelProvider';

// Curated catalogue: the models we have metadata for. The live probe below
// intersects this with what the key can actually reach. context = tokens.
const MODELS: ModelOption[] = [
    { id: 'gpt-4o',      label: 'GPT-4o',      provider: 'openai', context: 128_000,   description: 'Multimodal flagship. Vision, fast, general use.' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', context: 128_000,   description: 'Small and cheap. A solid everyday default.' },
    { id: 'gpt-4.1',     label: 'GPT-4.1',     provider: 'openai', context: 1_000_000, description: 'Long context (1M tokens). Big docs and codebases.' },
    { id: 'o4-mini',     label: 'o4-mini',     provider: 'openai', context: 200_000,   description: 'Reasoning model. Thinks step by step before replying.' },
];

export const openaiProvider: ModelProvider = {
    id: 'openai',
    name: 'OpenAI',

    async listModels() {
        return MODELS;
    },

    // The catalogue intersected with the live /v1/models list for THIS key, so
    // the picker only shows models the key can actually call. Falls back to the
    // full catalogue on any network/parse hiccup rather than hiding the provider.
    async listAvailableModels() {
        const key = getKey('openai');
        if (!key) return [];
        try {
            const res = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${key}` },
            });
            if (!res.ok) return MODELS;
            const body = (await res.json()) as { data?: Array<{ id?: string }> };
            const live = new Set((body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string'));
            const avail = MODELS.filter((m) => live.has(m.id));
            return avail.length > 0 ? avail : MODELS;
        } catch {
            return MODELS;
        }
    },

    async hasCredentials() {
        return hasKey('openai');
    },

    async stream(params: StreamParams): Promise<void> {
        const key = getKey('openai');
        if (!key) {
            params.onError('No OpenAI key stored. Add one in Settings.');
            params.onDone();
            return;
        }
        const [ai, openai] = await Promise.all([loadAi(), loadOpenAi()]);
        const client = openai.createOpenAI({ apiKey: key });
        await streamWithModel(ai, client(params.model), params);
    },
};
