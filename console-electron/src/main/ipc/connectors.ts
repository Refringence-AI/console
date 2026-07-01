// console-electron/src/main/ipc/connectors.ts
//
// IPC for the generic connector platform. Every handler is total (try/catch
// -> {ok:false,error}) and NEVER returns a token. Connect validates the
// credential against the provider before storing it encrypted; usage reads the
// stored token back in-process to fetch the provider's usage/quota.
import { ipcMain } from 'electron';

import {
    CONNECTORS,
    getConnector,
    catalog,
    validateConnector,
    usageConnector,
    executeConnectorAction,
    probeConnectorHealth,
    resolveToken,
    type ConnectorCatalogEntry,
    type ConnectorStatus,
    type UsageReport,
    type ConnectorActionResult,
    type ConnectorHealth,
} from '../connectors/registry';
import { runOAuthLoopback } from '../connectors/oauth-loopback';
import {
    loadConnectorMeta,
    saveConnectorMeta,
    clearConnectorMeta,
    setConnectorToken,
    clearConnectorToken,
} from '../connectors/store';
import { loadMeta as loadConnectionsMeta } from '../connections';
import { assertSafeExternalUrl, isUrlExtraKey, UnsafeUrlError } from '../connectors/urlGuard';

function statusFor(id: string): ConnectorStatus {
    const spec = getConnector(id);
    if (!spec) return { id, connected: false };
    if (spec.tokenSource === 'connections') {
        const m = loadConnectionsMeta();
        const entry = spec.id === 'vercel' ? m.vercel : spec.id === 'sentry' ? m.sentry : undefined;
        return { id, connected: Boolean(entry?.connected), account: entry?.user, connectedAt: entry?.connectedAt };
    }
    const e = loadConnectorMeta()[id];
    return { id, connected: Boolean(e?.connected), account: e?.account, connectedAt: e?.connectedAt };
}

// Keep only the declared extra-field keys, coerced to trimmed strings. Any
// URL-shaped extra (e.g. PostHog's renderer-controlled 'host', which the user's
// API key is then sent to) must pass the SSRF guard: throws UnsafeUrlError so
// the connect handler surfaces an honest error instead of sending the key to a
// loopback / private / cloud-metadata / non-https host.
function sanitizeExtra(id: string, raw: unknown): Record<string, string> {
    const spec = getConnector(id);
    const out: Record<string, string> = {};
    if (!spec || !raw || typeof raw !== 'object') return out;
    for (const f of spec.auth.extraFields ?? []) {
        const v = (raw as Record<string, unknown>)[f.key];
        if (typeof v === 'string' && v.trim().length > 0) {
            const val = v.trim();
            if (isUrlExtraKey(f.key)) assertSafeExternalUrl(val, f.label);
            out[f.key] = val;
        }
    }
    return out;
}

export function registerConnectorsHandlers(): void {
    ipcMain.handle('console:connectors.catalog', async (): Promise<ConnectorCatalogEntry[]> => catalog());

    ipcMain.handle('console:connectors.status', async (): Promise<ConnectorStatus[]> =>
        CONNECTORS.map((c) => statusFor(c.id)));

    ipcMain.handle('console:connectors.connect', async (_e, id: string, token: string, extra?: unknown): Promise<{ ok: boolean; account?: string; error?: string }> => {
        const spec = getConnector(id);
        if (!spec) return { ok: false, error: 'unknown connector' };
        if (spec.tokenSource !== 'connector') {
            return { ok: false, error: `${spec.name} is connected from the Services panel.` };
        }
        if (typeof token !== 'string' || token.trim().length === 0) {
            return { ok: false, error: `A ${spec.auth.tokenLabel} is required.` };
        }
        let ex: Record<string, string>;
        try {
            ex = sanitizeExtra(id, extra);
        } catch (err) {
            if (err instanceof UnsafeUrlError) return { ok: false, error: err.message };
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        for (const f of spec.auth.extraFields ?? []) {
            if (f.required && !ex[f.key]) return { ok: false, error: `${f.label} is required.` };
        }
        try {
            const v = await validateConnector(spec, token.trim(), ex);
            if (!v.ok) return { ok: false, error: v.error ?? 'That credential did not validate.' };
            setConnectorToken(spec.id, token.trim());
            saveConnectorMeta(spec.id, {
                connected: true,
                account: v.account,
                connectedAt: new Date().toISOString(),
                extra: Object.keys(ex).length > 0 ? ex : undefined,
            });
            return { ok: true, account: v.account };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // Connect via OAuth loopback (for connectors that declare an oauth config).
    // The browser opens to the provider; the loopback catches the redirect and the
    // exchanged token is validated + stored like a pasted one.
    ipcMain.handle('console:connectors.oauthConnect', async (_e, id: string): Promise<{ ok: boolean; account?: string; error?: string }> => {
        const spec = getConnector(id);
        if (!spec) return { ok: false, error: 'unknown connector' };
        if (!spec.oauth) return { ok: false, error: `${spec.name} does not support OAuth; paste a token instead.` };
        try {
            const r = await runOAuthLoopback(spec.oauth);
            if (!r.ok || !r.accessToken) return { ok: false, error: r.error ?? 'OAuth did not return a token.' };
            const v = await validateConnector(spec, r.accessToken, {});
            if (!v.ok) return { ok: false, error: v.error ?? 'The OAuth token did not validate.' };
            setConnectorToken(spec.id, r.accessToken);
            saveConnectorMeta(spec.id, { connected: true, account: v.account, connectedAt: new Date().toISOString() });
            return { ok: true, account: v.account };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle('console:connectors.disconnect', async (_e, id: string): Promise<{ ok: boolean; error?: string }> => {
        const spec = getConnector(id);
        if (!spec) return { ok: false, error: 'unknown connector' };
        if (spec.tokenSource !== 'connector') {
            return { ok: false, error: `${spec.name} is managed from the Services panel.` };
        }
        try {
            clearConnectorToken(id);
            clearConnectorMeta(id);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle('console:connectors.usage', async (_e, id: string): Promise<UsageReport> => {
        const spec = getConnector(id);
        if (!spec) return { ok: false, error: 'unknown connector' };
        const token = resolveToken(spec);
        if (!token) return { ok: false, error: 'not connected' };
        const extra = spec.tokenSource === 'connector' ? (loadConnectorMeta()[id]?.extra ?? {}) : {};
        try {
            return await usageConnector(spec, token, extra);
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    // Run a side-effecting action against the connected account. Total + never
    // returns the token; an unconnected connector yields an honest error.
    ipcMain.handle('console:connectors.executeAction', async (_e, id: string, actionId: string): Promise<ConnectorActionResult> => {
        const spec = getConnector(id);
        if (!spec) return { ok: false, error: 'Unknown connector.' };
        const token = resolveToken(spec);
        if (!token) return { ok: false, error: 'Connect this service first.' };
        const extra = spec.tokenSource === 'connector' ? (loadConnectorMeta()[id]?.extra ?? {}) : {};
        return executeConnectorAction(spec, actionId, token, extra);
    });

    ipcMain.handle('console:connectors.health', async (_e, id: string): Promise<ConnectorHealth> => {
        const checkedAt = new Date().toISOString();
        const spec = getConnector(id);
        if (!spec) return { id, state: 'not-connected', detail: 'Unknown connector.', checkedAt };
        const token = resolveToken(spec);
        if (!token) return { id, state: 'not-connected', checkedAt };
        const extra = spec.tokenSource === 'connector' ? (loadConnectorMeta()[id]?.extra ?? {}) : {};
        return probeConnectorHealth(spec, token, extra);
    });
}
