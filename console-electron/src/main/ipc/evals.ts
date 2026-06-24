// console-electron/src/main/ipc/evals.ts
//
// Evals panel IPC handler.
//
// Reads eval-harness/promptfoo/output/results.json if present and
// surfaces (a) the test count + pass/fail counts, (b) per-test latency +
// success, (c) the timestamp. Cross-links in the renderer to
// .refringence-qa/runs/<runId>/agent-evals/index.json when eval-harness
// nightly runs are present.
//
// The per-run drill-down uses the Promptfoo web UI subprocess; this
// handler is for the native "Eval Hub" landing.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { langsmithConnected, setLangsmithKey, clearLangsmithKey, runEval, type EvalRunResult } from '../eval/langsmith';

export interface PromptfooSummary {
    timestamp?: string;
    total: number;
    passed: number;
    failed: number;
    errors: number;
    totalCostUsd?: number;
    durationMs?: number;
    results: PromptfooResultRow[];
}

export interface PromptfooResultRow {
    testId: string;
    description?: string;
    success: boolean;
    latencyMs?: number;
    costUsd?: number;
    score?: number;
    error?: string;
}

function promptfooOutput(root: string): string { return path.join(root, 'eval-harness', 'promptfoo', 'output', 'results.json'); }

interface RawPfResult {
    success?: boolean;
    score?: number;
    latencyMs?: number;
    cost?: number;
    description?: string;
    error?: string;
    testCase?: { description?: string };
    namedScores?: Record<string, number>;
    gradingResult?: { reason?: string };
}

interface RawPfFile {
    version?: number;
    timestamp?: string;
    results?: {
        timestamp?: string;
        stats?: { successes?: number; failures?: number; errors?: number };
        results?: RawPfResult[];
    };
    stats?: { successes?: number; failures?: number; errors?: number };
}

function readPromptfoo(root: string): PromptfooSummary | null {
    if (!fs.existsSync(promptfooOutput(root))) return null;
    let raw: RawPfFile;
    try {
        raw = JSON.parse(fs.readFileSync(promptfooOutput(root), 'utf8')) as RawPfFile;
    } catch {
        return null;
    }
    // Schema varies by Promptfoo version; tolerate both shapes.
    const resultsArr: RawPfResult[] = raw.results?.results ?? [];
    const stats = raw.results?.stats ?? raw.stats ?? {};
    const passed = stats.successes ?? resultsArr.filter((r) => r.success).length;
    const failed = stats.failures ?? resultsArr.filter((r) => r.success === false).length;
    const errors = stats.errors ?? 0;
    const total = resultsArr.length || (passed + failed + errors);
    return {
        timestamp: raw.results?.timestamp ?? raw.timestamp,
        total,
        passed,
        failed,
        errors,
        results: resultsArr.slice(0, 50).map((r, i) => ({
            testId: r.description ?? r.testCase?.description ?? `test-${i}`,
            description: r.description ?? r.testCase?.description,
            success: r.success ?? false,
            latencyMs: r.latencyMs,
            costUsd: r.cost,
            score: r.score,
            error: r.error,
        })),
    };
}

export function registerEvalsHandlers(): void {
    ipcMain.handle('console:evals.promptfoo.summary', (_e, root: string): PromptfooSummary | null => {
        if (typeof root !== 'string' || root.length === 0) return null;
        return readPromptfoo(root);
    });

    ipcMain.handle('console:evals.health', (_e, root: string): { promptfooOutputPresent: boolean; promptfooOutputPath: string } => {
        const valid = typeof root === 'string' && root.length > 0;
        return {
            promptfooOutputPresent: valid && fs.existsSync(promptfooOutput(root)),
            promptfooOutputPath: valid ? promptfooOutput(root).replace(/\\/g, '/') : '',
        };
    });

    // --- LangSmith eval integration ---------------------------------------
    ipcMain.handle('console:eval.langsmithStatus', async (): Promise<{ connected: boolean }> => {
        try { return { connected: langsmithConnected() }; } catch { return { connected: false }; }
    });

    ipcMain.handle('console:eval.setLangsmithKey', async (_e, key: string): Promise<{ ok: boolean; valid?: boolean; error?: string }> => {
        if (typeof key !== 'string') return { ok: false, error: 'A key is required.' };
        return setLangsmithKey(key);
    });

    ipcMain.handle('console:eval.clearLangsmithKey', async (): Promise<{ ok: boolean }> => {
        try { clearLangsmithKey(); return { ok: true }; } catch { return { ok: false }; }
    });

    ipcMain.handle('console:eval.run', async (): Promise<EvalRunResult> => {
        try { return await runEval(); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });
}
