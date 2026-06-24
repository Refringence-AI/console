// console-electron/src/main/ipc/slack.ts
//
// Slack issue-pull IPC (Phase P6). The bot token lives encrypted in
// safeStorage via ../connections.ts; this module reads it back per-request
// to talk to the Slack Web API and NEVER returns it (or any token) to the
// renderer.
//
// Three handlers feed the Workboard's "Slack" source:
//   - slack.channels()     list of conversations the bot can see, cached.
//   - slack.setChannelTeam channelId -> {tech, nontech, test} persisted in
//                          the non-secret meta store so the board can group.
//   - slack.issues()       recent messages from the mapped channels that
//                          look like issues/bugs/blockers, normalized to a
//                          gh-issue-like shape.
//
// Rate limits: Slack Tier-3 methods (conversations.list / .history) allow
// roughly 50 req/min. A module-level ~1 req/s throttle serializes every
// call through this file so a multi-channel pull stays inside that budget,
// and a per-channel lastTs cache means each refresh only asks for messages
// newer than the last one we saw.
import { ipcMain } from 'electron';

import {
    loadMeta,
    saveMeta,
    getToken,
    type SlackMeta,
    type SlackTeam,
} from '../connections';

const SLACK_API = 'https://slack.com/api';
const SLACK_TEAMS: SlackTeam[] = ['tech', 'nontech', 'test'];

// Keywords that mark a message as worth surfacing as an issue. Lowercased
// substring match; kept short so the filter stays predictable.
const ISSUE_KEYWORDS = [
    'bug', 'issue', 'broken', 'blocker', 'blocked', 'error', 'crash',
    'fail', 'failing', 'regression', 'down', 'cannot', "can't", 'not working',
];

const SEVERITY_KEYWORDS: Array<{ severity: string; words: string[] }> = [
    { severity: 'critical', words: ['critical', 'urgent', 'p0', 'down', 'outage', 'crash', 'blocker'] },
    { severity: 'high', words: ['high', 'p1', 'broken', 'regression', 'failing'] },
];

export interface SlackChannel {
    id: string;
    name: string;
    isPrivate: boolean;
    team: SlackTeam | null;
}

export interface SlackIssue {
    id: string;
    title: string;
    team: SlackTeam;
    channel: string;
    user: string;
    ts: string;
    permalink: string;
    severity?: string;
}

// ── ~1 req/s throttle ───────────────────────────────────────────────────
// A single in-flight chain: each scheduled call resolves at least 1s after
// the previous one started, so bursts (e.g. one history call per channel)
// are spread out instead of fired at once.
const MIN_REQUEST_GAP_MS = 1_000;
let lastRequestAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
    const run = throttleChain.then(async () => {
        const now = Date.now();
        const wait = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - now);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastRequestAt = Date.now();
    });
    // Keep the chain alive even if a caller's downstream work rejects.
    throttleChain = run.catch(() => undefined);
    return run;
}

async function slackGet(token: string, method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    await throttle();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${SLACK_API}/${method}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as Record<string, unknown>;
    return data;
}

// ── caches ──────────────────────────────────────────────────────────────
interface ChannelCacheEntry { at: number; channels: SlackChannel[] }
let channelCache: ChannelCacheEntry | null = null;
const CHANNEL_CACHE_MS = 60_000;

// channelId -> last message ts we ingested, so each issues() only pulls the
// tail. In-memory: a restart re-pulls the recent window, which is fine.
const lastTsByChannel = new Map<string, string>();

function loadSlackMeta(): SlackMeta {
    return loadMeta().slack ?? { connected: false };
}

function channelTeam(channelId: string, meta: SlackMeta): SlackTeam | null {
    const map = meta.channelTeams ?? {};
    const team = map[channelId];
    return team && SLACK_TEAMS.includes(team) ? team : null;
}

function looksLikeIssue(text: string): boolean {
    const lower = text.toLowerCase();
    return ISSUE_KEYWORDS.some((k) => lower.includes(k));
}

function inferSeverity(text: string): string | undefined {
    const lower = text.toLowerCase();
    for (const { severity, words } of SEVERITY_KEYWORDS) {
        if (words.some((w) => lower.includes(w))) return severity;
    }
    return undefined;
}

// First non-empty line, trimmed to a card-sized title.
function deriveTitle(text: string): string {
    const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
    const clean = firstLine.replace(/\s+/g, ' ').trim();
    return clean.length > 140 ? `${clean.slice(0, 137)}...` : (clean || '(no text)');
}

