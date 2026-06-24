// console-electron/src/main/ipc/metrics.ts
//
// Overview metrics for the PICKED project, derived from REAL signals:
//   - ci:       latest GitHub Actions run for the project's repo (gh run list)
//   - sbom:     a CycloneDX file found in the project, if any
//   - promptfoo: a promptfoo results.json found in the project, if any
//   - qa_runs:  runs Console itself recorded under <project>/.refringence-console/runs
//   - cost:     real AI spend tracked by Console (0 until the tracker lands)
// Nothing is read from a hardcoded sibling repo, and nothing is fabricated: a
// signal that is not present reports present:false / 0, which the UI renders as
// an honest empty state.
import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { deriveRepo, isValidRepo } from '../gitRemote';

const execFileAsync = promisify(execFile);

export interface MetricsSummary {
    timestamp: string;
    ci: {
        configured: boolean;
        status: 'passing' | 'failing' | 'running' | 'none';
        conclusion: string | null;
        workflow: string | null;
        ranAt: string | null;
    };
    sbom: {
        present: boolean;
        components: number;
        spec_version: string | null;
        size_bytes: number;
    };
    promptfoo: {
        present: boolean;
        last_run: string | null;
        passed: number;
        failed: number;
        errors: number;
    };
    qa_runs: {
        count: number;
        latest_run_id: string | null;
    };
    cost_today_usd: number;
    cycle_log: {
        commits_landed: number;
        cycles_completed: number;
    };
}

const EMPTY_CI: MetricsSummary['ci'] = { configured: false, status: 'none', conclusion: null, workflow: null, ranAt: null };

// Latest GitHub Actions run for the project's repo. A real "is the build green"
// signal, replacing the old "commits_landed > 0" placeholder.
async function statCi(repo: string | null): Promise<MetricsSummary['ci']> {
    if (!repo || !isValidRepo(repo)) return EMPTY_CI;
    try {
        const { stdout } = await execFileAsync(
            'gh',
            ['run', 'list', '-R', repo, '--limit', '1', '--json', 'status,conclusion,workflowName,createdAt'],
            { windowsHide: true, timeout: 15_000 },
        );
        const arr = JSON.parse(stdout) as Array<{ status?: string; conclusion?: string; workflowName?: string; createdAt?: string }>;
        if (!arr.length) return EMPTY_CI;
        const r = arr[0];
        const status: MetricsSummary['ci']['status'] = r.status === 'completed'
            ? (r.conclusion === 'success' ? 'passing' : 'failing')
            : 'running';
        return { configured: true, status, conclusion: r.conclusion ?? null, workflow: r.workflowName ?? null, ranAt: r.createdAt ?? null };
    } catch {
        return EMPTY_CI;
    }
}

// A CycloneDX SBOM committed in the project (root or docs/), if any.
function statSbom(root: string): MetricsSummary['sbom'] {
    const absent: MetricsSummary['sbom'] = { present: false, components: 0, spec_version: null, size_bytes: 0 };
    const candidates: string[] = [];
    for (const dir of [root, path.join(root, 'docs')]) {
        try {
            for (const f of fs.readdirSync(dir)) {
                if (f.endsWith('.cdx.json') || /sbom.*\.json$/i.test(f)) candidates.push(path.join(dir, f));
            }
        } catch { /* dir absent */ }
    }
    if (candidates.length === 0) return absent;
    candidates.sort((a, b) => b.localeCompare(a));
    try {
        const stat = fs.statSync(candidates[0]);
        const parsed = JSON.parse(fs.readFileSync(candidates[0], 'utf8')) as { specVersion?: string; components?: unknown[] };
        if (!Array.isArray(parsed.components)) return absent;
        return { present: true, components: parsed.components.length, spec_version: parsed.specVersion ?? null, size_bytes: stat.size };
    } catch {
        return absent;
    }
}

// A promptfoo results.json committed in the project, if any. (LangSmith-backed
// evals are a separate surface.)
function statPromptfoo(root: string): MetricsSummary['promptfoo'] {
    const absent: MetricsSummary['promptfoo'] = { present: false, last_run: null, passed: 0, failed: 0, errors: 0 };
    const p = path.join(root, 'eval-harness', 'promptfoo', 'output', 'results.json');
    if (!fs.existsSync(p)) return absent;
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
            timestamp?: string;
            results?: { timestamp?: string; stats?: { successes?: number; failures?: number; errors?: number } };
            stats?: { successes?: number; failures?: number; errors?: number };
        };
        const stats = raw.results?.stats ?? raw.stats ?? {};
        return { present: true, last_run: raw.results?.timestamp ?? raw.timestamp ?? null, passed: stats.successes ?? 0, failed: stats.failures ?? 0, errors: stats.errors ?? 0 };
    } catch {
        return absent;
    }
}

// Runs Console itself recorded for the project. None until the run-recorder
// lands, so this honestly reports 0 rather than counting a sibling repo's dirs.
function statQaRuns(root: string): MetricsSummary['qa_runs'] {
    const runsDir = path.join(root, '.refringence-console', 'runs');
    if (!fs.existsSync(runsDir)) return { count: 0, latest_run_id: null };
    try {
        const runs = fs.readdirSync(runsDir).filter((d) => {
            try { return fs.statSync(path.join(runsDir, d)).isDirectory(); } catch { return false; }
        });
        runs.sort((a, b) => b.localeCompare(a));
        return { count: runs.length, latest_run_id: runs[0] ?? null };
    } catch {
        return { count: 0, latest_run_id: null };
    }
}

export function registerMetricsHandlers(): void {
    ipcMain.handle('console:metrics.summary', async (_e, root: string): Promise<MetricsSummary> => {
        const valid = typeof root === 'string' && root.length > 0;
        const repo = valid ? await deriveRepo(root) : null;
        return {
            timestamp: new Date().toISOString(),
            ci: await statCi(repo),
            sbom: valid ? statSbom(root) : { present: false, components: 0, spec_version: null, size_bytes: 0 },
            promptfoo: valid ? statPromptfoo(root) : { present: false, last_run: null, passed: 0, failed: 0, errors: 0 },
            qa_runs: valid ? statQaRuns(root) : { count: 0, latest_run_id: null },
            // Real AI spend tracking lands with the agentic AI work; until then
            // this is honestly 0, never a static budget.json figure.
            cost_today_usd: 0,
            // The autonomous-loop cycle counters were parent-app-internal; a generic
            // project has none, so these stay 0 (the build vital reads `ci` now).
            cycle_log: { commits_landed: 0, cycles_completed: 0 },
        };
    });
}
