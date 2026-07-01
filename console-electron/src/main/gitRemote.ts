// Derive a GitHub owner/name from a project's `origin` remote. Used by the
// handlers that talk to GitHub (issues, release CI gates, metrics CI status)
// so they target the PICKED project's repo, not a hardcoded one.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function nwoFromRemoteUrl(url: string): string | null {
    const m = url.trim().match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i);
    return m ? `${m[1]}/${m[2]}` : null;
}

// A repo string reaches `gh -R <repo>` from a git remote we don't fully control.
// Accept only owner/name; reject option-shaped values so a leading '-' can't be
// parsed as a flag (argument injection on the authenticated gh CLI).
export function isValidRepo(repo: string): boolean {
    return typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && !repo.startsWith('-');
}

export async function deriveRepo(projectRoot?: string): Promise<string | null> {
    if (!projectRoot) return null;
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['-C', projectRoot, 'remote', 'get-url', 'origin'],
            { windowsHide: true },
        );
        return nwoFromRemoteUrl(stdout);
    } catch {
        return null;
    }
}
