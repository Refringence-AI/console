// console-electron/src/main/ipc/ollama.ts
//
// Tier 1: detect a locally-running Ollama (no install, no spawn) and
// forward generate requests. No model is downloaded automatically.
//
// Channels:
//   console:ollama.detect()          -> { running, version?, models? }
//   console:ollama.generate({...})   -> { text }

import { ipcMain } from 'electron';

export interface OllamaStatus {
    running: boolean;
    version?: string;
    models?: string[];
}

const HOST = 'http://localhost:11434';

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

export function registerOllamaHandlers(): void {
    ipcMain.handle('console:ollama.detect', async (): Promise<OllamaStatus> => {
        try {
            const ver = await fetchJson<{ version?: string }>(
                `${HOST}/api/version`,
                { method: 'GET' },
                5_000,
            );
            const status: OllamaStatus = { running: true };
            if (typeof ver.version === 'string') status.version = ver.version;
            try {
                const tags = await fetchJson<{ models?: Array<{ name?: string }> }>(
                    `${HOST}/api/tags`,
                    { method: 'GET' },
                    5_000,
                );
                if (Array.isArray(tags.models)) {
                    status.models = tags.models
                        .map((m) => (typeof m.name === 'string' ? m.name : ''))
                        .filter((n) => n.length > 0);
                }
            } catch {
                // /api/tags is optional - some custom builds disable it.
            }
            return status;
        } catch {
            return { running: false };
        }
    });

    ipcMain.handle(
        'console:ollama.generate',
        async (_e, opts: { model: string; prompt: string }): Promise<{ text: string }> => {
            if (!opts || typeof opts.model !== 'string' || typeof opts.prompt !== 'string') {
                throw new Error('ollama.generate: { model, prompt } required');
            }
            const res = await fetchJson<{ response?: string }>(
                `${HOST}/api/generate`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        model: opts.model,
                        prompt: opts.prompt,
                        stream: false,
                    }),
                },
                60_000,
            );
            return { text: typeof res.response === 'string' ? res.response : '' };
        },
    );
}
