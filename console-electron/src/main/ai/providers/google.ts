// console-electron/src/main/ai/providers/google.ts
import { loadAi, loadGoogle } from '../sdkLoader';
import { getKey, hasKey } from '../keystore';
import { streamWithModel } from './stream';
import type { ModelProvider, ModelOption, StreamParams } from '../ModelProvider';

const MODELS: ModelOption[] = [
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   provider: 'google', context: 1_000_000, description: 'Long context (1M). Strong reasoning and code.' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', context: 1_000_000, description: 'Fast, long context. Good price to quality.' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google', context: 1_000_000, description: 'Fast and cheap. Everyday tasks.' },
];

export const googleProvider: ModelProvider = {
    id: 'google',
    name: 'Google Gemini',

    async listModels() {
        return MODELS;
    },

    async hasCredentials() {
        return hasKey('google');
    },

    async stream(params: StreamParams): Promise<void> {
        const key = getKey('google');
        if (!key) {
            params.onError('No Google key stored. Add one in Settings.');
            params.onDone();
            return;
        }
        const [ai, google] = await Promise.all([loadAi(), loadGoogle()]);
        const client = google.createGoogleGenerativeAI({ apiKey: key });
        await streamWithModel(ai, client(params.model), params);
    },
};
