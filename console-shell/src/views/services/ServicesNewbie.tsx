import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, GitBranch, Rocket, CreditCard, AlertTriangle, Plug, ExternalLink } from 'lucide-react';
import { bridge } from '../../lib/bridge';
import { useConnections } from '../../lib/queries/connections';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PanelHeader } from '../_shell/PanelHeader';
import { ConnectorsSection } from './UsageDashboard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';

/**
 * Newbie-mode Services.
 *
 * Single column, four curated starters. Connection status comes from the
 * real connections IPC via useConnections() — the same source the Operator
 * grid reads — so the Connected pill is never cosmetic.
 *
 * GitHub connects in place (reuses gh auth). Vercel and Sentry need a token
 * dialog, so their Connect routes the user to the Operator grid where that
 * dialog lives. Stripe has no backend yet, so it opens setup docs.
 */

interface Starter {
    id: 'github' | 'vercel' | 'sentry' | 'stripe';
    name: string;
    explainer: string;
    icon: React.ComponentType<{ className?: string }>;
    connectUrl: string;
}

const STARTERS: Starter[] = [
    {
        id: 'github',
        name: 'GitHub',
        explainer: 'Connect your repo so Console can show issues, commits, and pull requests.',
        icon: GitBranch,
        connectUrl: 'https://cli.github.com',
    },
    {
        id: 'vercel',
        name: 'Vercel',
        explainer: 'See your deploy status and projects without leaving Console.',
        icon: Rocket,
        connectUrl: 'https://vercel.com/account/tokens',
    },
    {
        id: 'sentry',
        name: 'Sentry',
        explainer: 'Surface the latest errors on your Workboard so nothing slips through.',
        icon: AlertTriangle,
        connectUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    },
    {
        id: 'stripe',
        name: 'Stripe',
        explainer: 'Show live revenue and subscription state alongside the rest of your project.',
        icon: CreditCard,
        connectUrl: 'https://dashboard.stripe.com/apikeys',
    },
];

