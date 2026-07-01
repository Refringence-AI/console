// console-electron/src/main/ipc/issues.ts
//
// Issues panel IPC handler. Reads GitHub issues via the `gh` CLI
// subprocess instead of @octokit directly — keeps auth simple
// (whatever the user is authenticated with via `gh auth status`)
// without needing a separate PAT in env or a GitHub App installation
// token refresh loop.
//
// Default target repo: the connected repo.
// Overridable via REFRINGENCE_CONSOLE_REPO env var or per-call.
import { ipcMain } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Argument-injection guards. Renderer/remote-supplied repo + label strings flow
// into the authenticated `gh` argv, so a value beginning with '-' would be
// parsed as a flag. Validate against conservative charsets, reject option-shaped
// values, and pass `--` before user-controlled positionals at each call site.
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const LABEL_RE = /^[\w.:/ -]+$/;

function isValidRepo(repo: string): boolean {
    return REPO_RE.test(repo) && !repo.startsWith('-');
}

function isValidLabel(label: string): boolean {
    return typeof label === 'string' && label.length > 0 && !label.startsWith('-') && LABEL_RE.test(label);
}

// owner/name from a git remote URL (https or ssh form). The Workboard targets
// the PICKED project's GitHub repo, derived from its `origin` remote, so it
// shows the user's issues - not a hardcoded repo.
function nwoFromRemoteUrl(url: string): string | null {
    const m = url.trim().match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i);
    return m ? `${m[1]}/${m[2]}` : null;
}

async function deriveRepo(projectRoot?: string): Promise<string | null> {
    if (!projectRoot) return null;
    try {
        const { stdout } = await execFileAsync('git', ['-C', projectRoot, 'remote', 'get-url', 'origin'], { windowsHide: true });
        return nwoFromRemoteUrl(stdout);
    } catch {
        return null;
    }
}

export interface IssueLabel {
    name: string;
    color: string;
    description?: string;
}

export interface IssueRow {
    number: number;
    title: string;
    state: 'open' | 'closed';
    url: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
    assignees: string[];
    labels: IssueLabel[];
    milestone?: { title: string; number: number };
    commentCount: number;
    body?: string;
}

export interface IssueFetchHealth {
    ghAvailable: boolean;
    ghVersion: string | null;
    repo: string;
    authStatus: 'ok' | 'no-auth' | 'unknown';
    error?: string;
}

// No hardcoded repo: the target is derived per-call from the picked project's
// git remote. An env override stays as an escape hatch; there is no baked-in
// fallback repo, so an unrelated project never shows another repo's issues.
const ENV_REPO = process.env.REFRINGENCE_CONSOLE_REPO ?? null;
const MAX_ISSUES_PER_FETCH = 100;

function runGh(args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const proc = spawn('gh', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
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
            resolve({ stdout, stderr, exitCode: 1 });
        });
        proc.on('exit', (code) => {
            if (timer) { clearTimeout(timer); timer = null; }
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });
    });
}

