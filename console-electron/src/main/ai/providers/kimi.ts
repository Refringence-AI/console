// console-electron/src/main/ai/providers/kimi.ts
//
// Moonshot's Kimi is OpenAI-API-compatible, so it rides the @ai-sdk/openai
// client pointed at Moonshot's baseURL instead of needing its own SDK.
import { loadAi, loadOpenAi } from '../sdkLoader';
import { getKey, hasKey } from '../keystore';
import { streamWithModel } from './stream';
import type { ModelProvider, ModelOption, StreamParams } from '../ModelProvider';

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';

const MODELS: ModelOption[] = [
    { id: 'kimi-k2-0711-preview', label: 'Kimi K2',          provider: 'kimi', context: 128_000, description: 'Agentic, strong tool use. 128k context.' },
    { id: 'moonshot-v1-128k',     label: 'Moonshot v1 128k',  provider: 'kimi', context: 128_000, description: 'Long context (128k). General use.' },
    { id: 'moonshot-v1-32k',      label: 'Moonshot v1 32k',   provider: 'kimi', context: 32_000,  description: 'Mid context (32k). General use.' },
];

export const kimiProvider: ModelProvider = {
    id: 'kimi',
    name: 'Kimi (Moonshot)',

    async listModels() {
        return MODELS;
    },

    async hasCredentials() {
        return hasKey('kimi');
    },

    async stream(params: StreamParams): Promise<void> {
        const key = getKey('kimi');
        if (!key) {
            params.onError('No Kimi key stored. Add one in Settings.');
            params.onDone();
            return;
        }
        const [ai, openai] = await Promise.all([loadAi(), loadOpenAi()]);
        const client = openai.createOpenAI({ apiKey: key, baseURL: KIMI_BASE_URL });
        await streamWithModel(ai, client(params.model), params);
    },
};