export function ServicesNewbie() {
    const { setPersona } = usePersonaMode();
    const qc = useQueryClient();
    const connections = useConnections();
    const [busy, setBusy] = useState<string | null>(null);
    // Vercel/Sentry connect/manage opens an in-place dialog (token paste +
    // disconnect) instead of flipping the whole app to Operator mode.
    const [dialogService, setDialogService] = useState<Starter | null>(null);

    function statusOf(id: Starter['id']): boolean {
        switch (id) {
            case 'github': return connections.data?.github.connected ?? false;
            case 'vercel': return connections.data?.vercel.connected ?? false;
            case 'sentry': return connections.data?.sentry.connected ?? false;
            default: return false;
        }
    }


    async function githubConnect() {
        setBusy('github');
        try {
            const res = await bridge.connections.github.connect();
            if (res.ok) {
                toast.success(res.login ? `Connected to GitHub as ${res.login}` : 'Connected to GitHub');
                void qc.invalidateQueries({ queryKey: ['connections'] });
            } else {
                toast.error(res.error ?? 'Could not connect to GitHub');
            }
        } catch (err) {
            toast.error(`GitHub connect failed: ${String(err)}`);
        } finally {
            setBusy(null);
        }
    }

    async function githubDisconnect() {
        setBusy('github');
        try {
            const res = await bridge.connections.github.disconnect();
            if (res.ok) {
                toast.success('Disconnected GitHub');
                void qc.invalidateQueries({ queryKey: ['connections'] });
            } else {
                toast.error(res.error ?? 'Could not disconnect');
            }
        } catch (err) {
            toast.error(`GitHub disconnect failed: ${String(err)}`);
        } finally {
            setBusy(null);
        }
    }

    function onConnect(s: Starter) {
        if (s.id === 'github') {
            void (statusOf('github') ? githubDisconnect() : githubConnect());
            return;
        }
        if (s.id === 'vercel' || s.id === 'sentry') {
            setDialogService(s);
            return;
        }
        // Stripe: no backend yet, open the provider's token docs.
        void bridge.openExternal(s.connectUrl);
    }

    function labelFor(s: Starter, isConnected: boolean): string {
        if (s.id === 'github') return isConnected ? 'Disconnect' : 'Connect';
        if (s.id === 'vercel' || s.id === 'sentry') return isConnected ? 'Manage' : 'Connect';
        return 'Open docs';
    }

    // GitHub connects in place, so it carries the one filled primary. The
    // others either hand off to the Operator grid or open provider docs, so
    // they read as equal-weight outline actions rather than a stack of CTAs.
    function variantFor(s: Starter): 'default' | 'outline' {
        return s.id === 'github' ? 'default' : 'outline';
    }

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="services-newbie">
            {dialogService && (
                <ServiceTokenDialog
                    service={dialogService}
                    connected={statusOf(dialogService.id)}
                    onDone={() => setDialogService(null)}
                />
            )}
            <PanelHeader
                icon={Plug}
                title="Services"
                testid="services-newbie-header"
            />

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[820px] px-6 py-7">
                    <p className="text-body leading-relaxed text-muted-foreground">
                        A few services to plug Console into.
                    </p>

                    <div className="mt-8 flex flex-col gap-4">
                        {STARTERS.map((s) => {
                            const isConnected = statusOf(s.id);
                            const isBusy = busy === s.id;
                            const showExternalIcon = s.id === 'stripe';
                            return (
                                <Card
                                    key={s.id}
                                    data-testid={`service-newbie-${s.id}`}
                                    className="gap-0 p-5"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-secondary">
                                            <s.icon className="h-5 w-5 text-foreground" />
                                        </div>
                                        <div className="flex flex-1 flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-card-title text-foreground">
                                                    {s.name}
                                                </h2>
                                                {isConnected && (
                                                    <Badge variant="success" className="rounded-md">
                                                        <Check className="h-3 w-3" />
                                                        Connected
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-body leading-relaxed text-muted-foreground">
                                                {s.explainer}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-5 flex justify-end">
                                        <Button
                                            variant={variantFor(s)}
                                            disabled={isBusy}
                                            onClick={() => onConnect(s)}
                                            data-testid={`service-newbie-${s.id}-action`}
                                        >
                                            {showExternalIcon && <ExternalLink className="h-3 w-3" />}
                                            {isBusy ? 'Connecting…' : labelFor(s, isConnected)}
                                        </Button>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>

                    <div className="mt-10 border-t border-border pt-7">
                        <ConnectorsSection compact />
                    </div>

                    <footer className="mt-10 border-t border-border pt-6">
                        <Button
                            variant="link"
                            onClick={() => setPersona('seasoned')}
                            className="px-0 text-muted-foreground hover:text-foreground"
                        >
                            See all services
                        </Button>
                    </footer>
                </div>
            </div>
        </div>
    );
}

/**
 * In-place connect / manage for Vercel + Sentry, so Guided users never get
 * flipped into Operator mode just to paste a token. Token paste on connect;
 * disconnect + open-provider on manage. Same bridge calls as the Operator grid.
 */
function ServiceTokenDialog({ service, connected, onDone }: {
    service: Starter; connected: boolean; onDone: () => void;
}) {
    const qc = useQueryClient();
    const [token, setToken] = useState('');
    const [org, setOrg] = useState('');
    const [busy, setBusy] = useState(false);
    const needsOrg = service.id === 'sentry';

    async function connect() {
        const t = token.trim();
        if (!t || (needsOrg && !org.trim())) return;
        setBusy(true);
        try {
            const res = service.id === 'vercel'
                ? await bridge.connections.vercel.connect(t)
                : await bridge.connections.sentry.connect(t, org.trim());
            if (res.ok) {
                toast.success(`${service.name} connected`);
                qc.invalidateQueries({ queryKey: ['connections'] });
                onDone();
            } else {
                toast.error(res.error || `Could not connect ${service.name}`);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : `Could not connect ${service.name}`);
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        try {
            if (service.id === 'vercel') await bridge.connections.vercel.disconnect();
            else await bridge.connections.sentry.disconnect();
            qc.invalidateQueries({ queryKey: ['connections'] });
            toast.success(`${service.name} disconnected`);
            onDone();
        } catch {
            /* noop */
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(o) => { if (!o && !busy) onDone(); }}>
            <DialogContent data-testid={`service-connect-${service.id}`}>
                <DialogHeader>
                    <DialogTitle>{connected ? `Manage ${service.name}` : `Connect ${service.name}`}</DialogTitle>
                    <DialogDescription>
                        {connected
                            ? `${service.name} is connected. Its token is encrypted by your OS keychain and never leaves this machine.`
                            : `Paste a ${service.name} access token. It is encrypted by your OS keychain and never leaves this machine.`}
                    </DialogDescription>
                </DialogHeader>
                {connected ? (
                    <Button variant="outline" size="sm" className="self-start" onClick={() => void bridge.openExternal(service.connectUrl)}>
                        Open {service.name} <ExternalLink className="size-3.5" />
                    </Button>
                ) : (
                    <div className="flex flex-col gap-2">
                        {needsOrg && (
                            <>
                                <Label htmlFor={`${service.id}-org`}>Organization slug</Label>
                                <Input
                                    id={`${service.id}-org`}
                                    autoFocus
                                    placeholder="your-org"
                                    value={org}
                                    onChange={(e) => setOrg(e.target.value)}
                                />
                            </>
                        )}
                        <Label htmlFor={`${service.id}-token`}>Access token</Label>
                        <Input
                            id={`${service.id}-token`}
                            type="password"
                            autoFocus={!needsOrg}
                            placeholder="xxxxxxxxxxxxxxxxxxxx"
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
                        />
                        <p className="text-small text-muted-foreground">
                            Need one?{' '}
                            <button type="button" className="text-foreground underline underline-offset-4" onClick={() => void bridge.openExternal(service.connectUrl)}>
                                Create a token
                            </button>.
                        </p>
                    </div>
                )}
                <DialogFooter>
                    {connected ? (
                        <>
                            <DialogClose asChild>
                                <Button variant="outline" size="sm" disabled={busy}>Close</Button>
                            </DialogClose>
                            <Button variant="destructive" size="sm" disabled={busy} onClick={disconnect}>
                                {busy ? 'Disconnecting…' : 'Disconnect'}
                            </Button>
                        </>
                    ) : (
                        <>
                            <DialogClose asChild>
                                <Button variant="outline" size="sm" disabled={busy}>Cancel</Button>
                            </DialogClose>
                            <Button size="sm" disabled={busy || !token.trim() || (needsOrg && !org.trim())} onClick={connect}>
                                {busy ? 'Connecting…' : 'Connect'}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
