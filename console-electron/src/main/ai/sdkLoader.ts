// console-electron/src/main/ai/sdkLoader.ts
//
// The Vercel AI SDK (`ai`) and the `@ai-sdk/*` provider packages are pure
// ESM ("type": "module"). Our main process is CJS (tsc -> CommonJS), and
// Node's CJS-importing-ESM interop is brittle: a top-level `require()` of
// these packages crashes the same way `electron-store` did. We load each
// one through a single cached dynamic-import Promise and `await` it on
// first use; later calls hit the cached handle. This mirrors the desktop app's
// claudeProvider.ts loadSdk() pattern.

let _aiPromise: Promise<typeof import('ai')> | null = null;
export function loadAi(): Promise<typeof import('ai')> {
    if (_aiPromise) return _aiPromise;
    _aiPromise = import('ai');
    return _aiPromise;
}

let _openaiPromise: Promise<typeof import('@ai-sdk/openai')> | null = null;
export function loadOpenAi(): Promise<typeof import('@ai-sdk/openai')> {
    if (_openaiPromise) return _openaiPromise;
    _openaiPromise = import('@ai-sdk/openai');
    return _openaiPromise;
}

let _anthropicPromise: Promise<typeof import('@ai-sdk/anthropic')> | null = null;
export function loadAnthropic(): Promise<typeof import('@ai-sdk/anthropic')> {
    if (_anthropicPromise) return _anthropicPromise;
    _anthropicPromise = import('@ai-sdk/anthropic');
    return _anthropicPromise;
}

let _googlePromise: Promise<typeof import('@ai-sdk/google')> | null = null;
export function loadGoogle(): Promise<typeof import('@ai-sdk/google')> {
    if (_googlePromise) return _googlePromise;
    _googlePromise = import('@ai-sdk/google');
    return _googlePromise;
}

// langsmith is ESM too; same cached-import treatment. Three entry points: the
// Client, the evaluate() runner, and traceable() for tracing the target.
let _langsmithPromise: Promise<typeof import('langsmith')> | null = null;
export function loadLangsmith(): Promise<typeof import('langsmith')> {
    if (_langsmithPromise) return _langsmithPromise;
    _langsmithPromise = import('langsmith');
    return _langsmithPromise;
}

let _langsmithEvalPromise: Promise<typeof import('langsmith/evaluation')> | null = null;
export function loadLangsmithEval(): Promise<typeof import('langsmith/evaluation')> {
    if (_langsmithEvalPromise) return _langsmithEvalPromise;
    _langsmithEvalPromise = import('langsmith/evaluation');
    return _langsmithEvalPromise;
}

let _langsmithTraceablePromise: Promise<typeof import('langsmith/traceable')> | null = null;
export function loadLangsmithTraceable(): Promise<typeof import('langsmith/traceable')> {
    if (_langsmithTraceablePromise) return _langsmithTraceablePromise;
    _langsmithTraceablePromise = import('langsmith/traceable');
    return _langsmithTraceablePromise;
}