export function registerIssuesHandlers(): void {
    ipcMain.handle('console:issues.health', async (): Promise<IssueFetchHealth> => {
        const v = await runGh(['--version'], 5_000);
        if (v.exitCode !== 0) {
            return {
                ghAvailable: false,
                ghVersion: null,
                repo: ENV_REPO ?? '(from the open project)',
                authStatus: 'unknown',
                error: 'gh CLI not found on PATH. Install from https://cli.github.com',
            };
        }
        const versionLine = v.stdout.split('\n').find((l) => l.startsWith('gh ')) ?? '';
        const auth = await runGh(['auth', 'status'], 5_000);
        return {
            ghAvailable: true,
            ghVersion: versionLine.trim(),
            repo: ENV_REPO ?? '(from the open project)',
            authStatus: auth.exitCode === 0 ? 'ok' : 'no-auth',
            error: auth.exitCode === 0 ? undefined : (auth.stderr || auth.stdout).split('\n').slice(0, 3).join(' / '),
        };
    });

    ipcMain.handle('console:issues.list', async (
        _e,
        opts?: { repo?: string; projectRoot?: string; state?: 'open' | 'closed' | 'all'; limit?: number; label?: string }
    ): Promise<IssueRow[]> => {
        const repo = opts?.repo ?? (await deriveRepo(opts?.projectRoot)) ?? ENV_REPO;
        if (!repo) return [];
        if (!isValidRepo(repo)) {
            console.warn('[issues] rejected invalid repo:', repo);
            return [];
        }
        if (opts?.label !== undefined && !isValidLabel(opts.label)) {
            console.warn('[issues] rejected invalid label:', opts.label);
            return [];
        }
        const state = opts?.state ?? 'open';
        const limit = Math.min(opts?.limit ?? MAX_ISSUES_PER_FETCH, MAX_ISSUES_PER_FETCH);
        const args = [
            'issue', 'list',
            '--repo', repo,
            '--state', state,
            '--limit', String(limit),
            '--json', 'number,title,state,url,createdAt,updatedAt,author,assignees,labels,milestone,comments',
        ];
        if (opts?.label) {
            args.push('--label', opts.label);
        }
        args.push('--');
        const result = await runGh(args, 30_000);
        if (result.exitCode !== 0) {
            console.warn('[issues] gh issue list failed:', result.stderr);
            return [];
        }
        try {
            const parsed = JSON.parse(result.stdout) as Array<{
                number: number; title: string; state: string; url: string;
                createdAt: string; updatedAt: string;
                author?: { login?: string };
                assignees?: Array<{ login?: string }>;
                labels?: Array<{ name?: string; color?: string; description?: string }>;
                milestone?: { title?: string; number?: number };
                comments?: number;
            }>;
            return parsed.map((iss) => ({
                number: iss.number,
                title: iss.title,
                state: (iss.state.toLowerCase() === 'open' ? 'open' : 'closed') as 'open' | 'closed',
                url: iss.url,
                createdAt: iss.createdAt,
                updatedAt: iss.updatedAt,
                author: iss.author?.login,
                assignees: (iss.assignees ?? []).map((a) => a.login ?? '').filter(Boolean),
                labels: (iss.labels ?? []).map((l) => ({
                    name: l.name ?? '',
                    color: l.color ?? 'ededed',
                    description: l.description,
                })),
                milestone: iss.milestone?.title && typeof iss.milestone.number === 'number'
                    ? { title: iss.milestone.title, number: iss.milestone.number }
                    : undefined,
                commentCount: iss.comments ?? 0,
            }));
        } catch (err) {
            console.warn('[issues] JSON parse failed:', err);
            return [];
        }
    });

    ipcMain.handle('console:issues.openInBrowser', async (_e, url: string): Promise<void> => {
        if (typeof url !== 'string' || !url.startsWith('https://github.com/')) return;
        // Use gh browse-equivalent: shell.openExternal lives in main process,
        // but our preload already exposes openExternal so the renderer can call
        // that directly. Keeping this handler for future server-side automations.
    });

    // Q3b: in-app issue detail. Shells `gh issue view <num> --json
    // body,comments,...` so the Workboard's right-side Sheet can render
    // the issue without bouncing the user to github.com.
    ipcMain.handle('console:issues.detail', async (_e, num: number, projectRoot?: string) => {
        if (typeof num !== 'number' || num <= 0) return null;
        const targetRepo = (await deriveRepo(projectRoot)) ?? ENV_REPO;
        if (!targetRepo || !isValidRepo(targetRepo)) return null;
        const result = await runGh(
            [
                'issue', 'view',
                '--repo', targetRepo,
                '--json', 'number,title,state,url,createdAt,updatedAt,author,assignees,labels,milestone,comments,body',
                '--', String(num),
            ],
            30_000,
        );
        if (result.exitCode !== 0) {
            console.warn('[issues] gh issue view failed:', result.stderr);
            return null;
        }
        try {
            const iss = JSON.parse(result.stdout) as {
                number: number; title: string; state: string; url: string;
                createdAt: string; updatedAt: string; body?: string;
                author?: { login?: string };
                assignees?: Array<{ login?: string }>;
                labels?: Array<{ name?: string; color?: string; description?: string }>;
                milestone?: { title?: string; number?: number };
                comments?: Array<{ author?: { login?: string }; body?: string; createdAt?: string }>;
            };
            return {
                number: iss.number,
                title: iss.title,
                state: (iss.state.toLowerCase() === 'open' ? 'open' : 'closed') as 'open' | 'closed',
                url: iss.url,
                createdAt: iss.createdAt,
                updatedAt: iss.updatedAt,
                author: iss.author?.login,
                assignees: (iss.assignees ?? []).map((a) => a.login ?? '').filter(Boolean),
                labels: (iss.labels ?? []).map((l) => ({
                    name: l.name ?? '',
                    color: l.color ?? 'ededed',
                    description: l.description,
                })),
                milestone: iss.milestone?.title && typeof iss.milestone.number === 'number'
                    ? { title: iss.milestone.title, number: iss.milestone.number }
                    : undefined,
                commentCount: (iss.comments ?? []).length,
                body: iss.body ?? '',
                comments: (iss.comments ?? []).map((c) => ({
                    author: c.author?.login ?? 'unknown',
                    body: c.body ?? '',
                    createdAt: c.createdAt ?? '',
                })),
            };
        } catch (err) {
            console.warn('[issues] detail JSON parse failed:', err);
            return null;
        }
    });

    // Q3b: cross-column drop persistence. The Workboard fires this when a
    // card crosses severity columns. Adds + removes severity:* labels via
    // `gh issue edit`. Returns ok=false with the gh stderr on failure so
    // the UI can revert the optimistic move.
    ipcMain.handle(
        'console:issues.relabel',
        async (_e, opts: { number: number; addLabels?: string[]; removeLabels?: string[]; repo?: string; projectRoot?: string }) => {
            if (!opts || typeof opts.number !== 'number') {
                return { ok: false, error: 'invalid number' };
            }
            const targetRepo = opts.repo ?? (await deriveRepo(opts.projectRoot)) ?? ENV_REPO;
            if (!targetRepo) return { ok: false, error: 'No GitHub repo for this project (no origin remote).' };
            if (!isValidRepo(targetRepo)) return { ok: false, error: 'invalid repo' };
            const addLabels = opts.addLabels ?? [];
            const removeLabels = opts.removeLabels ?? [];
            if (![...addLabels, ...removeLabels].every(isValidLabel)) {
                return { ok: false, error: 'invalid label' };
            }
            const args = ['issue', 'edit', '--repo', targetRepo];
            for (const l of addLabels) {
                args.push('--add-label', l);
            }
            for (const l of removeLabels) {
                args.push('--remove-label', l);
            }
            args.push('--', String(opts.number));
            // No-op guard so we don't run gh with no edits.
            if (addLabels.length === 0 && removeLabels.length === 0) {
                return { ok: true };
            }
            const result = await runGh(args, 20_000);
            if (result.exitCode !== 0) {
                return { ok: false, error: (result.stderr || result.stdout).split('\n').slice(0, 3).join(' / ') };
            }
            return { ok: true };
        },
    );
}
