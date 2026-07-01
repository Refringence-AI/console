// console-electron/src/main/ipc/ollama.ts
//
// Tier 1: detect a locally-running Ollama (no install, no spawn) and
// forward generate requests. No model is downloaded automatically.
//
// Channels:
//   console:ollama.detect()          -> { running, version?, models? }
//   console:ollama.generate({...})   -> { text }

import { ipcMain, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { detectSystemSpecs, recommend, type Recommendation } from '../ollama-models';

export interface OllamaStatus {
    running: boolean;
    version?: string;
    models?: string[];
}

const HOST = 'http://localhost:11434';

// One in-flight pull at a time; cancellable from the renderer.
let pullAbort: AbortController | null = null;

async function installedModels(): Promise<string[]> {
    try {
        const tags = await fetchJson<{ models?: Array<{ name?: string }> }>(`${HOST}/api/tags`, { method: 'GET' }, 4000);
        if (Array.isArray(tags.models)) return tags.models.map((m) => m.name ?? '').filter(Boolean);
    } catch { /* not running */ }
    return [];
}

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

    // Hardware-aware guidance: detect the machine + the already-pulled models and
    // recommend the largest reputable model that runs well here.
    ipcMain.handle('console:ollama.recommend', async (): Promise<Recommendation> => {
        const specs = await detectSystemSpecs();
        return recommend(specs, await installedModels());
    });

    // Pull a model with streamed progress. Ollama's /api/pull streams NDJSON
    // {status, completed, total}; we relay it to console:ollama.pull.progress.
    // Cancellable via console:ollama.pull.cancel. Requires Ollama running.
    ipcMain.handle('console:ollama.pull', async (e, model: string): Promise<{ ok: boolean; error?: string }> => {
        if (typeof model !== 'string' || !model.trim()) return { ok: false, error: 'A model id is required.' };
        const win = BrowserWindow.fromWebContents(e.sender);
        const send = (p: unknown) => win?.webContents.send('console:ollama.pull.progress', p);
        pullAbort?.abort();
        pullAbort = new AbortController();
        try {
            const res = await fetch(`${HOST}/api/pull`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: model.trim(), stream: true }),
                signal: pullAbort.signal,
            });
            if (!res.ok || !res.body) return { ok: false, error: `Ollama is not reachable (HTTP ${res.status}). Make sure it is installed and running.` };
            const reader = (res.body as ReadableStream<Uint8Array>).getReader();
            const dec = new TextDecoder();
            let buf = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    const s = line.trim();
                    if (!s) continue;
                    try {
                        const j = JSON.parse(s) as { status?: string; completed?: number; total?: number; error?: string };
                        if (j.error) { send({ model, status: 'error', error: j.error }); return { ok: false, error: j.error }; }
                        send({ model, status: j.status ?? '', completed: j.completed ?? 0, total: j.total ?? 0 });
                    } catch { /* partial line, wait for more */ }
                }
            }
            send({ model, status: 'success', done: true });
            return { ok: true };
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') { send({ model, status: 'cancelled' }); return { ok: false, error: 'cancelled' }; }
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        } finally {
            pullAbort = null;
        }
    });

    ipcMain.handle('console:ollama.pull.cancel', (): void => { pullAbort?.abort(); });

    // Install Ollama. On Windows, drives the official winget package (per-user, no
    // admin); elsewhere returns a guided command + URL. Output streams to
    // console:ollama.install.progress. The renderer gates this behind a consent
    // step - it downloads + runs third-party software.
    ipcMain.handle('console:ollama.install', async (e): Promise<{ ok: boolean; manual?: boolean; url?: string; command?: string; error?: string }> => {
        const win = BrowserWindow.fromWebContents(e.sender);
        const send = (line: string) => win?.webContents.send('console:ollama.install.progress', { line });
        const guideUrl = 'https://ollama.com/download';
        if (process.platform === 'win32') {
            return await new Promise((resolve) => {
                let settled = false;
                const finish = (r: { ok: boolean; manual?: boolean; url?: string; command?: string; error?: string }) => { if (!settled) { settled = true; resolve(r); } };
                let proc: ReturnType<typeof spawn>;
                try {
                    proc = spawn('winget', ['install', '--id', 'Ollama.Ollama', '-e', '--accept-source-agreements', '--accept-package-agreements'], { windowsHide: true });
                } catch {
                    return finish({ ok: false, manual: true, url: guideUrl, command: 'winget install Ollama.Ollama', error: 'winget not available' });
                }
                const relay = (d: Buffer) => d.toString().split(/\r?\n/).forEach((l) => { const t = l.trim(); if (t) send(t); });
                proc.stdout?.on('data', relay);
                proc.stderr?.on('data', relay);
                proc.on('error', () => finish({ ok: false, manual: true, url: guideUrl, command: 'winget install Ollama.Ollama', error: 'winget not available' }));
                proc.on('close', (code) => finish(code === 0 ? { ok: true } : { ok: false, manual: true, url: guideUrl, command: 'winget install Ollama.Ollama', error: `winget exited with code ${code}` }));
            });
        }
        const command = process.platform === 'darwin' ? 'brew install ollama' : 'curl -fsSL https://ollama.com/install.sh | sh';
        return { ok: false, manual: true, url: guideUrl, command };
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
