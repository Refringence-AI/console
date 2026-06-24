// console-electron/src/main/ipc/connections.ts
//
// Phase 3 "deploy wedge" — real service connections + live deploy data.
//
// GitHub reuses the user's existing `gh` CLI auth (same pattern as
// ipc/issues.ts) — we never store a GitHub token ourselves, we just record
// a Console-side "connected" flag + the login.
//
// Vercel uses a personal access token the user pastes in. The token is
// validated against the Vercel API, then handed to connections.setToken()
// which encrypts it via safeStorage. From then on the token lives only in
// the main process: it is read back per-request to talk to the Vercel API
// and is NEVER returned to the renderer or logged.
//
// Every handler is total: it try/catches and resolves {ok:false, error}
// rather than throwing across the IPC boundary.
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';

import {
    loadMeta,
    saveMeta,
    clearMeta,
    setToken,
    getToken,
    clearToken,
    type GithubMeta,
    type VercelMeta,
    type SentryMeta,
    type SlackMeta,
} from '../connections';
import { detectDeploy, deployProject, deploymentState, type DeploySettings } from './vercelDeploy';

// ── gh helper (copied small from ipc/issues.ts) ─────────────────────────
function runGh(args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const proc = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
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

// ── shared renderer-facing shapes (mirrored in bridge.ts) ───────────────
export interface ConnectionsList {
    github: GithubMeta;
    vercel: VercelMeta;
    sentry: SentryMeta;
    slack: SlackMeta;
}

export interface SentryIssue {
    id: string;
    title: string;
    culprit: string;
    level: string;
    count: number;
    lastSeen: string;
    permalink: string;
}

export interface VercelProject {
    id: string;
    name: string;
    framework: string | null;
}

export interface VercelDeployment {
    id: string;
    name: string;
    url: string;
    state: string;
    createdAt: number | null;
    target: string | null;
}

const VERCEL_API = 'https://api.vercel.com';
const SENTRY_API = 'https://sentry.io/api/0';
const SLACK_API = 'https://slack.com/api';

function authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

// Pull a human-usable message out of a Sentry error body without throwing.
function sentryErrorMessage(status: number, body: unknown): string {
    if (body && typeof body === 'object') {
        const detail = (body as { detail?: string }).detail;
        if (typeof detail === 'string' && detail.length > 0) return detail;
    }
    return `Sentry API returned HTTP ${status}`;
}

// Pull a human-usable message out of a Vercel error body without throwing.
function vercelErrorMessage(status: number, body: unknown): string {
    if (body && typeof body === 'object') {
        const err = (body as { error?: { message?: string } }).error;
        if (err?.message) return err.message;
    }
    return `Vercel API returned HTTP ${status}`;
}

// Slack returns 200 with { ok:false, error:'<code>' } for app errors, so the
// useful signal is the body's error code, not the HTTP status.
function slackErrorMessage(status: number, body: unknown): string {
    if (body && typeof body === 'object') {
        const err = (body as { error?: string }).error;
        if (typeof err === 'string' && err.length > 0) return `Slack: ${err}`;
    }
    return `Slack API returned HTTP ${status}`;
}

// Validate a Vercel token against the API, then encrypt + store it. Exported so
// the .env auto-connect can reuse the exact same validation + storage path.
export async function connectVercel(token: string): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (typeof token !== 'string' || token.trim().length === 0) {
        return { ok: false, error: 'A Vercel token is required.' };
    }
    const trimmed = token.trim();
    try {
        const res = await fetch(`${VERCEL_API}/v2/user`, { headers: authHeaders(trimmed) });
        if (!res.ok) {
            let body: unknown = null;
            try { body = await res.json(); } catch { /* ignore */ }
            return { ok: false, error: vercelErrorMessage(res.status, body) };
        }
        const data = await res.json() as { user?: { username?: string; name?: string } };
        const user = data.user?.username || data.user?.name || undefined;
        setToken('vercel', trimmed);
        saveMeta('vercel', { connected: true, user, connectedAt: new Date().toISOString() });
        return { ok: true, user };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function connectSentry(token: string, org: string): Promise<{ ok: boolean; user?: string; org?: string; error?: string }> {
    if (typeof token !== 'string' || token.trim().length === 0) {
        return { ok: false, error: 'A Sentry token is required.' };
    }
    const trimmedToken = token.trim();
    const trimmedOrg = typeof org === 'string' ? org.trim() : '';
    try {
        const res = await fetch(`${SENTRY_API}/`, { headers: authHeaders(trimmedToken) });
        if (!res.ok) {
            let body: unknown = null;
            try { body = await res.json(); } catch { /* ignore */ }
            return { ok: false, error: sentryErrorMessage(res.status, body) };
        }
        try { await res.json(); } catch { /* ignore */ }
        setToken('sentry', trimmedToken);
        const user = trimmedOrg || 'sentry';
        saveMeta('sentry', { connected: true, user, org: trimmedOrg || undefined, connectedAt: new Date().toISOString() });
        return { ok: true, user, org: trimmedOrg || undefined };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function connectSlack(token: string): Promise<{ ok: boolean; team?: string; user?: string; error?: string }> {
    if (typeof token !== 'string' || token.trim().length === 0) {
        return { ok: false, error: 'A Slack bot token is required.' };
    }
    const trimmed = token.trim();
    if (!trimmed.startsWith('xoxb-')) {
        return { ok: false, error: 'Expected a bot token starting with xoxb-.' };
    }
    try {
        const res = await fetch(`${SLACK_API}/auth.test`, { headers: authHeaders(trimmed) });
        const data = await res.json() as { ok?: boolean; error?: string; team?: string; user?: string };
        if (!res.ok || !data.ok) {
            return { ok: false, error: slackErrorMessage(res.status, data) };
        }
        setToken('slack', trimmed);
        const prior = loadMeta().slack;
        saveMeta('slack', {
            connected: true, team: data.team, user: data.user,
            connectedAt: new Date().toISOString(), channelTeams: prior?.channelTeams,
        });
        return { ok: true, team: data.team, user: data.user };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export function registerConnectionsHandlers(): void {
    // ── list ─────────────────────────────────────────────────────────────
    // Booleans + login/user only — NEVER tokens.
    ipcMain.handle('console:connections.list', async (): Promise<ConnectionsList> => {
        const meta = loadMeta();
        return {
            github: meta.github ?? { connected: false },
            vercel: meta.vercel ?? { connected: false },
            sentry: meta.sentry ?? { connected: false },
            slack: meta.slack ?? { connected: false },
        };
    });

    // ── GitHub: connect via existing gh auth ─────────────────────────────
    ipcMain.handle('console:connections.github.connect', async (): Promise<{ ok: boolean; login?: string; error?: string }> => {
        try {
            const status = await runGh(['auth', 'status'], 8_000);
            if (status.exitCode !== 0) {
                return { ok: false, error: 'Run: gh auth login' };
            }
            const who = await runGh(['api', 'user', '--jq', '.login'], 8_000);
            const login = who.exitCode === 0 ? who.stdout.trim() : '';
            const meta: GithubMeta = {
                connected: true,
                login: login || undefined,
                connectedAt: new Date().toISOString(),
            };
            saveMeta('github', meta);
            return { ok: true, login: login || undefined };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── GitHub: disconnect (drop Console flag; gh stays authed) ───────────
    ipcMain.handle('console:connections.github.disconnect', async (): Promise<{ ok: boolean; error?: string }> => {
        try {
            clearMeta('github');
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── Vercel: connect (validate token, then encrypt + store) ───────────
    ipcMain.handle('console:connections.vercel.connect', (_e, token: string) => connectVercel(token));

    // ── Vercel: disconnect (wipe token + flag) ───────────────────────────
    ipcMain.handle('console:connections.vercel.disconnect', async (): Promise<{ ok: boolean; error?: string }> => {
        try {
            clearToken('vercel');
            clearMeta('vercel');
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── Vercel: projects ─────────────────────────────────────────────────
    ipcMain.handle('console:connections.vercel.projects', async (): Promise<{ ok: boolean; projects?: VercelProject[]; error?: string }> => {
        const token = getToken('vercel');
        if (!token) return { ok: false, error: 'not connected' };
        try {
            const res = await fetch(`${VERCEL_API}/v9/projects?limit=20`, { headers: authHeaders(token) });
            if (!res.ok) {
                let body: unknown = null;
                try { body = await res.json(); } catch { /* ignore */ }
                return { ok: false, error: vercelErrorMessage(res.status, body) };
            }
            const data = await res.json() as { projects?: Array<{ id?: string; name?: string; framework?: string | null }> };
            const projects: VercelProject[] = (data.projects ?? []).map((p) => ({
                id: p.id ?? '',
                name: p.name ?? '(unnamed)',
                framework: p.framework ?? null,
            }));
            return { ok: true, projects };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── Vercel: deployments ──────────────────────────────────────────────
    ipcMain.handle('console:connections.vercel.deployments', async (_e, projectId?: string): Promise<{ ok: boolean; deployments?: VercelDeployment[]; error?: string }> => {
        const token = getToken('vercel');
        if (!token) return { ok: false, error: 'not connected' };
        try {
            const params = new URLSearchParams({ limit: '10' });
            if (typeof projectId === 'string' && projectId.length > 0) {
                params.set('projectId', projectId);
            }
            const res = await fetch(`${VERCEL_API}/v6/deployments?${params.toString()}`, { headers: authHeaders(token) });
            if (!res.ok) {
                let body: unknown = null;
                try { body = await res.json(); } catch { /* ignore */ }
                return { ok: false, error: vercelErrorMessage(res.status, body) };
            }
            const data = await res.json() as {
                deployments?: Array<{
                    uid?: string; name?: string; url?: string;
                    state?: string; readyState?: string;
                    created?: number; createdAt?: number; target?: string | null;
                }>;
            };
            const deployments: VercelDeployment[] = (data.deployments ?? []).map((d) => ({
                id: d.uid ?? '',
                name: d.name ?? '',
                url: d.url ?? '',
                state: d.readyState ?? d.state ?? 'UNKNOWN',
                createdAt: d.created ?? d.createdAt ?? null,
                target: d.target ?? null,
            }));
            return { ok: true, deployments };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── Vercel: redeploy an existing deployment ──────────────────────────
    // POST /v13/deployments with { name, deploymentId, target } re-runs an
    // existing deployment. The redeploy shape is the part I'm least sure of
    // (see report), so this is defensive: any non-2xx returns {ok:false}.
    ipcMain.handle(
        'console:connections.vercel.redeploy',
        async (_e, projectId: string, deploymentId: string): Promise<{ ok: boolean; deployment?: { id: string; url: string; state: string }; error?: string }> => {
            const token = getToken('vercel');
            if (!token) return { ok: false, error: 'not connected' };
            if (typeof deploymentId !== 'string' || deploymentId.length === 0) {
                return { ok: false, error: 'deploymentId is required' };
            }
            try {
                const res = await fetch(`${VERCEL_API}/v13/deployments`, {
                    method: 'POST',
                    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: projectId,
                        deploymentId,
                        target: 'production',
                    }),
                });
                let body: unknown = null;
                try { body = await res.json(); } catch { /* ignore */ }
                if (!res.ok) {
                    return { ok: false, error: vercelErrorMessage(res.status, body) };
                }
                const d = (body ?? {}) as { id?: string; uid?: string; url?: string; readyState?: string; state?: string };
                return {
                    ok: true,
                    deployment: {
                        id: d.id ?? d.uid ?? '',
                        url: d.url ?? '',
                        state: d.readyState ?? d.state ?? 'QUEUED',
                    },
                };
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    // ── Vercel: zero-config deploy (create project + deploy from source) ──
    // detectDeploy infers framework/build from the project; deploy uploads the
    // source (no deps/build/secrets) and creates a deployment - the `name`
    // field creates the project on first deploy. Works with nothing wired.
    ipcMain.handle('console:connections.vercel.detectDeploy', async (_e, projectRoot: string) => {
        try {
            if (!projectRoot) return { ok: false, error: 'no project selected' };
            return { ok: true, settings: detectDeploy(projectRoot) };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
    ipcMain.handle('console:connections.vercel.deploy', async (_e, projectRoot: string, settings: DeploySettings) => {
        const token = getToken('vercel');
        if (!token) return { ok: false, error: 'not connected' };
        if (!projectRoot) return { ok: false, error: 'no project selected' };
        try {
            const deployment = await deployProject(token, projectRoot, settings);
            return { ok: true, deployment };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
    ipcMain.handle('console:connections.vercel.deployState', async (_e, id: string) => {
        const token = getToken('vercel');
        if (!token) return { ok: false, error: 'not connected' };
        if (!id) return { ok: false, error: 'deployment id required' };
        try {
            return { ok: true, ...(await deploymentState(token, id)) };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── Sentry: connect (validate token + org, then encrypt + store) ─────
    ipcMain.handle('console:connections.sentry.connect', (_e, token: string, org: string) => connectSentry(token, org));

    // ── Sentry: disconnect (wipe token + flag) ───────────────────────────
    ipcMain.handle('console:connections.sentry.disconnect', async (): Promise<{ ok: boolean; error?: string }> => {
        try {
            clearToken('sentry');
            clearMeta('sentry');
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── Sentry: recent unresolved issues ─────────────────────────────────
    ipcMain.handle('console:connections.sentry.issues', async (): Promise<{ ok: boolean; issues?: SentryIssue[]; error?: string }> => {
        const token = getToken('sentry');
        if (!token) return { ok: false, error: 'not connected' };
        const meta = loadMeta().sentry;
        const org = meta?.org;
        if (!org) return { ok: false, error: 'no organization on record; reconnect Sentry' };
        try {
            const url = `${SENTRY_API}/organizations/${encodeURIComponent(org)}/issues/?query=is:unresolved&statsPeriod=24h&limit=10`;
            const res = await fetch(url, { headers: authHeaders(token) });
            if (!res.ok) {
                let body: unknown = null;
                try { body = await res.json(); } catch { /* ignore */ }
                return { ok: false, error: sentryErrorMessage(res.status, body) };
            }
            const data = await res.json() as Array<{
                id?: string; title?: string; culprit?: string; level?: string;
                count?: string | number; lastSeen?: string; permalink?: string;
            }>;
            const issues: SentryIssue[] = (Array.isArray(data) ? data : []).map((i) => ({
                id: i.id ?? '',
                title: i.title ?? '(untitled)',
                culprit: i.culprit ?? '',
                level: i.level ?? 'error',
                count: typeof i.count === 'string' ? Number.parseInt(i.count, 10) || 0 : (i.count ?? 0),
                lastSeen: i.lastSeen ?? '',
                permalink: i.permalink ?? '',
            }));
            return { ok: true, issues };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── Slack: connect (validate an xoxb bot token via auth.test) ────────
    // A bot token must start with "xoxb-"; we reject anything else before
    // touching the network so an obviously-wrong paste fails fast. auth.test
    // confirms the token and returns the team + bot user for the meta store.
    ipcMain.handle('console:connections.slack.connect', (_e, token: string) => connectSlack(token));

    // ── Slack: disconnect (wipe token + flag, keep nothing secret) ───────
    ipcMain.handle('console:connections.slack.disconnect', async (): Promise<{ ok: boolean; error?: string }> => {
        try {
            clearToken('slack');
            clearMeta('slack');
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
}
