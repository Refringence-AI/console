import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ExternalLink, Gauge, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { bridge, type ConnectorCatalogEntry, type ConnectorUsageMetric } from '../../lib/bridge';
import { useConnectorCatalog, useConnectorStatus, useConnectorUsage } from '../../lib/queries/connectors';
import { useConnections } from '../../lib/queries/connections';
import { Card as UICard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionLabel } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The connector platform's usage surface. Each connector shows live usage /
 * quota in a few tiles once connected. Connector-source providers (OpenRouter,
 * ElevenLabs, Netlify, Supabase, Neon, Railway, PostHog) connect here with a
 * pasted credential; connections-source providers (Vercel, Sentry) connect via
 * their rich cards below and just surface a usage read here. Tokens never leave
 * the main process - only the rendered figures cross the bridge.
 */
export function ConnectorsSection({ compact = false }: { compact?: boolean }) {
    const catalog = useConnectorCatalog();
    const status = useConnectorStatus();
    const connections = useConnections();
    const qc = useQueryClient();

    if (!catalog.data || catalog.data.length === 0) return null;

    function connectedFor(entry: ConnectorCatalogEntry): { connected: boolean; account?: string } {
        if (entry.tokenSource === 'connections') {
            const c = entry.id === 'vercel' ? connections.data?.vercel
                : entry.id === 'sentry' ? connections.data?.sentry : undefined;
            return { connected: Boolean(c?.connected), account: (c as { user?: string } | undefined)?.user };
        }
        const s = status.data?.find((x) => x.id === entry.id);
        return { connected: Boolean(s?.connected), account: s?.account };
    }

    function invalidate() {
        void qc.invalidateQueries({ queryKey: ['connectors'] });
    }

    return (
        <section className="flex flex-col gap-3" data-testid="services-connectors">
            <SectionLabel>Usage &amp; connectors</SectionLabel>
            <div className={cn('grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2', !compact && 'lg:grid-cols-3')}>
                {catalog.data.map((entry) => {
                    const { connected, account } = connectedFor(entry);
                    return (
                        <ConnectorCard
                            key={entry.id}
                            entry={entry}
                            connected={connected}
                            account={account}
                            onChanged={invalidate}
                        />
                    );
                })}
            </div>
        </section>
    );
}

const TONE_CLASS: Record<NonNullable<ConnectorUsageMetric['tone']>, string> = {
    default: 'text-foreground',
    good: 'text-success-text',
    warn: 'text-warning-text',
    bad: 'text-danger-text',
};

// Side-effecting connector actions (deploy, purge). Danger actions confirm first;
// the result lands as a toast and any returned url opens externally.
function ActionRow({ id, actions }: { id: string; actions: ConnectorCatalogEntry['actions'] }) {
    const [running, setRunning] = useState<string | null>(null);
    async function run(actionId: string, label: string, danger?: boolean) {
        if (danger && !window.confirm(`${label}? This affects your live ${id} account.`)) return;
        setRunning(actionId);
        try {
            const res = await bridge.connectors.executeAction(id, actionId);
            if (res.ok) { toast.success(res.message ?? `${label} done.`); if (res.url) void bridge.openExternal(res.url); }
            else toast.error(res.error ?? `${label} failed.`);
        } finally { setRunning(null); }
    }
    return (
        <div className="flex flex-wrap items-center gap-1.5" data-testid={`connector-${id}-actions`}>
            {actions.map((a) => (
                <Button
                    key={a.id}
                    variant="outline"
                    size="sm"
                    disabled={running !== null}
                    title={a.description}
                    onClick={() => void run(a.id, a.label, a.danger)}
                    data-testid={`connector-${id}-action-${a.id}`}
                >
                    {running === a.id && <Loader2 className="size-3 animate-spin" />}
                    {a.label}
                </Button>
            ))}
        </div>
    );
}

