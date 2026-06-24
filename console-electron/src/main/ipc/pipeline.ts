// console-electron/src/main/ipc/pipeline.ts
//
// Pipeline panel IPC. Reads .github/workflows/*.yml and detects
// optional vercel.json / netlify.toml in the active project root so
// the renderer can draw a source-to-deploy stage graph.
//
// Fires once on panel open; sync fs is fine.
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';

export interface PipelineJob {
    id: string;
    name: string;
    runs_on: string;
    needs: string[];
    steps_count: number;
}

export interface PipelineWorkflow {
    name: string;
    path: string;
    triggers: string[];
    jobs: PipelineJob[];
}

export interface PipelineDetect {
    project_root: string;
    workflows: PipelineWorkflow[];
    vercelDetected: boolean;
    netlifyDetected: boolean;
}

export interface WorkflowRun {
    workflowName: string;
    status: string;
    conclusion: string | null;
    createdAt: string;
    displayTitle: string;
    databaseId: number;
    headBranch: string;
}

export interface PipelineRuns {
    available: boolean;
    reason?: string;
    latestByWorkflow: Record<string, WorkflowRun>;
}

function resolveProjectRoot(projectRoot: string): string {
    if (projectRoot && projectRoot.trim().length > 0) return projectRoot;
    const fromEnv = process.env.REFRINGENCE_CONSOLE_PROJECT_ROOT;
    return fromEnv ?? '';
}

// Local gh runner modelled on issues.ts. Unlike that one we pass a cwd so
// `gh run list` resolves the repo from the active project, and on spawn
// failure (gh not on PATH) we resolve exitCode -1 so the caller can report
// "gh CLI not found" distinctly from an authenticated-but-failed run.
function runGh(
    args: string[],
    cwd: string,
    timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const proc = spawn('gh', args, {
            cwd: cwd || undefined,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let timer: NodeJS.Timeout | null = setTimeout(() => {
            proc.kill('SIGTERM');
            timer = null;
        }, timeoutMs);
        proc.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
        proc.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
        proc.on('error', (err) => {
            if (timer) { clearTimeout(timer); timer = null; }
            stderr += `spawn error: ${err.message}`;
            resolve({ stdout, stderr, exitCode: -1 });
        });
        proc.on('exit', (code) => {
            if (timer) { clearTimeout(timer); timer = null; }
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });
    });
}

function extractTriggers(raw: unknown): string[] {
    if (!raw) return [];
    if (typeof raw === 'string') return [raw];
    if (Array.isArray(raw)) {
        return raw.filter((t): t is string => typeof t === 'string');
    }
    if (typeof raw === 'object') {
        return Object.keys(raw as Record<string, unknown>);
    }
    return [];
}

function extractRunsOn(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
        return raw.filter((r): r is string => typeof r === 'string').join(', ');
    }
    return 'unknown';
}

function extractNeeds(raw: unknown): string[] {
    if (!raw) return [];
    if (typeof raw === 'string') return [raw];
    if (Array.isArray(raw)) {
        return raw.filter((n): n is string => typeof n === 'string');
    }
    return [];
}

function extractStepsCount(raw: unknown): number {
    if (Array.isArray(raw)) return raw.length;
    return 0;
}

