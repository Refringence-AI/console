// console-electron/src/main/connectors/registry.ts
//
// The connector platform: a declarative registry of services the user can
// connect with a single credential, plus a small engine that drives
// validate + usage from each spec. Most providers are fully declarative
// (a validate GET + a usage GET with JSON-path metrics); the few that need
// two calls or GraphQL provide a custom function instead.
//
// tokenSource picks where the credential lives:
//   'connector'   - this layer's own encrypted store (store.ts)
//   'connections' - reuse a token already stored by ../connections.ts
//                   (Vercel / Sentry connect in the Services flow; here we
//                   only layer a usage dashboard on top)
import { getConnectorToken } from './store';
import { getToken as getConnectionToken, loadMeta as loadConnectionsMeta } from '../connections';
import { assertSafeExternalUrl, isUrlExtraKey } from './urlGuard';
import type { OAuthConfig } from './oauth-loopback';

export type UsageFormat = 'usd' | 'number' | 'fraction' | 'percent' | 'text' | 'bytes';
export type ConnectorTokenSource = 'connector' | 'connections';

export interface ExtraField {
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
}

export interface UsageMetricSpec {
    label: string;
    jsonPath: string;
    format: UsageFormat;
    denomPath?: string;
    sub?: string;
}

// Renderer-facing rendered metric (NO raw token ever rides along).
export interface UsageMetric {
    label: string;
    value: string;
    sub?: string;
    tone?: 'default' | 'good' | 'warn' | 'bad';
}

export interface UsageReport {
    ok: boolean;
    metrics?: UsageMetric[];
    asOf?: string;
    note?: string;
    manageUrl?: string;
    error?: string;
}

export interface ConnectorSpec {
    id: string;
    name: string;
    category: string;
    blurb: string;
    tokenSource: ConnectorTokenSource;
    auth: {
        scheme: 'bearer' | 'header';
        headerName?: string;
        extraHeaders?: Record<string, string>;
        tokenLabel: string;
        tokenPlaceholder: string;
        howToGet?: string;
        extraFields?: ExtraField[];
    };
    validate: { method?: string; url: string; accountField?: string };
    usage?: { method?: string; url: string; metrics: UsageMetricSpec[] };
    manageUrl?: string;
    // Overrides for providers that can't be expressed declaratively.
    customValidate?: (token: string, extra: Record<string, string>) => Promise<{ ok: boolean; account?: string; error?: string }>;
    customUsage?: (token: string, extra: Record<string, string>) => Promise<UsageReport>;
    // Side-effecting actions the user can run against the connected account
    // (deploy, purge, ...). Each runs with the stored token; the renderer confirms
    // any `danger` action first. The raw token never leaves the main process.
    actions?: ConnectorActionSpec[];
    // When present, the connector can be connected via an OAuth loopback flow
    // instead of pasting a token. Requires a registered client id per provider.
    oauth?: OAuthConfig;
}

export interface ConnectorActionResult { ok: boolean; message?: string; url?: string; error?: string }
export interface ConnectorActionSpec {
    id: string;
    label: string;
    description?: string;
    danger?: boolean;
    run: (token: string, extra: Record<string, string>) => Promise<ConnectorActionResult>;
}
// Renderer-facing (no run function).
export interface ConnectorActionDef { id: string; label: string; description?: string; danger?: boolean }

// Renderer-facing catalog entry (no functions, no secrets).
export interface ConnectorCatalogEntry {
    id: string;
    name: string;
    category: string;
    blurb: string;
    tokenSource: ConnectorTokenSource;
    tokenLabel: string;
    tokenPlaceholder: string;
    howToGet?: string;
    extraFields: ExtraField[];
    hasUsage: boolean;
    manageUrl?: string;
    actions: ConnectorActionDef[];
    hasOauth: boolean;
}

export interface ConnectorStatus {
    id: string;
    connected: boolean;
    account?: string;
    connectedAt?: string;
}

// SC-6: a live health probe so a dead or throttled connector is an honest named
// state, not a silent fail. 'ok' = the stored credential still authenticates;
// the rest classify why it does not.
export type ConnectorHealthState = 'ok' | 'unauthorized' | 'throttled' | 'unreachable' | 'error' | 'not-connected';
export interface ConnectorHealth {
    id: string;
    state: ConnectorHealthState;
    account?: string;
    detail?: string;
    checkedAt: string;
}

// ── engine ──────────────────────────────────────────────────────────────

function interp(url: string, extra: Record<string, string>): string {
    return url.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(extra[k] ?? ''));
}

