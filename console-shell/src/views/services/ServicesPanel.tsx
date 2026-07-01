import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    Plug, ExternalLink, Check, Plus, GitBranch, Rocket,
    BarChart3, CreditCard, AlertTriangle, MessageSquare, Lock, Loader2,
} from 'lucide-react';
import { bridge, type VercelDetectedSettings } from '../../lib/bridge';
import { useActiveProject } from '../../lib/activeProject';
import { setLastDeploy } from '../../lib/deployStore';
import { useConnections, useVercelProjects } from '../../lib/queries/connections';
import { useSlackChannels } from '../../lib/queries/slack';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PanelHeader } from '../_shell/PanelHeader';
import { ServicesNewbie } from './ServicesNewbie';
import { ConnectorsSection } from './UsageDashboard';
import { DiscoveredServices } from './DiscoveredServices';
import { CompareServicesButton } from './ServiceComparison';
import { Card as UICard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionLabel } from '@/components/ui';

/**
 * Services panel - Q3d, upgraded to the Phase 3 deploy wedge.
 *
 * GitHub and Vercel are now REAL connections backed by the connections
 * IPC: GitHub reuses `gh` auth, Vercel takes an encrypted personal token.
 * Every other provider keeps the original "open the provider's docs" CTA
 * until its own flow lands.
 */

interface ServiceCard {
    id: string;
    name: string;
    category: 'host' | 'observability' | 'payment' | 'database' | 'auth' | 'analytics' | 'messaging';
    blurb: string;
    icon: React.ComponentType<{ className?: string }>;
    connectUrl: string;
}

const SERVICES: ServiceCard[] = [
    { id: 'github',   name: 'GitHub',      category: 'host',          blurb: 'Repo state, Workboard issues, gh CLI auth.',          icon: GitBranch,   connectUrl: 'https://cli.github.com' },
    { id: 'vercel',   name: 'Vercel',      category: 'host',          blurb: 'Deploy the open project (zero-config), projects, deploy status.', icon: Rocket,      connectUrl: 'https://vercel.com/account/tokens' },
    { id: 'fly',      name: 'Fly.io',      category: 'host',          blurb: 'App status, machine logs, scaling.',                  icon: Rocket,      connectUrl: 'https://fly.io/user/personal_access_tokens' },
    { id: 'sentry',   name: 'Sentry',      category: 'observability', blurb: 'Surface latest errors on the Workboard.',             icon: AlertTriangle,connectUrl: 'https://sentry.io/settings/account/api/auth-tokens/' },
    { id: 'slack',    name: 'Slack',       category: 'messaging',     blurb: 'Pull issue reports into the Workboard by channel.',   icon: MessageSquare,connectUrl: 'https://api.slack.com/apps' },
    { id: 'plausible',name: 'Plausible',   category: 'analytics',     blurb: 'Privacy-first traffic counters.',                     icon: BarChart3,   connectUrl: 'https://plausible.io/settings/api-keys' },
    { id: 'stripe',   name: 'Stripe',      category: 'payment',       blurb: 'Live revenue and subscription state.',                icon: CreditCard,  connectUrl: 'https://dashboard.stripe.com/apikeys' },
];
// Netlify / Railway / PostHog / Supabase moved to the connector platform
// (ConnectorsSection) where they connect for real and show usage.

const CATEGORIES: { id: ServiceCard['category']; label: string }[] = [
    { id: 'host',          label: 'Hosting' },
    { id: 'observability', label: 'Observability' },
    { id: 'messaging',     label: 'Messaging' },
    { id: 'analytics',     label: 'Analytics' },
    { id: 'database',      label: 'Database' },
    { id: 'payment',       label: 'Payment' },
    { id: 'auth',          label: 'Auth' },
];

export function ServicesPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <ServicesNewbie />;
    return <ServicesSeasoned />;
}

type ConnStatus = 'loading' | 'error' | 'connected' | 'disconnected';

