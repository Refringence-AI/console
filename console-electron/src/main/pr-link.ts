// console-electron/src/main/pr-link.ts
//
// Given a local repo root and an optional branch name, find the associated
// GitHub PR via the gh CLI. Total function: never throws across IPC boundaries.
// Returns {ok:true, found:false} (not an error) when gh is absent, not authed,
// or no PR exists for the branch.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT';

export interface PrLink {
    ok: boolean;
    found: boolean;
    number?: number;
    url?: string;
    title?: string;
    state?: PrState;
    headRefName?: string;
    reason?: string;
    error?: string;
}

// Resolve the current branch from a repo root. Returns null on failure.
async function currentBranch(root: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'],
            { windowsHide: true, maxBuffer: 256 * 1024 },
        );
        const b = stdout.trim();
        return b.length > 0 && b !== 'HEAD' ? b : null;
    } catch {
        return null;
    }
}

// Shell gh with the given args. Resolves even on spawn error or non-zero exit.
async function ghOut(
    args: string[],
    cwd?: string,
    timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let proc: ReturnType<typeof execFile>;
        try {
            proc = execFile('gh', args, {
                cwd,
                windowsHide: true,
                maxBuffer: 512 * 1024,
            });
        } catch (spawnErr) {
            // execFile itself threw synchronously; gh is absent or not executable
            resolve({
                stdout: '',
                stderr: spawnErr instanceof Error ? spawnErr.message : String(spawnErr),
                exitCode: 127,
            });
            return;
        }

        const timer = setTimeout(() => proc.kill('SIGTERM'), timeoutMs);

        proc.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
        proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });

        proc.on('error', (err) => {
            clearTimeout(timer);
            stderr += err.message;
            resolve({ stdout, stderr, exitCode: 1 });
        });

        proc.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });
    });
}

// Normalise raw gh state strings to our PrState union.
function normState(raw: string): PrState {
    const u = raw.toUpperCase();
    if (u === 'OPEN' || u === 'CLOSED' || u === 'MERGED' || u === 'DRAFT') {
        return u as PrState;
    }
    return 'OPEN';
}

// Shape returned by `gh pr view --json` and `gh pr list --json`.
interface GhPrJson {
    number?: number;
    url?: string;
    title?: string;
    state?: string;
    isDraft?: boolean;
    headRefName?: string;
}

function parsePr(raw: string): GhPrJson | null {
    try {
        const parsed = JSON.parse(raw);
        // gh pr list returns an array; gh pr view returns an object
        if (Array.isArray(parsed)) {
            return parsed.length > 0 ? (parsed[0] as GhPrJson) : null;
        }
        return parsed as GhPrJson;
    } catch {
        return null;
    }
}

// Derive PrState from the gh JSON, accounting for draft flag.
function prState(pr: GhPrJson): PrState {
    if (pr.isDraft) return 'DRAFT';
    return normState(pr.state ?? '');
}

/**
 * Find the GitHub PR for root + branch via the gh CLI.
 *
 * Strategy:
 *   1. Try `gh pr view --json` for the branch (works when the branch has a
 *      tracking remote and gh can find it in context).
 *   2. Fall back to `gh pr list --head <branch>` to handle detached or
 *      cross-fork scenarios.
 *
 * Never throws. All failure modes return ok:true, found:false with a reason,
 * except genuinely unexpected internal errors which return ok:false.
 */
export async function findPrLink(root: string, branch?: string): Promise<PrLink> {
    if (typeof root !== 'string' || root.trim().length === 0) {
        return { ok: false, found: false, error: 'root is required' };
    }

    // Resolve the branch name if the caller did not provide one.
    const resolvedBranch = branch?.trim() || (await currentBranch(root));
    if (!resolvedBranch) {
        return { ok: true, found: false, reason: 'could not resolve current branch' };
    }

    // Attempt 1: gh pr view
    const viewArgs = [
        'pr', 'view',
        '--json', 'number,url,title,state,isDraft,headRefName',
    ];
    const view = await ghOut(viewArgs, root);

    if (view.exitCode === 127 || /not found|executable/i.test(view.stderr)) {
        return { ok: true, found: false, reason: 'gh CLI not found on PATH' };
    }

    if (view.exitCode === 0 && view.stdout.trim().length > 0) {
        const pr = parsePr(view.stdout.trim());
        if (pr && typeof pr.number === 'number') {
            return {
                ok: true,
                found: true,
                number: pr.number,
                url: pr.url,
                title: pr.title,
                state: prState(pr),
                headRefName: pr.headRefName ?? resolvedBranch,
            };
        }
    }

    // gh pr view may fail with non-zero when not authed
    const noAuth =
        /authentication|auth login|401|not logged/i.test(view.stderr) ||
        /authentication|auth login|401|not logged/i.test(view.stdout);
    if (noAuth) {
        return { ok: true, found: false, reason: 'gh not authenticated; run: gh auth login' };
    }

    // Attempt 2: gh pr list --head <branch>
    const listArgs = [
        'pr', 'list',
        '--head', resolvedBranch,
        '--json', 'number,url,title,state,isDraft,headRefName',
        '--limit', '1',
    ];
    const list = await ghOut(listArgs, root);

    if (list.exitCode === 127) {
        return { ok: true, found: false, reason: 'gh CLI not found on PATH' };
    }

    const noAuthList =
        /authentication|auth login|401|not logged/i.test(list.stderr) ||
        /authentication|auth login|401|not logged/i.test(list.stdout);
    if (noAuthList) {
        return { ok: true, found: false, reason: 'gh not authenticated; run: gh auth login' };
    }

    if (list.exitCode === 0 && list.stdout.trim().length > 0) {
        const pr = parsePr(list.stdout.trim());
        if (pr && typeof pr.number === 'number') {
            return {
                ok: true,
                found: true,
                number: pr.number,
                url: pr.url,
                title: pr.title,
                state: prState(pr),
                headRefName: pr.headRefName ?? resolvedBranch,
            };
        }
        // List returned empty array
        return { ok: true, found: false, reason: `no open PR for branch: ${resolvedBranch}` };
    }

    // Any other non-zero from gh pr list
    if (list.exitCode !== 0) {
        const msg = (list.stderr || list.stdout).split('\n').slice(0, 3).join(' / ').trim();
        return { ok: true, found: false, reason: msg || `gh pr list exited ${list.exitCode}` };
    }

    return { ok: true, found: false, reason: `no PR for branch: ${resolvedBranch}` };
}