export function registerSlackHandlers(): void {
    // ── channels: list conversations the bot can see (cached ~60s) ───────
    ipcMain.handle('console:slack.channels', async (): Promise<{ ok: boolean; channels?: SlackChannel[]; error?: string }> => {
        const token = getToken('slack');
        if (!token) return { ok: false, error: 'not connected' };
        if (channelCache && Date.now() - channelCache.at < CHANNEL_CACHE_MS) {
            return { ok: true, channels: channelCache.channels };
        }
        try {
            const meta = loadSlackMeta();
            const out: SlackChannel[] = [];
            let cursor = '';
            // Bound the pagination so a huge workspace can't loop forever.
            for (let page = 0; page < 10; page += 1) {
                const params: Record<string, string> = {
                    limit: '200',
                    exclude_archived: 'true',
                    types: 'public_channel,private_channel',
                };
                if (cursor) params.cursor = cursor;
                const data = await slackGet(token, 'conversations.list', params);
                if (data.ok !== true) {
                    return { ok: false, error: `Slack: ${String(data.error ?? 'conversations.list failed')}` };
                }
                const channels = Array.isArray(data.channels) ? data.channels as Array<Record<string, unknown>> : [];
                for (const c of channels) {
                    const id = typeof c.id === 'string' ? c.id : '';
                    if (!id) continue;
                    out.push({
                        id,
                        name: typeof c.name === 'string' ? c.name : id,
                        isPrivate: c.is_private === true,
                        team: channelTeam(id, meta),
                    });
                }
                const next = (data.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? '';
                if (!next) break;
                cursor = next;
            }
            channelCache = { at: Date.now(), channels: out };
            return { ok: true, channels: out };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── setChannelTeam: persist channel -> team into the non-secret store ─
    ipcMain.handle('console:slack.setChannelTeam', async (_e, channelId: string, team: string): Promise<{ ok: boolean; error?: string }> => {
        if (typeof channelId !== 'string' || channelId.length === 0) {
            return { ok: false, error: 'channelId is required' };
        }
        try {
            const meta = loadSlackMeta();
            const channelTeams: Record<string, SlackTeam> = { ...(meta.channelTeams ?? {}) };
            if (team === 'none' || team === '') {
                delete channelTeams[channelId];
            } else if (SLACK_TEAMS.includes(team as SlackTeam)) {
                channelTeams[channelId] = team as SlackTeam;
            } else {
                return { ok: false, error: `unknown team: ${team}` };
            }
            saveMeta('slack', { ...meta, connected: meta.connected, channelTeams });
            // Channel listing now carries stale team tags; drop the cache.
            channelCache = null;
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // ── issues: pull recent issue-shaped messages from mapped channels ───
    ipcMain.handle('console:slack.issues', async (): Promise<{ ok: boolean; issues?: SlackIssue[]; error?: string }> => {
        const token = getToken('slack');
        if (!token) return { ok: false, error: 'not connected' };
        const meta = loadSlackMeta();
        const mapped = Object.entries(meta.channelTeams ?? {})
            .filter(([, t]) => SLACK_TEAMS.includes(t))
            .map(([id, t]) => ({ id, team: t }));
        if (mapped.length === 0) {
            // No channels assigned yet: an empty pull, not an error.
            return { ok: true, issues: [] };
        }

        const channelName = new Map<string, string>();
        for (const c of channelCache?.channels ?? []) channelName.set(c.id, c.name);

        const issues: SlackIssue[] = [];
        try {
            for (const { id: channelId, team } of mapped) {
                const params: Record<string, string> = { channel: channelId, limit: '50' };
                const sinceTs = lastTsByChannel.get(channelId);
                if (sinceTs) params.oldest = sinceTs;
                const data = await slackGet(token, 'conversations.history', params);
                if (data.ok !== true) {
                    // Skip a single unreadable channel rather than failing the
                    // whole pull (e.g. the bot was removed from one channel).
                    continue;
                }
                const messages = Array.isArray(data.messages) ? data.messages as Array<Record<string, unknown>> : [];
                let newestTs = sinceTs ?? '';
                for (const m of messages) {
                    const ts = typeof m.ts === 'string' ? m.ts : '';
                    const text = typeof m.text === 'string' ? m.text : '';
                    if (ts && (newestTs === '' || Number(ts) > Number(newestTs))) newestTs = ts;
                    // Ignore the bot's own posts, joins/leaves, and empty text.
                    if (typeof m.subtype === 'string' && m.subtype.length > 0) continue;
                    if (!text || !looksLikeIssue(text)) continue;
                    issues.push({
                        id: `${channelId}:${ts}`,
                        title: deriveTitle(text),
                        team,
                        channel: channelName.get(channelId) ?? channelId,
                        user: typeof m.user === 'string' ? m.user : 'unknown',
                        ts,
                        permalink: '',
                        severity: inferSeverity(text),
                    });
                }
                if (newestTs) lastTsByChannel.set(channelId, newestTs);
            }
            // Newest first across all channels.
            issues.sort((a, b) => Number(b.ts) - Number(a.ts));
            return { ok: true, issues };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
}
