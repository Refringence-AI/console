// console-electron/src/main/eval/langsmith.ts
//
// LangSmith / LangChain eval integration. Stores a LangSmith API key in the
// safeStorage keystore (alongside the AI provider keys), and runs a small
// "dev assistant" evaluation through the connected OpenAI model: each call is
// traced via langsmith/traceable and scored via langsmith/evaluation's
// evaluate(), so the run + its grades show up in the user's LangSmith account.
// The raw key never crosses the bridge.
import { loadAi, loadOpenAi, loadLangsmith, loadLangsmithEval, loadLangsmithTraceable } from '../ai/sdkLoader';
import { getKey, setKey, hasKey, clearKey } from '../ai/keystore';

const LS_ID = 'langsmith';
const API_BASE = 'https://api.smith.langchain.com';

export interface EvalRunResult {
    ok: boolean;
    experimentName?: string;
    url?: string;
    total?: number;
    passed?: number;
    error?: string;
}

export function langsmithConnected(): boolean {
    return hasKey(LS_ID);
}

// Validate against the LangSmith API (an authenticated list call) before
// storing, mirroring the AI-provider key flow. Stores only on success.
export async function setLangsmithKey(key: string): Promise<{ ok: boolean; valid?: boolean; error?: string }> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) return { ok: false, error: 'A LangSmith API key is required.' };
    try {
        const res = await fetch(`${API_BASE}/api/v1/sessions?limit=1`, { headers: { 'x-api-key': trimmed } });
        if (res.status === 401 || res.status === 403) return { ok: false, valid: false, error: 'Invalid LangSmith API key.' };
        const stored = setKey(LS_ID, trimmed);
        if (!stored) return { ok: false, valid: true, error: 'Secure storage is unavailable, so the key was not saved.' };
        return { ok: true, valid: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export function clearLangsmithKey(): void {
    clearKey(LS_ID);
}

// A small, fixed dev-assistant eval: engineering questions, each with a keyword
// the answer should contain. The target is the user's OpenAI model.
const DATASET = [
    { inputs: { question: 'In one sentence, what is a race condition?' }, outputs: { mustInclude: 'race' } },
    { inputs: { question: 'Write a regular expression that matches an email address.' }, outputs: { mustInclude: '@' } },
    { inputs: { question: 'What does git rebase do, in one sentence?' }, outputs: { mustInclude: 'rebase' } },
    { inputs: { question: 'Name one common way to prevent SQL injection.' }, outputs: { mustInclude: '' } },
];

export async function runEval(): Promise<EvalRunResult> {
    const lsKey = getKey(LS_ID);
    if (!lsKey) return { ok: false, error: 'Connect LangSmith first (Settings, AI).' };
    const oaKey = getKey('openai');
    if (!oaKey) return { ok: false, error: 'Connect an OpenAI key to run the eval target.' };
    try {
        // Enable LangSmith tracing for this process so the traceable target +
        // evaluate() report to the user's account.
        process.env.LANGSMITH_API_KEY = lsKey;
        process.env.LANGSMITH_TRACING = 'true';

        const [{ Client }, evalMod, traceMod, ai, openai] = await Promise.all([
            loadLangsmith(), loadLangsmithEval(), loadLangsmithTraceable(), loadAi(), loadOpenAi(),
        ]);
        const client = new Client({ apiKey: lsKey });
        const model = openai.createOpenAI({ apiKey: oaKey })('gpt-4o-mini');

        const target = traceMod.traceable(
            async (question: string): Promise<string> => {
                const { text } = await ai.generateText({ model, prompt: question, maxOutputTokens: 256 });
                return text;
            },
            { name: 'console-dev-assistant', client },
        );

        const answered = ({ outputs, referenceOutputs }: { outputs: unknown; referenceOutputs?: { mustInclude?: string } }) => {
            const text = typeof outputs === 'string' ? outputs : ((outputs as { outputs?: string })?.outputs ?? '');
            const need = referenceOutputs?.mustInclude ?? '';
            const score = text.trim().length > 10 && (need === '' || text.toLowerCase().includes(need.toLowerCase())) ? 1 : 0;
            return { key: 'answered_correctly', score };
        };

        const experimentPrefix = 'console-dev-eval';
        // The SDK accepts inline { inputs, outputs } examples at runtime, but its
        // TS overloads only type pre-fetched Example[]; cast to the call shape we use.
        const evaluate = evalMod.evaluate as unknown as (
            target: (inputs: { question: string }) => Promise<string>,
            options: { data: typeof DATASET; evaluators: unknown[]; maxConcurrency?: number; experimentPrefix?: string; client?: unknown },
        ) => Promise<{ experimentName?: string; results?: Array<{ evaluationResults?: { results?: Array<{ score?: number | boolean }> } }> }>;
        const results = await evaluate(
            (inputs) => target(inputs.question),
            { data: DATASET, evaluators: [answered], maxConcurrency: 2, experimentPrefix, client },
        );

        let passed = 0;
        for (const r of results.results ?? []) {
            const s = r.evaluationResults?.results?.[0]?.score;
            if (s === 1 || s === true) passed++;
        }
        return { ok: true, experimentName: results.experimentName ?? experimentPrefix, url: 'https://smith.langchain.com', total: DATASET.length, passed };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