function ServicesSeasoned() {
    const qc = useQueryClient();
    const connections = useConnections();
    const github = connections.data?.github;
    const vercel = connections.data?.vercel;
    const sentry = connections.data?.sentry;
    const slack = connections.data?.slack;
    const vercelProjects = useVercelProjects(vercel?.connected ?? false);
    const activeProject = useActiveProject();

    // Resolve the shared real-connection status once: while the connections
    // query is in flight we show "Checking…", on failure we say so, and only
    // a settled response flips a card to Connected / Not connected.
    function statusFor(connected: boolean | undefined): ConnStatus {
        if (connections.isError) return 'error';
        if (connections.isLoading || connections.data === undefined) return 'loading';
        return connected ? 'connected' : 'disconnected';
    }
    const githubStatus = statusFor(github?.connected);
    const vercelStatus = statusFor(vercel?.connected);
    const sentryStatus = statusFor(sentry?.connected);
    const slackStatus = statusFor(slack?.connected);

    // The "open docs" providers (everything but github/vercel) keep their
    // original local toggle so the visual affordance is unchanged.
    const [openedDocs, setOpenedDocs] = useState<Set<string>>(new Set());

    function invalidateConnections() {
        void qc.invalidateQueries({ queryKey: ['connections'] });
    }

    const [heroBusy, setHeroBusy] = useState(false);
    async function connectGithubHero() {
        setHeroBusy(true);
        try { await bridge.connections.github.connect(); invalidateConnections(); } catch { /* noop */ }
        setHeroBusy(false);
    }

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="services-panel">
            <PanelHeader
                icon={Plug}
                title="Services"
                subtitle="Connect hosting, observability, payments, and storage"
                testid="services-panel-header"
            >
                <CompareServicesButton />
                <Button variant="outline" size="sm" disabled title="Coming soon">
                    <Plus className="h-3 w-3" />
                    Add MCP server
                </Button>
            </PanelHeader>

            <div className="flex flex-col gap-8 p-6">
                {githubStatus === 'disconnected' && (
                    <section className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-subtle/30 p-5 sm:flex-row sm:items-center sm:gap-4" data-testid="services-hero">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-solid text-accent-foreground">
                            <GitBranch className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-card-title text-foreground">Connect GitHub to get started</h3>
                            <p className="text-small leading-relaxed text-muted-foreground">It powers your workboard, releases, and repo intelligence. Reuses your gh CLI login - no token to paste.</p>
                        </div>
                        <Button variant="primary" className="shrink-0 self-start sm:self-auto" disabled={heroBusy} onClick={connectGithubHero} data-testid="services-hero-connect">
                            {heroBusy ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />} Connect GitHub
                        </Button>
                    </section>
                )}
                <DiscoveredServices onConnected={invalidateConnections} />
                <ConnectorsSection />
                {CATEGORIES.map((cat) => {
                    const cards = SERVICES.filter((s) => s.category === cat.id);
                    if (cards.length === 0) return null;
                    return (
                        <section key={cat.id} data-testid={`services-cat-${cat.id}`} className="flex flex-col gap-3">
                            <SectionLabel>{cat.label}</SectionLabel>
                            <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {cards.map((s) => {
                                    if (s.id === 'github') {
                                        return (
                                            <GithubCard
                                                key={s.id}
                                                service={s}
                                                status={githubStatus}
                                                connected={github?.connected ?? false}
                                                login={github?.login}
                                                onChanged={invalidateConnections}
                                            />
                                        );
                                    }
                                    if (s.id === 'vercel') {
                                        return (
                                            <VercelCard
                                                key={s.id}
                                                service={s}
                                                status={vercelStatus}
                                                connected={vercel?.connected ?? false}
                                                user={vercel?.user}
                                                projectCount={vercelProjects.data?.length}
                                                projectPath={activeProject.project?.path}
                                                onChanged={invalidateConnections}
                                            />
                                        );
                                    }
                                    if (s.id === 'sentry') {
                                        return (
                                            <SentryCard
                                                key={s.id}
                                                service={s}
                                                status={sentryStatus}
                                                connected={sentry?.connected ?? false}
                                                org={sentry?.org ?? sentry?.user}
                                                onChanged={invalidateConnections}
                                            />
                                        );
                                    }
                                    if (s.id === 'slack') {
                                        return (
                                            <SlackCard
                                                key={s.id}
                                                service={s}
                                                status={slackStatus}
                                                connected={slack?.connected ?? false}
                                                team={slack?.team}
                                                onChanged={invalidateConnections}
                                            />
                                        );
                                    }
                                    return (
                                        <DocsCard
                                            key={s.id}
                                            service={s}
                                            opened={openedDocs.has(s.id)}
                                            onToggle={() => {
                                                setOpenedDocs((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(s.id)) next.delete(s.id);
                                                    else next.add(s.id);
                                                    return next;
                                                });
                                                void bridge.openExternal(s.connectUrl);
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}

// ── .env auto-connect (transient value read main-side; never returned) ──

// ── GitHub card (real: gh auth) ─────────────────────────────────────────
function GithubCard({
    service, status, connected, login, onChanged,
}: {
    service: ServiceCard;
    status: ConnStatus;
    connected: boolean;
    login?: string;
    onChanged: () => void;
}) {
    const [busy, setBusy] = useState(false);

    async function connect() {
        setBusy(true);
        try {
            const res = await bridge.connections.github.connect();
            if (res.ok) {
                toast.success(res.login ? `Connected to GitHub as ${res.login}` : 'Connected to GitHub');
                onChanged();
            } else {
                toast.error(res.error ?? 'Could not connect to GitHub');
            }
        } catch (err) {
            toast.error(`GitHub connect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        try {
            const res = await bridge.connections.github.disconnect();
            if (res.ok) { toast.success('Disconnected GitHub'); onChanged(); }
            else toast.error(res.error ?? 'Could not disconnect');
        } catch (err) {
            toast.error(`GitHub disconnect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <ConnectionCard service={service} status={status} connected={connected}>
            {connected ? (
                <>
                    <p className="text-small text-muted-foreground">
                        Connected as <span className="text-foreground">{login ?? 'unknown'}</span>
                    </p>
                    <Button variant="outline" size="sm" className="mt-auto self-start" disabled={busy} onClick={disconnect}>
                        Disconnect
                    </Button>
                </>
            ) : (
                <Button variant="outline" size="sm" className="mt-auto self-start" disabled={busy} onClick={connect}>
                    {busy ? 'Connecting…' : 'Connect'}
                </Button>
            )}
        </ConnectionCard>
    );
}

// ── Vercel card (real: encrypted token) ─────────────────────────────────
function VercelCard({
    service, status, connected, user, projectCount, projectPath, onChanged,
}: {
    service: ServiceCard;
    status: ConnStatus;
    connected: boolean;
    user?: string;
    projectCount?: number;
    projectPath?: string;
    onChanged: () => void;
}) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);

    // Deploy-the-open-project flow (zero-config: detect -> deploy -> poll).
    const [deployOpen, setDeployOpen] = useState(false);
    const [detected, setDetected] = useState<VercelDetectedSettings | null>(null);
    const [deployName, setDeployName] = useState('');
    const [deploying, setDeploying] = useState(false);
    const [deployStatus, setDeployStatus] = useState('');
    const [deployedUrl, setDeployedUrl] = useState('');

    async function openDeploy() {
        if (!projectPath) { toast.error('Open a project first.'); return; }
        const res = await bridge.connections.vercel.detectDeploy(projectPath);
        if (!res.ok || !res.settings) { toast.error(res.error ?? 'Could not read the project'); return; }
        setDetected(res.settings);
        setDeployName(res.settings.suggestedName);
        setDeployStatus('');
        setDeployedUrl('');
        setDeployOpen(true);
    }

    function pollState(id: string) {
        void (async () => {
            const st = await bridge.connections.vercel.deployState(id);
            if (st.ok) {
                setDeployStatus(st.state ?? 'BUILDING');
                if (st.url) setDeployedUrl(`https://${st.url}`);
                if (st.state === 'READY') {
                    setLastDeploy(projectPath ?? '', { url: st.url ?? '', name: deployName.trim() || (detected?.suggestedName ?? ''), id, at: Date.now() });
                    toast.success('Deployed to Vercel'); setDeploying(false); onChanged(); return;
                }
                if (st.state === 'ERROR' || st.state === 'CANCELED') { toast.error(`Deploy ${(st.state ?? '').toLowerCase()}`); setDeploying(false); return; }
            }
            setTimeout(() => pollState(id), 3000);
        })();
    }

    async function runDeploy() {
        if (!projectPath || !detected) return;
        setDeploying(true);
        setDeployStatus('Uploading…');
        setDeployedUrl('');
        try {
            const res = await bridge.connections.vercel.deploy(projectPath, {
                name: deployName.trim() || detected.suggestedName,
                framework: detected.framework,
                buildCommand: detected.buildCommand,
                outputDirectory: detected.outputDirectory,
                installCommand: detected.installCommand,
                target: 'production',
            });
            if (!res.ok || !res.deployment) { toast.error(res.error ?? 'Deploy failed'); setDeploying(false); setDeployStatus(''); return; }
            if (res.deployment.url) setDeployedUrl(`https://${res.deployment.url}`);
            setDeployStatus('Building…');
            pollState(res.deployment.id);
        } catch (err) {
            toast.error(`Deploy failed: ${String(err)}`);
            setDeploying(false);
            setDeployStatus('');
        }
    }

    async function connect() {
        if (token.trim().length === 0) {
            toast.error('Paste a Vercel token first.');
            return;
        }
        setBusy(true);
        try {
            const res = await bridge.connections.vercel.connect(token.trim());
            if (res.ok) {
                toast.success(res.user ? `Connected to Vercel as ${res.user}` : 'Connected to Vercel');
                setToken('');
                setDialogOpen(false);
                onChanged();
            } else {
                toast.error(res.error ?? 'Could not connect to Vercel');
            }
        } catch (err) {
            toast.error(`Vercel connect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        try {
            const res = await bridge.connections.vercel.disconnect();
            if (res.ok) { toast.success('Disconnected Vercel'); onChanged(); }
            else toast.error(res.error ?? 'Could not disconnect');
        } catch (err) {
            toast.error(`Vercel disconnect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <ConnectionCard service={service} status={status} connected={connected}>
            {connected ? (
                <>
                    <p className="text-small text-muted-foreground">
                        Connected as <span className="text-foreground">{user ?? 'unknown'}</span>
                        {typeof projectCount === 'number' && (
                            <> · {projectCount} {projectCount === 1 ? 'project' : 'projects'}</>
                        )}
                    </p>
                    <div className="mt-auto flex items-center gap-2">
                        <Button
                            size="sm"
                            disabled={busy || !projectPath}
                            onClick={() => void openDeploy()}
                            title={projectPath ? 'Deploy the open project to Vercel' : 'Open a project first'}
                        >
                            <Rocket className="h-3 w-3" /> Deploy
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={disconnect}>
                            Disconnect
                        </Button>
                    </div>
                    <Dialog open={deployOpen} onOpenChange={(o) => { if (!deploying) setDeployOpen(o); }}>
                        <DialogContent data-testid="vercel-deploy-dialog">
                            <DialogHeader>
                                <DialogTitle>Deploy to Vercel</DialogTitle>
                                <DialogDescription>
                                    {detected?.isStatic
                                        ? 'No build step detected - Console will deploy this as a static site.'
                                        : `Detected ${detected?.framework ?? 'a build setup'} - Vercel will build and deploy it. No vercel.json needed.`}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="deploy-name">Project name</Label>
                                <Input
                                    id="deploy-name"
                                    value={deployName}
                                    disabled={deploying}
                                    onChange={(e) => setDeployName(e.target.value)}
                                />
                                {detected && (
                                    <p className="text-small text-muted-foreground">
                                        Framework: <span className="font-mono">{detected.framework ?? 'static'}</span>
                                        {' · '}Output: <span className="font-mono">{detected.outputDirectory ?? '(auto)'}</span>
                                    </p>
                                )}
                                {deployStatus && (
                                    <p className="text-small">Status: <span className="font-mono">{deployStatus}</span></p>
                                )}
                                {deployedUrl && (
                                    <button
                                        type="button"
                                        className="self-start text-small text-accent underline underline-offset-4"
                                        onClick={() => void bridge.openExternal(deployedUrl)}
                                    >
                                        {deployedUrl}
                                    </button>
                                )}
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline" size="sm" disabled={deploying}>Close</Button>
                                </DialogClose>
                                <Button size="sm" disabled={deploying || !detected} onClick={() => void runDeploy()}>
                                    {deploying ? 'Deploying…' : 'Deploy to production'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            ) : (
                <>
                    <Button variant="outline" size="sm" className="mt-auto self-start" onClick={() => setDialogOpen(true)}>
                        Connect
                    </Button>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogContent data-testid="vercel-connect-dialog">
                            <DialogHeader>
                                <DialogTitle>Connect Vercel</DialogTitle>
                                <DialogDescription>
                                    Paste a Vercel access token. It is encrypted with your OS keychain and never leaves this machine.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="vercel-token">Access token</Label>
                                <Input
                                    id="vercel-token"
                                    type="password"
                                    autoFocus
                                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                                    value={token}
                                    onChange={(e) => setToken(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
                                />
                                <p className="text-small text-muted-foreground">
                                    Need one?{' '}
                                    <button
                                        type="button"
                                        className="text-foreground underline underline-offset-4"
                                        onClick={() => void bridge.openExternal('https://vercel.com/account/tokens')}
                                    >
                                        Create a token
                                    </button>{' '}
                                    on Vercel.
                                </p>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline" size="sm" disabled={busy}>Cancel</Button>
                                </DialogClose>
                                <Button size="sm" disabled={busy} onClick={connect}>
                                    {busy ? 'Connecting…' : 'Connect'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )}
        </ConnectionCard>
    );
}

// ── Sentry card (real: encrypted token + org slug) ──────────────────────
function SentryCard({
    service, status, connected, org, onChanged,
}: {
    service: ServiceCard;
    status: ConnStatus;
    connected: boolean;
    org?: string;
    onChanged: () => void;
}) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [token, setToken] = useState('');
    const [orgSlug, setOrgSlug] = useState('');
    const [busy, setBusy] = useState(false);

    async function connect() {
        if (token.trim().length === 0) {
            toast.error('Paste a Sentry token first.');
            return;
        }
        if (orgSlug.trim().length === 0) {
            toast.error('Enter your Sentry organization slug.');
            return;
        }
        setBusy(true);
        try {
            const res = await bridge.connections.sentry.connect(token.trim(), orgSlug.trim());
            if (res.ok) {
                toast.success(res.org ? `Connected to Sentry (${res.org})` : 'Connected to Sentry');
                setToken('');
                setOrgSlug('');
                setDialogOpen(false);
                onChanged();
            } else {
                toast.error(res.error ?? 'Could not connect to Sentry');
            }
        } catch (err) {
            toast.error(`Sentry connect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        try {
            const res = await bridge.connections.sentry.disconnect();
            if (res.ok) { toast.success('Disconnected Sentry'); onChanged(); }
            else toast.error(res.error ?? 'Could not disconnect');
        } catch (err) {
            toast.error(`Sentry disconnect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <ConnectionCard service={service} status={status} connected={connected}>
            {connected ? (
                <>
                    <p className="text-small text-muted-foreground">
                        Connected: <span className="text-foreground">{org ?? 'sentry'}</span>
                    </p>
                    <Button variant="outline" size="sm" className="mt-auto self-start" disabled={busy} onClick={disconnect}>
                        Disconnect
                    </Button>
                </>
            ) : (
                <>
                    <Button variant="outline" size="sm" className="mt-auto self-start" onClick={() => setDialogOpen(true)}>
                        Connect
                    </Button>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogContent data-testid="sentry-connect-dialog">
                            <DialogHeader>
                                <DialogTitle>Connect Sentry</DialogTitle>
                                <DialogDescription>
                                    Paste a Sentry auth token and your organization slug. The token is encrypted with your OS keychain and never leaves this machine.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="sentry-token">Auth token</Label>
                                <Input
                                    id="sentry-token"
                                    type="password"
                                    autoFocus
                                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                                    value={token}
                                    onChange={(e) => setToken(e.target.value)}
                                />
                                <Label htmlFor="sentry-org" className="mt-2">Organization slug</Label>
                                <Input
                                    id="sentry-org"
                                    placeholder="my-org"
                                    value={orgSlug}
                                    onChange={(e) => setOrgSlug(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
                                />
                                <p className="text-small text-muted-foreground">
                                    Need one?{' '}
                                    <button
                                        type="button"
                                        className="text-foreground underline underline-offset-4"
                                        onClick={() => void bridge.openExternal('https://sentry.io/settings/account/api/auth-tokens/')}
                                    >
                                        Create a token
                                    </button>{' '}
                                    on Sentry.
                                </p>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline" size="sm" disabled={busy}>Cancel</Button>
                                </DialogClose>
                                <Button size="sm" disabled={busy} onClick={connect}>
                                    {busy ? 'Connecting…' : 'Connect'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )}
        </ConnectionCard>
    );
}

// ── Slack card (real: encrypted xoxb bot token + per-channel team map) ──
function SlackCard({
    service, status, connected, team, onChanged,
}: {
    service: ServiceCard;
    status: ConnStatus;
    connected: boolean;
    team?: string;
    onChanged: () => void;
}) {
    const qc = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [mapOpen, setMapOpen] = useState(false);
    const channels = useSlackChannels(connected);

    async function connect() {
        if (token.trim().length === 0) {
            toast.error('Paste a Slack bot token first.');
            return;
        }
        setBusy(true);
        try {
            const res = await bridge.connections.slack.connect(token.trim());
            if (res.ok) {
                toast.success(res.team ? `Connected to Slack (${res.team})` : 'Connected to Slack');
                setToken('');
                setDialogOpen(false);
                onChanged();
            } else {
                toast.error(res.error ?? 'Could not connect to Slack');
            }
        } catch (err) {
            toast.error(`Slack connect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        try {
            const res = await bridge.connections.slack.disconnect();
            if (res.ok) { toast.success('Disconnected Slack'); onChanged(); }
            else toast.error(res.error ?? 'Could not disconnect');
        } catch (err) {
            toast.error(`Slack disconnect failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    async function setChannelTeam(channelId: string, value: string) {
        try {
            const res = await bridge.slack.setChannelTeam(channelId, value);
            if (res.ok) {
                void qc.invalidateQueries({ queryKey: ['slack', 'channels'] });
                void qc.invalidateQueries({ queryKey: ['slack', 'issues'] });
            } else {
                toast.error(res.error ?? 'Could not set channel team');
            }
        } catch (err) {
            toast.error(`Set channel team failed: ${String(err)}`);
        }
    }

    return (
        <ConnectionCard service={service} status={status} connected={connected}>
            {connected ? (
                <>
                    <p className="text-small text-muted-foreground">
                        Connected: <span className="text-foreground">{team ?? 'workspace'}</span>
                    </p>
                    <div className="mt-auto flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setMapOpen(true)} data-testid="slack-map-channels">
                            Map channels
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={disconnect}>
                            Disconnect
                        </Button>
                    </div>
                    <Dialog open={mapOpen} onOpenChange={setMapOpen}>
                        <DialogContent data-testid="slack-map-dialog">
                            <DialogHeader>
                                <DialogTitle>Map channels to teams</DialogTitle>
                                <DialogDescription>
                                    Tag the channels you want pulled into the Workboard. Each
                                    channel maps to one team: Tech, Non-tech, or Test.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                                {channels.isLoading && (
                                    <p className="text-small text-muted-foreground">Loading channels...</p>
                                )}
                                {channels.isSuccess && channels.data.length === 0 && (
                                    <p className="text-small text-muted-foreground">
                                        No channels visible. Invite the bot to the channels you want to watch.
                                    </p>
                                )}
                                {channels.data?.map((c) => (
                                    <div key={c.id} className="flex items-center gap-2" data-testid={`slack-channel-${c.id}`}>
                                        <span className="min-w-0 flex-1 truncate font-mono text-small text-foreground">
                                            #{c.name}
                                        </span>
                                        <Select
                                            defaultValue={c.team ?? 'none'}
                                            onValueChange={(v) => void setChannelTeam(c.id, v)}
                                        >
                                            <SelectTrigger className="w-36" data-testid={`slack-channel-team-${c.id}`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Not watched</SelectItem>
                                                <SelectItem value="tech">Tech</SelectItem>
                                                <SelectItem value="nontech">Non-tech</SelectItem>
                                                <SelectItem value="test">Test</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ))}
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline" size="sm">Done</Button>
                                </DialogClose>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            ) : (
                <>
                    <Button variant="outline" size="sm" className="mt-auto self-start" onClick={() => setDialogOpen(true)}>
                        Connect
                    </Button>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogContent data-testid="slack-connect-dialog">
                            <DialogHeader>
                                <DialogTitle>Connect Slack</DialogTitle>
                                <DialogDescription>
                                    Paste a Slack bot token (starts with xoxb-). It is encrypted with your OS keychain and never leaves this machine. The bot needs channels:read and channels:history (and groups:history for private channels).
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="slack-token">Bot token</Label>
                                <Input
                                    id="slack-token"
                                    type="password"
                                    autoFocus
                                    placeholder="xoxb-..."
                                    value={token}
                                    onChange={(e) => setToken(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
                                />
                                <p className="text-small text-muted-foreground">
                                    Need one?{' '}
                                    <button
                                        type="button"
                                        className="text-foreground underline underline-offset-4"
                                        onClick={() => void bridge.openExternal('https://api.slack.com/apps')}
                                    >
                                        Create a Slack app
                                    </button>{' '}
                                    and install it to your workspace.
                                </p>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline" size="sm" disabled={busy}>Cancel</Button>
                                </DialogClose>
                                <Button size="sm" disabled={busy} onClick={connect}>
                                    {busy ? 'Connecting…' : 'Connect'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )}
        </ConnectionCard>
    );
}

// ── Real-connection card chrome (GitHub + Vercel share this) ────────────
function ConnectionCard({
    service, status, connected, children,
}: React.PropsWithChildren<{ service: ServiceCard; status: ConnStatus; connected: boolean }>) {
    return (
        <UICard
            data-testid={`service-${service.id}`}
            className={`group relative flex h-full flex-col gap-2.5 p-4 shadow-none transition-colors ${
                connected ? 'border-ring' : ''
            }`}
        >
            <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
                    <service.icon className="h-3.5 w-3.5 text-foreground" />
                </div>
                <h3 className="text-card-title text-foreground">{service.name}</h3>
                <ConnectionBadge status={status} />
            </div>
            <p className="text-small leading-relaxed text-muted-foreground">{service.blurb}</p>
            {children}
        </UICard>
    );
}

// Status pill for the real-connection cards. Avoids asserting "Not connected"
// before the connections query has settled (or when it fails), which used to
// flash on every load and hide backend failures.
function ConnectionBadge({ status }: { status: ConnStatus }) {
    if (status === 'connected') {
        return (
            <Badge variant="success" className="ml-auto rounded-md">
                <Check className="h-2.5 w-2.5" />
                Connected
            </Badge>
        );
    }
    if (status === 'loading') {
        return (
            <Badge variant="secondary" className="ml-auto rounded-md text-muted-foreground">
                Checking…
            </Badge>
        );
    }
    if (status === 'error') {
        return (
            <Badge variant="secondary" className="ml-auto rounded-md text-muted-foreground">
                Couldn’t check connections
            </Badge>
        );
    }
    return (
        <Badge variant="secondary" className="ml-auto rounded-md">
            Not connected
        </Badge>
    );
}

// ── Docs card (all non-real providers keep "open docs") ─────────────────
function DocsCard({
    service, opened, onToggle,
}: {
    service: ServiceCard;
    opened: boolean;
    onToggle: () => void;
}) {
    return (
        <UICard
            data-testid={`service-${service.id}`}
            onClick={onToggle}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
            className={`group relative flex h-full cursor-pointer flex-col gap-2.5 p-4 shadow-none transition-colors hover:bg-secondary/30 ${
                opened ? 'border-ring' : 'hover:border-ring/60'
            }`}
        >
            <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
                    <service.icon className="h-3.5 w-3.5 text-foreground" />
                </div>
                <h3 className="text-card-title text-foreground">{service.name}</h3>
                <Badge variant="secondary" className="ml-auto rounded-md">
                    Not connected
                </Badge>
            </div>
            <p className="text-small leading-relaxed text-muted-foreground">{service.blurb}</p>
            <Button
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onToggle(); }}
                className="mt-auto self-start"
            >
                Connect
                <ExternalLink className="h-2.5 w-2.5" />
            </Button>
        </UICard>
    );
}
