// console-electron/src/main/ai/providers/anthropic.ts
import { loadAi, loadAnthropic } from '../sdkLoader';
import { getKey, hasKey } from '../keystore';
import { streamWithModel } from './stream';
import type { ModelProvider, ModelOption, StreamParams } from '../ModelProvider';

const MODELS: ModelOption[] = [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', context: 200_000, description: 'Balanced flagship. Strong coding and reasoning.' },
    { id: 'claude-opus-4-1',   label: 'Claude Opus 4.1',   provider: 'anthropic', context: 200_000, description: 'Most capable, higher cost. Hard reasoning.' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'anthropic', context: 200_000, description: 'Fastest and cheapest. Quick, simple tasks.' },
];

export const anthropicProvider: ModelProvider = {
    id: 'anthropic',
    name: 'Anthropic',

    async listModels() {
        return MODELS;
    },

    async hasCredentials() {
        return hasKey('anthropic');
    },

    async stream(params: StreamParams): Promise<void> {
        const key = getKey('anthropic');
        if (!key) {
            params.onError('No Anthropic key stored. Add one in Settings.');
            params.onDone();
            return;
        }
        const [ai, anthropic] = await Promise.all([loadAi(), loadAnthropic()]);
        const client = anthropic.createAnthropic({ apiKey: key });
        await streamWithModel(ai, client(params.model), params);
    },
};
