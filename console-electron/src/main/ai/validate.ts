// console-electron/src/main/ai/validate.ts
//
// Key validation: build the right client for a provider id + a candidate key
// and run a tiny generateText probe. A 401/permission error surfaces as
// {valid:false} so the IPC layer can refuse to store a bad key. The candidate
// key is held only in this call frame and never logged.
import { loadAi, loadOpenAi, loadAnthropic, loadGoogle } from './sdkLoader';
import type { LanguageModel } from 'ai';
import type { ProviderId } from './ModelProvider';

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';

// A cheap, broadly-available model per provider for the probe.
const PROBE_MODEL: Record<Exclude<ProviderId, 'ollama'>, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5',
    google: 'gemini-2.0-flash',
    kimi: 'moonshot-v1-8k',
};

async function buildProbeModel(id: ProviderId, key: string): Promise<LanguageModel | null> {
    switch (id) {
        case 'openai': {
            const openai = await loadOpenAi();
            return openai.createOpenAI({ apiKey: key })(PROBE_MODEL.openai);
        }
        case 'kimi': {
            const openai = await loadOpenAi();
            return openai.createOpenAI({ apiKey: key, baseURL: KIMI_BASE_URL })(PROBE_MODEL.kimi);
        }
        case 'anthropic': {
            const anthropic = await loadAnthropic();
            return anthropic.createAnthropic({ apiKey: key })(PROBE_MODEL.anthropic);
        }
        case 'google': {
            const google = await loadGoogle();
            return google.createGoogleGenerativeAI({ apiKey: key })(PROBE_MODEL.google);
        }
        default:
            return null;
    }
}

export async function validateKey(id: ProviderId, key: string): Promise<{ valid: boolean; error?: string }> {
    try {
        const ai = await loadAi();
        const model = await buildProbeModel(id, key);
        if (!model) return { valid: false, error: 'Provider does not use an API key.' };
        // OpenAI's API rejects max_output_tokens < 16, so the probe asks for 16
        // (still a few tokens, negligible cost) - a 1-token probe falsely fails
        // a VALID key with an "integer below minimum value" param error.
        await ai.generateText({ model, prompt: 'ping', maxOutputTokens: 16 });
        return { valid: true };
    } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
}
