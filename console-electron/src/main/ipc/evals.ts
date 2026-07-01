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

// --- Eval-regression gate -------------------------------------------------
// A baseline captures the last "known good" promptfoo run; the gate diffs the
// current run against it. A gate that doesn't block is theatre, so a per-test
// regression (a test that passed at baseline and fails now) blocks the release
// and is named, not just counted.
export interface EvalGateResult {
    status: 'no-baseline' | 'no-current' | 'pass' | 'regressed';
    currentPassed?: number;
    currentTotal?: number;
    currentPassRate?: number;   // 0..1
    baselinePassRate?: number;
    baselineCapturedAt?: string;
    regressions: string[];      // passed at baseline, fails now - the blockers
    newlyPassing: string[];     // failed at baseline, passes now
    blocked: boolean;
}

interface EvalBaseline {
    capturedAt: string;
    total: number;
    passed: number;
    perTest: Record<string, boolean>;
}

function baselinePath(root: string): string { return path.join(root, '.refringence-console', 'eval-baseline.json'); }

function perTestMap(s: PromptfooSummary): Record<string, boolean> {
    const m: Record<string, boolean> = {};
    for (const r of s.results) m[r.testId] = r.success;
    return m;
}

function readBaseline(root: string): EvalBaseline | null {
    try {
        const raw = JSON.parse(fs.readFileSync(baselinePath(root), 'utf8')) as EvalBaseline;
        if (raw && typeof raw.capturedAt === 'string' && raw.perTest && typeof raw.perTest === 'object') return raw;
    } catch { /* none yet */ }
    return null;
}

export function computeGate(root: string): EvalGateResult {
    const current = readPromptfoo(root);
    if (!current) return { status: 'no-current', regressions: [], newlyPassing: [], blocked: false };
    const currentPassRate = current.total > 0 ? current.passed / current.total : 0;
    const base = readBaseline(root);
    if (!base) {
        return {
            status: 'no-baseline', currentPassed: current.passed, currentTotal: current.total,
            currentPassRate, regressions: [], newlyPassing: [], blocked: false,
        };
    }
    const cur = perTestMap(current);
    const regressions = Object.keys(base.perTest).filter((id) => base.perTest[id] === true && cur[id] === false);
    const newlyPassing = Object.keys(cur).filter((id) => cur[id] === true && base.perTest[id] === false);
    const baselinePassRate = base.total > 0 ? base.passed / base.total : 0;
    const blocked = regressions.length > 0 || currentPassRate < baselinePassRate - 1e-9;
    return {
        status: blocked ? 'regressed' : 'pass',
        currentPassed: current.passed, currentTotal: current.total, currentPassRate,
        baselinePassRate, baselineCapturedAt: base.capturedAt,
        regressions, newlyPassing, blocked,
    };
}

export function setBaseline(root: string): { ok: boolean; error?: string } {
    const current = readPromptfoo(root);
    if (!current) return { ok: false, error: 'No promptfoo run to capture. Run your eval first.' };
    try {
        fs.mkdirSync(path.join(root, '.refringence-console'), { recursive: true });
        const base: EvalBaseline = { capturedAt: new Date().toISOString(), total: current.total, passed: current.passed, perTest: perTestMap(current) };
        fs.writeFileSync(baselinePath(root), JSON.stringify(base, null, 2), 'utf8');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export function registerEvalsHandlers(): void {
    ipcMain.handle('console:evals.promptfoo.summary', (_e, root: string): PromptfooSummary | null => {
        if (typeof root !== 'string' || root.length === 0) return null;
        return readPromptfoo(root);
    });

    ipcMain.handle('console:evals.gate', (_e, root: string): EvalGateResult => {
        if (typeof root !== 'string' || root.length === 0) return { status: 'no-current', regressions: [], newlyPassing: [], blocked: false };
        try { return computeGate(root); } catch { return { status: 'no-current', regressions: [], newlyPassing: [], blocked: false }; }
    });

    ipcMain.handle('console:evals.setBaseline', (_e, root: string): { ok: boolean; error?: string } => {
        if (typeof root !== 'string' || root.length === 0) return { ok: false, error: 'No project.' };
        try { return setBaseline(root); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
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
