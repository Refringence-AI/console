// console-electron/src/main/ai/registry.ts
//
// The provider directory. ipc/ai.ts talks only to this module, never to an
// individual provider file, so adding a backend is one import + one map entry.
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { googleProvider } from './providers/google';
import { ollamaProvider } from './providers/ollama';
import { kimiProvider } from './providers/kimi';
import type { ModelProvider, ModelOption, ProviderId } from './ModelProvider';

const PROVIDERS: Record<ProviderId, ModelProvider> = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    google: googleProvider,
    ollama: ollamaProvider,
    kimi: kimiProvider,
};

// Display order in the picker: cloud defaults first, local last.
const ORDER: ProviderId[] = ['anthropic', 'openai', 'google', 'kimi', 'ollama'];

export function getProvider(id: string): ModelProvider | null {
    return (PROVIDERS as Record<string, ModelProvider | undefined>)[id] ?? null;
}

export interface ProviderInfo {
    id: ProviderId;
    name: string;
    hasCredentials: boolean;
}

export async function listProviders(): Promise<ProviderInfo[]> {
    const out: ProviderInfo[] = [];
    for (const id of ORDER) {
        const p = PROVIDERS[id];
        let hasCredentials = false;
        try {
            hasCredentials = await p.hasCredentials();
        } catch {
            hasCredentials = false;
        }
        out.push({ id: p.id, name: p.name, hasCredentials });
    }
    return out;
}

// Concatenate every provider's catalogue: static cloud lists plus the live
// Ollama tags. A failing provider contributes nothing rather than aborting
// the whole list.
export async function listAllModels(): Promise<ModelOption[]> {
    const lists = await Promise.all(
        ORDER.map(async (id) => {
            try {
                return await PROVIDERS[id].listModels();
            } catch {
                return [] as ModelOption[];
            }
        }),
    );
    return lists.flat();
}

// The models the user can ACTUALLY use right now: only providers with
// credentials contribute, and each contributes its live-available set (the
// catalogue intersected with what the key reaches, or live local tags). This
// is what the picker shows, so a user with only an OpenAI key never sees
// Claude/Gemini entries that would fail on send.
export async function listAvailableModels(): Promise<ModelOption[]> {
    const lists = await Promise.all(
        ORDER.map(async (id) => {
            const p = PROVIDERS[id];
            try {
                if (!(await p.hasCredentials())) return [] as ModelOption[];
                return p.listAvailableModels ? await p.listAvailableModels() : await p.listModels();
            } catch {
                return [] as ModelOption[];
            }
        }),
    );
    return lists.flat();
}