// SC-6: an on-demand liveness check. The stored-token status only says a
// credential exists; this probes whether it still authenticates and names why
// it does not (revoked, throttled, unreachable) instead of failing silently.
const HEALTH_LABEL: Record<string, string> = {
    ok: 'Healthy', unauthorized: 'Auth failed', throttled: 'Rate limited',
    unreachable: 'Unreachable', error: 'Error', 'not-connected': 'Not connected',
};
function HealthRow({ id }: { id: string }) {
    const [busy, setBusy] = useState(false);
    const [state, setState] = useState<string | null>(null);
    const [detail, setDetail] = useState<string | undefined>(undefined);
    async function check() {
        setBusy(true);
        try {
            const h = await bridge.connectors.health(id);
            setState(h.state);
            setDetail(h.detail);
        } finally { setBusy(false); }
    }
    const ok = state === 'ok';
    return (
        <div className="flex items-center gap-2" data-testid={`connector-${id}-health`}>
            <button
                type="button"
                onClick={() => void check()}
                disabled={busy}
                className="flex shrink-0 items-center gap-1 text-label text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                data-testid={`connector-${id}-health-check`}
            >
                <RefreshCw className={cn('size-3', busy && 'animate-spin')} /> Check health
            </button>
            {state && (
                <span
                    title={detail}
                    data-testid={`connector-${id}-health-state`}
                    className={cn('rounded-md px-2 py-0.5 text-label font-medium', ok ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400')}
                >
                    {HEALTH_LABEL[state] ?? state}
                </span>
            )}
        </div>
    );
}

function UsageTiles({ id, connected }: { id: string; connected: boolean }) {
    const usage = useConnectorUsage(id, connected);
    if (usage.isLoading) {
        return (
            <div className="flex items-center gap-2 text-small text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Reading usage…
            </div>
        );
    }
    const report = usage.data;
    if (!report || !report.ok) {
        return (
            <p className="text-small text-muted-foreground">
                {report?.error ? `Usage unavailable: ${report.error}` : 'Usage unavailable right now.'}
            </p>
        );
    }
    const metrics = report.metrics ?? [];
    if (metrics.length === 0) {
        return <p className="text-small text-muted-foreground">Connected. No usage metrics to show.</p>;
    }
    // Deterministic suggestions straight from each metric's tone: a warn/bad tone
    // is the connector saying this number is near or over a limit.
    const suggestions = metrics
        .filter((m) => m.tone === 'warn' || m.tone === 'bad')
        .map((m) => ({
            bad: m.tone === 'bad',
            text: `${m.label} is at ${m.value}, ${m.tone === 'bad' ? 'at or over the limit' : 'getting close to the limit'}.`,
        }));
    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
                {metrics.map((m) => (
                    <div key={m.label} className="rounded-lg bg-secondary/40 px-3 py-2" data-testid={`usage-${id}-${m.label}`}>
                        <p className="text-label uppercase tracking-wide text-muted-foreground">{m.label}</p>
                        <p className={cn('truncate text-section tabular-nums', TONE_CLASS[m.tone ?? 'default'])} title={m.sub}>
                            {m.value}
                        </p>
                        {m.sub && <p className="truncate text-label text-muted-foreground">{m.sub}</p>}
                    </div>
                ))}
            </div>
            {suggestions.length > 0 && (
                <div className="flex flex-col gap-1" data-testid={`usage-${id}-suggestions`}>
                    {suggestions.map((s) => (
                        <div key={s.text} className="flex items-start gap-1.5 text-label">
                            <AlertTriangle className={cn('mt-0.5 size-3 shrink-0', s.bad ? 'text-danger-text' : 'text-warning-text')} />
                            <span className="text-muted-foreground">{s.text}</span>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex items-center justify-between gap-2">
                {report.note ? <p className="flex-1 text-label text-muted-foreground">{report.note}</p> : <span />}
                <button
                    type="button"
                    onClick={() => void usage.refetch()}
                    disabled={usage.isFetching}
                    className="flex shrink-0 items-center gap-1 text-label text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    data-testid={`usage-${id}-refresh`}
                >
                    <RefreshCw className={cn('size-3', usage.isFetching && 'animate-spin')} /> Refresh
                </button>
            </div>
        </div>
    );
}

function ConnectorCard({
    entry, connected, account, onChanged,
}: {
    entry: ConnectorCatalogEntry;
    connected: boolean;
    account?: string;
    onChanged: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [token, setToken] = useState('');
    const [extra, setExtra] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    const needsExtra = entry.extraFields.filter((f) => f.required && !extra[f.key]?.trim());
    const canSubmit = token.trim().length > 0 && needsExtra.length === 0;

    async function connect() {
        if (!canSubmit) return;
        setBusy(true);
        try {
            const res = await bridge.connectors.connect(entry.id, token.trim(), extra);
            if (res.ok) {
                toast.success(res.account ? `Connected ${entry.name} (${res.account})` : `Connected ${entry.name}`);
                setToken('');
                setExtra({});
                setOpen(false);
                onChanged();
            } else {
                toast.error(res.error ?? `Could not connect ${entry.name}`);
            }
        } catch (err) {
            toast.error(`${entry.name} connect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        try {
            const res = await bridge.connectors.disconnect(entry.id);
            if (res.ok) { toast.success(`Disconnected ${entry.name}`); onChanged(); }
            else toast.error(res.error ?? 'Could not disconnect');
        } catch (err) {
            toast.error(`Disconnect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <UICard
            data-testid={`connector-${entry.id}`}
            className={cn('group relative flex h-full flex-col gap-2.5 p-4 shadow-none transition-colors', connected && 'border-ring')}
        >
            <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-md bg-secondary">
                    <Gauge className="size-3.5 text-foreground" />
                </div>
                <h3 className="text-card-title text-foreground">{entry.name}</h3>
                {connected ? (
                    <Badge variant="success" className="ml-auto rounded-md"><Check className="size-2.5" />Connected</Badge>
                ) : (
                    <Badge variant="secondary" className="ml-auto rounded-md">Not connected</Badge>
                )}
            </div>
            <p className="text-small leading-relaxed text-muted-foreground">{entry.blurb}</p>

            {connected ? (
                <>
                    {account && <p className="text-small text-muted-foreground">Account <span className="text-foreground">{account}</span></p>}
                    {entry.hasUsage && <UsageTiles id={entry.id} connected={connected} />}
                    {entry.tokenSource === 'connector' && <HealthRow id={entry.id} />}
                    {entry.actions.length > 0 && <ActionRow id={entry.id} actions={entry.actions} />}
                    <div className="mt-auto flex items-center gap-2 pt-1">
                        {entry.manageUrl && (
                            <Button variant="outline" size="sm" onClick={() => void bridge.openExternal(entry.manageUrl!)}>
                                Manage <ExternalLink className="size-2.5" />
                            </Button>
                        )}
                        {entry.tokenSource === 'connector' && (
                            <Button variant="ghost" size="sm" disabled={busy} onClick={disconnect}>Disconnect</Button>
                        )}
                    </div>
                </>
            ) : entry.tokenSource === 'connections' ? (
                <p className="mt-auto text-small text-muted-foreground">Connect {entry.name} in the cards below to see usage.</p>
            ) : !open ? (
                <Button variant="outline" size="sm" className="mt-auto self-start" onClick={() => setOpen(true)} data-testid={`connector-${entry.id}-connect`}>
                    Connect
                </Button>
            ) : (
                <div className="mt-auto flex flex-col gap-2 border-t border-border pt-2.5">
                    {entry.extraFields.map((f) => (
                        <div key={f.key} className="flex flex-col gap-1">
                            <Label htmlFor={`conn-${entry.id}-${f.key}`} className="text-muted-foreground">{f.label}</Label>
                            <Input
                                id={`conn-${entry.id}-${f.key}`}
                                className="h-8"
                                placeholder={f.placeholder}
                                value={extra[f.key] ?? ''}
                                onChange={(e) => setExtra((p) => ({ ...p, [f.key]: e.target.value }))}
                            />
                        </div>
                    ))}
                    <Label htmlFor={`conn-${entry.id}-token`} className="text-muted-foreground">{entry.tokenLabel}</Label>
                    <Input
                        id={`conn-${entry.id}-token`}
                        type="password"
                        className="h-8"
                        autoFocus
                        placeholder={entry.tokenPlaceholder}
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
                    />
                    {entry.howToGet && <p className="text-label text-muted-foreground">{entry.howToGet}</p>}
                    <div className="flex items-center gap-2">
                        <Button size="sm" loading={busy} disabled={!canSubmit} onClick={connect}>
                            Connect
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); setToken(''); setExtra({}); }}>Cancel</Button>
                    </div>
                    <p className="text-label uppercase tracking-wide text-muted-foreground/70">Stored encrypted by the app. Never shown back.</p>
                </div>
            )}
        </UICard>
    );
}