// Defence in depth: re-assert that any URL-shaped extra is a safe external URL
// before it is interpolated into a request the credential rides along with.
// Connect-time sanitizeExtra already enforces this, but a host could have been
// persisted before this guard existed; throws UnsafeUrlError if not safe.
function guardExtraUrls(extra: Record<string, string>): void {
    for (const [k, v] of Object.entries(extra)) {
        if (isUrlExtraKey(k) && typeof v === 'string' && v.length > 0) assertSafeExternalUrl(v, k);
    }
}

function buildHeaders(spec: ConnectorSpec, token: string): Record<string, string> {
    const h: Record<string, string> = { ...(spec.auth.extraHeaders ?? {}) };
    if (spec.auth.scheme === 'bearer') h.Authorization = `Bearer ${token}`;
    else if (spec.auth.headerName) h[spec.auth.headerName] = token;
    return h;
}

function dig(obj: unknown, dotPath?: string): unknown {
    if (!dotPath) return undefined;
    return dotPath.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function num(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

export function formatMetric(value: unknown, format: UsageFormat, denom?: unknown): { value: string; tone: UsageMetric['tone'] } {
    const n = num(value);
    switch (format) {
        case 'usd':
            return { value: n == null ? '—' : `$${n.toFixed(2)}`, tone: 'default' };
        case 'bytes':
            return { value: n == null ? '—' : fmtBytes(n), tone: 'default' };
        case 'percent': {
            const d = num(denom);
            if (n == null) return { value: '—', tone: 'default' };
            const pct = d && d > 0 ? Math.round((n / d) * 100) : Math.round(n);
            return { value: `${pct}%`, tone: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good' };
        }
        case 'fraction': {
            const d = num(denom);
            if (n == null) return { value: '—', tone: 'default' };
            const used = n.toLocaleString();
            if (d == null) return { value: used, tone: 'default' };
            const pct = d > 0 ? (n / d) * 100 : 0;
            return { value: `${used} / ${d.toLocaleString()}`, tone: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good' };
        }
        case 'number':
            return { value: n == null ? '—' : n.toLocaleString(), tone: 'default' };
        case 'text':
        default:
            return { value: value == null || value === '' ? '—' : String(value), tone: 'default' };
    }
}

async function readBody(res: Response): Promise<unknown> {
    try { return await res.json(); } catch { return null; }
}

function httpError(name: string, status: number, body: unknown): string {
    if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        const msg = (b.error as { message?: string })?.message
            ?? (typeof b.error === 'string' ? b.error : undefined)
            ?? (typeof b.message === 'string' ? b.message : undefined)
            ?? (typeof b.detail === 'string' ? b.detail : undefined);
        if (msg) return `${name}: ${msg}`;
    }
    return `${name} API returned HTTP ${status}`;
}

export async function validateConnector(spec: ConnectorSpec, token: string, extra: Record<string, string>): Promise<{ ok: boolean; account?: string; error?: string }> {
    if (spec.customValidate) return spec.customValidate(token, extra);
    try {
        guardExtraUrls(extra);
        const res = await fetch(interp(spec.validate.url, extra), {
            method: spec.validate.method ?? 'GET',
            headers: buildHeaders(spec, token),
        });
        if (!res.ok) return { ok: false, error: httpError(spec.name, res.status, await readBody(res)) };
        const body = await readBody(res);
        const acct = spec.validate.accountField ? dig(body, spec.validate.accountField) : undefined;
        const account = acct == null || acct === '' ? undefined : String(acct);
        return { ok: true, account };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// Probe a connected credential and classify the result into a named state.
// Reuses the validate endpoint but reads the HTTP status directly so 401/403 vs
// 429 vs a network failure are distinguishable (httpError hides the status).
export async function probeConnectorHealth(spec: ConnectorSpec, token: string, extra: Record<string, string>): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    // Connectors with only a custom validator can not expose a status code; map
    // its ok/not-ok onto ok/error and keep the message as the detail.
    if (spec.customValidate || !spec.validate?.url) {
        try {
            const v = await validateConnector(spec, token, extra);
            return { id: spec.id, state: v.ok ? 'ok' : 'error', account: v.account, detail: v.ok ? undefined : v.error, checkedAt };
        } catch (err) {
            return { id: spec.id, state: 'unreachable', detail: err instanceof Error ? err.message : String(err), checkedAt };
        }
    }
    try {
        guardExtraUrls(extra);
        const res = await fetch(interp(spec.validate.url, extra), {
            method: spec.validate.method ?? 'GET',
            headers: buildHeaders(spec, token),
        });
        if (res.ok) {
            const body = await readBody(res);
            const acct = spec.validate.accountField ? dig(body, spec.validate.accountField) : undefined;
            return { id: spec.id, state: 'ok', account: acct == null || acct === '' ? undefined : String(acct), checkedAt };
        }
        const state: ConnectorHealthState = res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'throttled' : 'error';
        return { id: spec.id, state, detail: httpError(spec.name, res.status, await readBody(res)), checkedAt };
    } catch (err) {
        return { id: spec.id, state: 'unreachable', detail: err instanceof Error ? err.message : String(err), checkedAt };
    }
}

export async function usageConnector(spec: ConnectorSpec, token: string, extra: Record<string, string>): Promise<UsageReport> {
    if (spec.customUsage) return spec.customUsage(token, extra);
    if (!spec.usage) return { ok: false, error: 'no usage endpoint for this connector' };
    try {
        guardExtraUrls(extra);
        const res = await fetch(interp(spec.usage.url, extra), {
            method: spec.usage.method ?? 'GET',
            headers: buildHeaders(spec, token),
        });
        if (!res.ok) return { ok: false, error: httpError(spec.name, res.status, await readBody(res)) };
        const body = await readBody(res);
        const metrics: UsageMetric[] = spec.usage.metrics.map((m) => {
            const f = formatMetric(dig(body, m.jsonPath), m.format, dig(body, m.denomPath));
            return { label: m.label, value: f.value, sub: m.sub, tone: f.tone };
        });
        return { ok: true, metrics, asOf: new Date().toISOString(), manageUrl: spec.manageUrl };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// Resolve a connector's token from whichever store owns it.
export async function executeConnectorAction(spec: ConnectorSpec, actionId: string, token: string, extra: Record<string, string>): Promise<ConnectorActionResult> {
    const action = (spec.actions ?? []).find((a) => a.id === actionId);
    if (!action) return { ok: false, error: 'Unknown action.' };
    try {
        return await action.run(token, extra);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export function resolveToken(spec: ConnectorSpec): string | null {
    if (spec.tokenSource === 'connections') {
        // Only the two existing connection providers expose a stored token.
        if (spec.id === 'vercel' || spec.id === 'sentry') return getConnectionToken(spec.id);
        return null;
    }
    return getConnectorToken(spec.id);
}

// ── usage-only adapters for the existing Vercel / Sentry connections ──────

async function vercelUsage(token: string): Promise<UsageReport> {
    try {
        const headers = { Authorization: `Bearer ${token}` };
        const [pRes, dRes] = await Promise.all([
            fetch('https://api.vercel.com/v9/projects?limit=100', { headers }),
            fetch('https://api.vercel.com/v6/deployments?limit=100', { headers }),
        ]);
        if (!pRes.ok) return { ok: false, error: httpError('Vercel', pRes.status, await readBody(pRes)) };
        const projects = (await readBody(pRes)) as { projects?: unknown[] };
        const deploys = dRes.ok ? ((await readBody(dRes)) as { deployments?: { created?: number }[] }) : { deployments: [] };
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recent = (deploys.deployments ?? []).filter((d) => (d.created ?? 0) >= weekAgo).length;
        return {
            ok: true,
            asOf: new Date().toISOString(),
            manageUrl: 'https://vercel.com/dashboard/usage',
            metrics: [
                { label: 'Projects', value: String((projects.projects ?? []).length) },
                { label: 'Deploys 7d', value: String(recent) },
            ],
        };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

async function sentryUsage(token: string): Promise<UsageReport> {
    const org = loadConnectionsMeta().sentry?.org;
    if (!org) return { ok: false, error: 'no organization on record; reconnect Sentry' };
    try {
        const headers = { Authorization: `Bearer ${token}` };
        const issuesUrl = `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/issues/?query=is:unresolved&statsPeriod=24h&limit=100`;
        const res = await fetch(issuesUrl, { headers });
        if (!res.ok) return { ok: false, error: httpError('Sentry', res.status, await readBody(res)) };
        const issues = (await readBody(res)) as unknown[];
        const open = Array.isArray(issues) ? issues.length : 0;
        return {
            ok: true,
            asOf: new Date().toISOString(),
            manageUrl: `https://sentry.io/organizations/${encodeURIComponent(org)}/issues/`,
            metrics: [
                { label: 'Unresolved 24h', value: String(open), tone: open > 0 ? 'warn' : 'good' },
            ],
        };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// ── usage for new connectors that need >1 call or non-JSON-path logic ─────

async function netlifyUsage(token: string): Promise<UsageReport> {
    const headers = { Authorization: `Bearer ${token}` };
    try {
        const userRes = await fetch('https://api.netlify.com/api/v1/user', { headers });
        if (!userRes.ok) return { ok: false, error: httpError('Netlify', userRes.status, await readBody(userRes)) };
        const user = (await readBody(userRes)) as { site_count?: number };
        const metrics: UsageMetric[] = [{ label: 'Sites', value: String(user.site_count ?? 0) }];
        // Bandwidth is account-scoped: list teams -> take the first slug -> read its bandwidth.
        try {
            const accRes = await fetch('https://api.netlify.com/api/v1/accounts', { headers });
            const accounts = accRes.ok ? ((await readBody(accRes)) as { slug?: string }[]) : [];
            const slug = accounts[0]?.slug;
            if (slug) {
                const bwRes = await fetch(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(slug)}/bandwidth`, { headers });
                if (bwRes.ok) {
                    const bw = (await readBody(bwRes)) as { used?: number; included?: number };
                    const used = num(bw.used) ?? 0;
                    const inc = num(bw.included);
                    const pct = inc && inc > 0 ? (used / inc) * 100 : 0;
                    metrics.push({
                        label: 'Bandwidth',
                        value: inc ? `${fmtBytes(used)} / ${fmtBytes(inc)}` : fmtBytes(used),
                        tone: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good',
                    });
                }
            }
        } catch { /* bandwidth is best-effort */ }
        return { ok: true, metrics, asOf: new Date().toISOString(), manageUrl: 'https://app.netlify.com' };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// Neon consumption only populates on paid plans; fall back to a project count.
async function neonUsage(token: string): Promise<UsageReport> {
    const headers = { Authorization: `Bearer ${token}` };
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const from = start.toISOString();
    const to = new Date().toISOString();
    try {
        const url = `https://console.neon.tech/api/v2/consumption_history/account?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=monthly`;
        const res = await fetch(url, { headers });
        if (res.ok) {
            const body = (await readBody(res)) as { periods?: { consumption?: { compute_time_seconds?: number; synthetic_storage_size_bytes?: number; written_data_bytes?: number }[] }[] };
            const c = body.periods?.[0]?.consumption?.[0];
            if (c && ((c.compute_time_seconds ?? 0) > 0 || (c.synthetic_storage_size_bytes ?? 0) > 0)) {
                return {
                    ok: true, asOf: new Date().toISOString(), manageUrl: 'https://console.neon.tech',
                    metrics: [
                        { label: 'Compute (s)', value: (c.compute_time_seconds ?? 0).toLocaleString() },
                        { label: 'Storage', value: fmtBytes(c.synthetic_storage_size_bytes ?? 0) },
                        { label: 'Data written', value: fmtBytes(c.written_data_bytes ?? 0) },
                    ],
                };
            }
        }
        const pRes = await fetch('https://console.neon.tech/api/v2/projects', { headers });
        if (pRes.ok) {
            const p = (await readBody(pRes)) as { projects?: unknown[] };
            return {
                ok: true, asOf: new Date().toISOString(), manageUrl: 'https://console.neon.tech',
                note: 'Consumption metrics need a paid plan; showing project count.',
                metrics: [{ label: 'Projects', value: String((p.projects ?? []).length) }],
            };
        }
        return { ok: false, error: 'could not read Neon usage' };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// Railway is GraphQL-only; auth failures come back as 200 + an errors array.
async function railwayGraphql(token: string, query: string): Promise<{ data?: unknown; error?: string }> {
    const res = await fetch('https://backboard.railway.com/graphql/v2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const body = (await readBody(res)) as { data?: unknown; errors?: { message?: string }[] };
    if (!res.ok) return { error: httpError('Railway', res.status, body) };
    if (body?.errors?.length) return { error: `Railway: ${body.errors[0]?.message ?? 'request failed'}` };
    return { data: body?.data };
}

async function railwayValidate(token: string): Promise<{ ok: boolean; account?: string; error?: string }> {
    const r = await railwayGraphql(token, 'query { me { email name } }');
    if (r.error) return { ok: false, error: r.error };
    const me = (r.data as { me?: { email?: string; name?: string } })?.me;
    if (!me) return { ok: false, error: 'Railway: this token is not account-scoped (use an Account token).' };
    return { ok: true, account: me.email || me.name };
}

async function railwayUsage(token: string): Promise<UsageReport> {
    const r = await railwayGraphql(token, 'query { me { projects { edges { node { id } } } } }');
    if (r.error) return { ok: false, error: r.error };
    const edges = (r.data as { me?: { projects?: { edges?: unknown[] } } })?.me?.projects?.edges ?? [];
    return {
        ok: true, asOf: new Date().toISOString(), manageUrl: 'https://railway.com/dashboard',
        metrics: [{ label: 'Projects', value: String(edges.length) }],
    };
}

// PostHog exposes no spend; the honest signal is which resources are over quota.
async function posthogUsage(token: string, extra: Record<string, string>): Promise<UsageReport> {
    const host = (extra.host || 'https://us.posthog.com').replace(/\/+$/, '');
    const headers = { Authorization: `Bearer ${token}` };
    try {
        // Renderer-controlled host; the token below is sent to it, so SSRF-guard it.
        assertSafeExternalUrl(host, 'Region host');
        const meRes = await fetch(`${host}/api/users/@me/`, { headers });
        if (!meRes.ok) return { ok: false, error: httpError('PostHog', meRes.status, await readBody(meRes)) };
        const me = (await readBody(meRes)) as { team?: { id?: number } };
        const projectId = me.team?.id;
        const manageUrl = `${host}/organization/billing`;
        if (!projectId) return { ok: true, metrics: [{ label: 'Status', value: 'Connected' }], asOf: new Date().toISOString(), manageUrl };
        const qRes = await fetch(`${host}/api/projects/${projectId}/quota_limits/`, { headers });
        if (!qRes.ok) return { ok: true, metrics: [{ label: 'Status', value: 'Connected' }], asOf: new Date().toISOString(), manageUrl };
        const q = (await readBody(qRes)) as Record<string, { limited?: boolean } | boolean>;
        const over = Object.entries(q).filter(([, v]) => (typeof v === 'object' ? v?.limited : v)).map(([k]) => k);
        return {
            ok: true, asOf: new Date().toISOString(), manageUrl,
            metrics: [{
                label: 'Quota',
                value: over.length ? `${over.length} over limit` : 'Within limits',
                tone: over.length ? 'warn' : 'good',
                sub: over.length ? over.join(', ') : undefined,
            }],
        };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// ── Cloudflare / Render / Datadog (flo101 stack) ──────────────────────────

async function cloudflareValidate(token: string): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
        const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return { ok: false, error: httpError('Cloudflare', res.status, await readBody(res)) };
        const body = (await readBody(res)) as { success?: boolean; result?: { status?: string } };
        return body.success && body.result?.status === 'active'
            ? { ok: true, account: 'Cloudflare token' }
            : { ok: false, error: 'Token is not active.' };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

async function cloudflareUsage(token: string, extra: Record<string, string>): Promise<UsageReport> {
    const accountId = extra.accountId ?? '';
    const headers = { Authorization: `Bearer ${token}` };
    try {
        const metrics: UsageMetric[] = [];
        if (accountId) {
            const pr = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects`, { headers });
            if (pr.ok) { const b = (await readBody(pr)) as { result?: unknown[] }; metrics.push({ label: 'Pages projects', value: String(Array.isArray(b.result) ? b.result.length : 0) }); }
            const wr = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts`, { headers });
            if (wr.ok) { const b = (await readBody(wr)) as { result?: unknown[] }; metrics.push({ label: 'Workers', value: String(Array.isArray(b.result) ? b.result.length : 0) }); }
        }
        if (metrics.length === 0) metrics.push({ label: 'Token', value: 'verified' });
        return { ok: true, metrics, asOf: new Date().toISOString(), manageUrl: 'https://dash.cloudflare.com', note: accountId ? undefined : 'Add your account id to see Pages + Workers counts.' };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

async function renderValidate(token: string): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
        const res = await fetch('https://api.render.com/v1/services?limit=1', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (!res.ok) return { ok: false, error: httpError('Render', res.status, await readBody(res)) };
        return { ok: true, account: 'Render' };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

async function renderUsage(token: string): Promise<UsageReport> {
    try {
        const res = await fetch('https://api.render.com/v1/services?limit=100', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (!res.ok) return { ok: false, error: httpError('Render', res.status, await readBody(res)) };
        const body = (await readBody(res)) as unknown[];
        const count = Array.isArray(body) ? body.length : 0;
        return { ok: true, metrics: [{ label: 'Services', value: String(count) }], asOf: new Date().toISOString(), manageUrl: 'https://dashboard.render.com', note: 'Billing is dashboard-only; showing service count.' };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

function ddHost(extra: Record<string, string>): string {
    const site = (extra.site || 'datadoghq.com').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `https://api.${site}`;
}
function ddHeaders(token: string, extra: Record<string, string>): Record<string, string> {
    return { 'DD-API-KEY': token, 'DD-APPLICATION-KEY': extra.appKey ?? '' };
}

async function datadogValidate(token: string, extra: Record<string, string>): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
        const res = await fetch(`${ddHost(extra)}/api/v1/validate`, { headers: ddHeaders(token, extra) });
        if (!res.ok) return { ok: false, error: httpError('Datadog', res.status, await readBody(res)) };
        const body = (await readBody(res)) as { valid?: boolean };
        return body.valid ? { ok: true, account: 'Datadog' } : { ok: false, error: 'API key is not valid.' };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

async function datadogUsage(token: string, extra: Record<string, string>): Promise<UsageReport> {
    const headers = ddHeaders(token, extra);
    try {
        const metrics: UsageMetric[] = [];
        const mr = await fetch(`${ddHost(extra)}/api/v1/monitor?per_page=1000`, { headers });
        if (mr.ok) { const arr = (await readBody(mr)) as unknown[]; metrics.push({ label: 'Monitors', value: String(Array.isArray(arr) ? arr.length : 0) }); }
        try {
            const cr = await fetch(`${ddHost(extra)}/api/v2/usage/estimated_cost?view=summary`, { headers });
            if (cr.ok) {
                const b = (await readBody(cr)) as { data?: Array<{ attributes?: { total_cost?: number } }> };
                const total = b.data?.[0]?.attributes?.total_cost;
                if (typeof total === 'number') metrics.push({ label: 'Est. cost (month)', value: `$${total.toFixed(2)}` });
            }
        } catch { /* estimated cost needs an admin-scoped app key */ }
        if (metrics.length === 0) metrics.push({ label: 'API key', value: 'valid' });
        return { ok: true, metrics, asOf: new Date().toISOString(), manageUrl: `https://app.${(extra.site || 'datadoghq.com').replace(/^https?:\/\//, '')}` };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

// ── registry ────────────────────────────────────────────────────────────

export const CONNECTORS: ConnectorSpec[] = [
    {
        id: 'openrouter',
        name: 'OpenRouter',
        category: 'llm',
        blurb: 'One API key across every model. Tracks spend + remaining credit.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'API key',
            tokenPlaceholder: 'sk-or-v1-...',
            howToGet: 'openrouter.com -> Keys -> Create Key',
        },
        validate: { url: 'https://openrouter.ai/api/v1/key', accountField: 'data.label' },
        usage: {
            url: 'https://openrouter.ai/api/v1/key',
            metrics: [
                { label: 'Spent (total)', jsonPath: 'data.usage', format: 'usd' },
                { label: 'This month', jsonPath: 'data.usage_monthly', format: 'usd' },
                { label: 'Remaining', jsonPath: 'data.limit_remaining', format: 'usd' },
            ],
        },
        manageUrl: 'https://openrouter.ai/keys',
    },
    {
        id: 'elevenlabs',
        name: 'ElevenLabs',
        category: 'voice',
        blurb: 'Text-to-speech + voice. Tracks characters used against your plan.',
        tokenSource: 'connector',
        auth: {
            scheme: 'header',
            headerName: 'xi-api-key',
            tokenLabel: 'API key',
            tokenPlaceholder: 'your xi-api-key',
            howToGet: 'elevenlabs.io -> Profile -> API key',
        },
        validate: { url: 'https://api.elevenlabs.io/v1/user', accountField: 'first_name' },
        usage: {
            url: 'https://api.elevenlabs.io/v1/user/subscription',
            metrics: [
                { label: 'Characters', jsonPath: 'character_count', format: 'fraction', denomPath: 'character_limit' },
                { label: 'Overage', jsonPath: 'current_overage.amount', format: 'usd' },
                { label: 'Plan', jsonPath: 'tier', format: 'text' },
            ],
        },
        manageUrl: 'https://elevenlabs.io/app/subscription',
    },
    {
        id: 'netlify',
        name: 'Netlify',
        category: 'hosting',
        blurb: 'Sites + bandwidth used against your plan.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'Personal access token',
            tokenPlaceholder: 'nfp_...',
            howToGet: 'app.netlify.com -> User settings -> Applications -> Personal access tokens',
        },
        validate: { url: 'https://api.netlify.com/api/v1/user', accountField: 'full_name' },
        manageUrl: 'https://app.netlify.com',
        customUsage: (token) => netlifyUsage(token),
    },
    {
        id: 'supabase',
        name: 'Supabase',
        category: 'database',
        blurb: 'Postgres backend. Tracks how many projects you run.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'Personal access token',
            tokenPlaceholder: 'sbp_...',
            howToGet: 'supabase.com/dashboard/account/tokens',
        },
        validate: { url: 'https://api.supabase.com/v1/organizations', accountField: '0.name' },
        usage: {
            url: 'https://api.supabase.com/v1/projects',
            metrics: [{ label: 'Projects', jsonPath: 'length', format: 'number' }],
        },
        manageUrl: 'https://supabase.com/dashboard',
    },
    {
        id: 'neon',
        name: 'Neon',
        category: 'database',
        blurb: 'Serverless Postgres. Compute + storage this month.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'API key',
            tokenPlaceholder: 'napi_...',
            howToGet: 'console.neon.tech -> Account settings -> API keys',
        },
        validate: { url: 'https://console.neon.tech/api/v2/users/me', accountField: 'email' },
        manageUrl: 'https://console.neon.tech',
        customUsage: (token) => neonUsage(token),
    },
    {
        id: 'railway',
        name: 'Railway',
        category: 'hosting',
        blurb: 'Full-stack deploys. Tracks your project count.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'Account token',
            tokenPlaceholder: 'your Railway account token',
            howToGet: 'railway.com/account/tokens (pick "No workspace" for an account token)',
        },
        validate: { url: 'https://backboard.railway.com/graphql/v2' },
        manageUrl: 'https://railway.com/dashboard',
        customValidate: (token) => railwayValidate(token),
        customUsage: (token) => railwayUsage(token),
    },
    {
        id: 'posthog',
        name: 'PostHog',
        category: 'analytics',
        blurb: 'Product analytics. Flags any resource over its quota.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'Personal API key',
            tokenPlaceholder: 'phx_...',
            howToGet: 'PostHog -> Settings -> Personal API keys (scopes: user:read, project:read)',
            extraFields: [
                { key: 'host', label: 'Region host', placeholder: 'https://us.posthog.com', required: true },
            ],
        },
        validate: { url: '{host}/api/users/@me/', accountField: 'email' },
        manageUrl: 'https://us.posthog.com/settings/user-api-keys',
        customUsage: (token, extra) => posthogUsage(token, extra),
    },
    {
        id: 'vercel',
        name: 'Vercel',
        category: 'hosting',
        blurb: 'Projects + recent deploys for your connected Vercel account.',
        tokenSource: 'connections',
        auth: { scheme: 'bearer', tokenLabel: 'Access token', tokenPlaceholder: '(connected in Services)' },
        validate: { url: 'https://api.vercel.com/v2/user', accountField: 'user.username' },
        manageUrl: 'https://vercel.com/dashboard/usage',
        customUsage: (token) => vercelUsage(token),
    },
    {
        id: 'sentry',
        name: 'Sentry',
        category: 'errors',
        blurb: 'Unresolved production errors in the last 24 hours.',
        tokenSource: 'connections',
        auth: { scheme: 'bearer', tokenLabel: 'Auth token', tokenPlaceholder: '(connected in Services)' },
        validate: { url: 'https://sentry.io/api/0/', accountField: '' },
        manageUrl: 'https://sentry.io/',
        customUsage: (token) => sentryUsage(token),
    },
    {
        id: 'cloudflare',
        name: 'Cloudflare',
        category: 'host',
        blurb: 'Pages + Workers deploy counts.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'API token',
            tokenPlaceholder: 'Cloudflare API token',
            howToGet: 'dash.cloudflare.com -> My Profile -> API Tokens. Scope a custom token to Workers + Pages read; never the Global API Key.',
            extraFields: [{ key: 'accountId', label: 'Account ID', placeholder: 'CLOUDFLARE_ACCOUNT_ID', required: false }],
        },
        validate: { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify' },
        manageUrl: 'https://dash.cloudflare.com',
        customValidate: (token) => cloudflareValidate(token),
        customUsage: (token, extra) => cloudflareUsage(token, extra),
        actions: [
            { id: 'purge-cache', label: 'Purge cache', description: 'Purge everything for your zone', danger: true, run: (token) => cloudflarePurge(token) },
        ],
    },
    {
        id: 'render',
        name: 'Render',
        category: 'host',
        blurb: 'Service + deploy status.',
        tokenSource: 'connector',
        auth: {
            scheme: 'bearer',
            tokenLabel: 'API key',
            tokenPlaceholder: 'rnd_...',
            howToGet: 'dashboard.render.com -> Account Settings -> API Keys (read-only).',
        },
        validate: { url: 'https://api.render.com/v1/services?limit=1' },
        manageUrl: 'https://dashboard.render.com',
        customValidate: (token) => renderValidate(token),
        customUsage: (token) => renderUsage(token),
        actions: [
            { id: 'trigger-deploy', label: 'Trigger deploy', description: 'Deploy your Render service', danger: true, run: (token) => renderTriggerDeploy(token) },
        ],
    },
    {
        id: 'datadog',
        name: 'Datadog',
        category: 'observability',
        blurb: 'Monitors + estimated cost.',
        tokenSource: 'connector',
        auth: {
            scheme: 'header',
            headerName: 'DD-API-KEY',
            tokenLabel: 'API key',
            tokenPlaceholder: 'Datadog API key',
            howToGet: 'app.datadoghq.com -> Organization Settings -> API Keys and Application Keys. The app key should be read-only.',
            extraFields: [
                { key: 'appKey', label: 'Application key', placeholder: 'DD_APP_KEY', required: true },
                { key: 'site', label: 'Site (region)', placeholder: 'datadoghq.com or datadoghq.eu', required: false },
            ],
        },
        validate: { url: 'https://api.datadoghq.com/api/v1/validate' },
        manageUrl: 'https://app.datadoghq.com',
        customValidate: (token, extra) => datadogValidate(token, extra),
        customUsage: (token, extra) => datadogUsage(token, extra),
    },
];

// --- Connector actions (write/side-effecting; run with the stored token) ------

async function cloudflarePurge(token: string): Promise<ConnectorActionResult> {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
        const zres = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=5', { headers });
        if (!zres.ok) return { ok: false, error: `Cloudflare API returned ${zres.status}.` };
        const zd = (await zres.json()) as { result?: { id: string; name: string }[] };
        const zones = zd.result ?? [];
        if (zones.length === 0) return { ok: false, error: 'No Cloudflare zones found for this token.' };
        if (zones.length > 1) return { ok: false, error: `You have ${zones.length} zones; purge a specific one from the Cloudflare dashboard.` };
        const zone = zones[0];
        const pres = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone.id}/purge_cache`, { method: 'POST', headers, body: JSON.stringify({ purge_everything: true }) });
        if (!pres.ok) return { ok: false, error: `Purge failed (${pres.status}).` };
        return { ok: true, message: `Purged the cache for ${zone.name}.` };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

async function renderTriggerDeploy(token: string): Promise<ConnectorActionResult> {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    try {
        const sres = await fetch('https://api.render.com/v1/services?limit=20', { headers });
        if (!sres.ok) return { ok: false, error: `Render API returned ${sres.status}.` };
        const list = (await sres.json()) as { service?: { id: string; name: string } }[];
        const services = (list ?? []).map((x) => x.service).filter((s): s is { id: string; name: string } => Boolean(s));
        if (services.length === 0) return { ok: false, error: 'No Render services found for this key.' };
        if (services.length > 1) return { ok: false, error: `You have ${services.length} services; deploy a specific one from the Render dashboard.` };
        const svc = services[0];
        const dres = await fetch(`https://api.render.com/v1/services/${svc.id}/deploys`, { method: 'POST', headers, body: JSON.stringify({}) });
        if (!dres.ok) return { ok: false, error: `Deploy failed (${dres.status}).` };
        return { ok: true, message: `Triggered a deploy of ${svc.name}.`, url: `https://dashboard.render.com/web/${svc.id}` };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export function getConnector(id: string): ConnectorSpec | undefined {
    return CONNECTORS.find((c) => c.id === id);
}

export function catalog(): ConnectorCatalogEntry[] {
    return CONNECTORS.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        blurb: c.blurb,
        tokenSource: c.tokenSource,
        tokenLabel: c.auth.tokenLabel,
        tokenPlaceholder: c.auth.tokenPlaceholder,
        howToGet: c.auth.howToGet,
        extraFields: c.auth.extraFields ?? [],
        hasUsage: Boolean(c.usage) || Boolean(c.customUsage),
        manageUrl: c.manageUrl,
        actions: (c.actions ?? []).map((a) => ({ id: a.id, label: a.label, description: a.description, danger: a.danger })),
        hasOauth: Boolean(c.oauth),
    }));
}
