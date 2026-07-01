// console-electron/src/main/connectors/spend.ts
//
// Cross-vendor spend: one dollar figure summed across every connected connector
// that reports a cost. Non-blocking - the getter returns the last cached value
// immediately and kicks off a background refresh when stale, so the Overview
// (which reads it on every metrics.summary) never waits on a provider network
// call. Global, not per-project: it is the user's total provider spend.
import { CONNECTORS, usageConnector, resolveToken } from './registry';
import { loadConnectorMeta } from './store';

const TTL = 5 * 60_000;
let cache: { at: number; total: number | null } = { at: 0, total: null };
let refreshing = false;

export function parseUsd(value: string): number | null {
    const m = /-?\$?\s*([\d,]+(?:\.\d+)?)/.exec(value);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

// A metric is spend if its value is a dollar amount and its label is about money
// spent, not money remaining (credit / balance / included / limit).
export function isSpend(value: string, label: string): boolean {
    if (!/\$|\bUSD\b/i.test(value)) return false;
    const l = label.toLowerCase();
    if (/remaining|left|credit|balance|included|limit|quota/.test(l)) return false;
    return /spent|cost|spend|charge|bill|month|today|daily/.test(l);
}

async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
        let total: number | null = null;
        for (const spec of CONNECTORS) {
            if (!spec.usage && !spec.customUsage) continue;
            const token = resolveToken(spec);
            if (!token) continue; // not connected
            const extra = spec.tokenSource === 'connector' ? (loadConnectorMeta()[spec.id]?.extra ?? {}) : {};
            let metrics;
            try {
                const report = await usageConnector(spec, token, extra);
                if (!report.ok || !report.metrics) continue;
                metrics = report.metrics;
            } catch { continue; }
            // One spend figure per connector (prefer month/today over a lifetime
            // total) so a provider reporting both is not double-counted.
            const spend = metrics.filter((m) => isSpend(m.value, m.label) && parseUsd(m.value) != null);
            if (spend.length === 0) continue;
            const pick = spend.find((m) => /month|today|daily/i.test(m.label)) ?? spend[0];
            total = (total ?? 0) + (parseUsd(pick.value) ?? 0);
        }
        cache = { at: Date.now(), total };
    } finally {
        refreshing = false;
    }
}

export function getCrossVendorSpend(): number | null {
    if (Date.now() - cache.at > TTL) void refresh();
    return cache.total;
}