function parseWorkflow(filePath: string, relPath: string): PipelineWorkflow | null {
    let body: string;
    try {
        body = fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
    let doc: unknown;
    try {
        doc = YAML.parse(body);
    } catch {
        return {
            name: path.basename(filePath),
            path: relPath,
            triggers: [],
            jobs: [],
        };
    }
    if (!doc || typeof doc !== 'object') {
        return {
            name: path.basename(filePath),
            path: relPath,
            triggers: [],
            jobs: [],
        };
    }
    const root = doc as Record<string, unknown>;
    const name = typeof root.name === 'string' ? root.name : path.basename(filePath);
    // YAML parses bare `on:` as boolean true (the "Norway problem"). Probe
    // both the string key 'on' and the actual boolean true key, then merge.
    const rootAny = root as unknown as Map<unknown, unknown> | Record<string, unknown>;
    const onString = root.on;
    let onBool: unknown;
    if (rootAny instanceof Map) {
        onBool = rootAny.get(true);
    } else {
        // After YAML.parse with default options the document is a plain object,
        // but a boolean key gets coerced to the string 'true'.
        onBool = (root as Record<string, unknown>)['true'];
    }
    const triggers = Array.from(
        new Set([...extractTriggers(onString), ...extractTriggers(onBool)]),
    );
    const jobsRaw = root.jobs;
    const jobs: PipelineJob[] = [];
    if (jobsRaw && typeof jobsRaw === 'object' && !Array.isArray(jobsRaw)) {
        for (const [jobId, jobBody] of Object.entries(jobsRaw as Record<string, unknown>)) {
            if (!jobBody || typeof jobBody !== 'object') continue;
            const j = jobBody as Record<string, unknown>;
            jobs.push({
                id: jobId,
                name: typeof j.name === 'string' ? j.name : jobId,
                runs_on: extractRunsOn(j['runs-on']),
                needs: extractNeeds(j.needs),
                steps_count: extractStepsCount(j.steps),
            });
        }
    }
    return { name, path: relPath, triggers, jobs };
}

function readWorkflows(projectRoot: string): PipelineWorkflow[] {
    const wfDir = path.join(projectRoot, '.github', 'workflows');
    if (!fs.existsSync(wfDir)) return [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(wfDir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out: PipelineWorkflow[] = [];
    for (const ent of entries) {
        if (!ent.isFile()) continue;
        const lower = ent.name.toLowerCase();
        if (!lower.endsWith('.yml') && !lower.endsWith('.yaml')) continue;
        const abs = path.join(wfDir, ent.name);
        const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
        const wf = parseWorkflow(abs, rel);
        if (wf) out.push(wf);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

export function registerPipelineHandlers(): void {
    ipcMain.handle('console:pipeline.detect', (_evt, projectRoot: string): PipelineDetect => {
        const root = resolveProjectRoot(projectRoot);
        if (!root || !fs.existsSync(root)) {
            return {
                project_root: '',
                workflows: [],
                vercelDetected: false,
                netlifyDetected: false,
            };
        }
        const workflows = readWorkflows(root);
        const vercelDetected = fs.existsSync(path.join(root, 'vercel.json'));
        const netlifyDetected = fs.existsSync(path.join(root, 'netlify.toml'));
        return {
            project_root: root.replace(/\\/g, '/'),
            workflows,
            vercelDetected,
            netlifyDetected,
        };
    });

    // Workflow-level run health. Shells `gh run list` in the project root and
    // keeps the newest run per workflowName (gh returns newest first), so the
    // renderer can answer "did the last build pass" per workflow. Degrades to
    // available=false (topology-only) when gh is missing, unauthenticated, the
    // dir is not a repo, or the JSON cannot be parsed. Never throws.
    ipcMain.handle('console:pipeline.runs', async (_e, projectRoot: string): Promise<PipelineRuns> => {
        const root = resolveProjectRoot(projectRoot);
        if (!root || !fs.existsSync(root)) {
            return { available: false, reason: 'No project connected', latestByWorkflow: {} };
        }
        const result = await runGh(
            [
                'run', 'list',
                '--limit', '40',
                '--json', 'workflowName,status,conclusion,createdAt,displayTitle,databaseId,headBranch',
            ],
            root,
        );
        if (result.exitCode === -1) {
            return { available: false, reason: 'gh CLI not found', latestByWorkflow: {} };
        }
        if (result.exitCode !== 0) {
            const reason = (result.stderr || result.stdout).split('\n').map((l) => l.trim()).find(Boolean)
                ?? 'gh run list failed';
            return { available: false, reason, latestByWorkflow: {} };
        }
        let parsed: Array<{
            workflowName?: string; status?: string; conclusion?: string | null;
            createdAt?: string; displayTitle?: string; databaseId?: number; headBranch?: string;
        }>;
        try {
            parsed = JSON.parse(result.stdout);
        } catch {
            return { available: false, reason: 'Could not parse gh run output', latestByWorkflow: {} };
        }
        const latestByWorkflow: Record<string, WorkflowRun> = {};
        for (const r of parsed) {
            const name = r.workflowName;
            if (!name || name in latestByWorkflow) continue; // first seen = newest
            latestByWorkflow[name] = {
                workflowName: name,
                status: r.status ?? '',
                conclusion: r.conclusion ?? null,
                createdAt: r.createdAt ?? '',
                displayTitle: r.displayTitle ?? '',
                databaseId: r.databaseId ?? 0,
                headBranch: r.headBranch ?? '',
            };
        }
        return { available: true, latestByWorkflow };
    });
}
