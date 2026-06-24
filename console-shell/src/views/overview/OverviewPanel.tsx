import { useMetricsSummary } from '../../lib/queries/metrics';
import { useReleaseList, useReleaseSummary } from '../../lib/queries/release';
import { useObsCounters } from '../../lib/queries/observability';
import { useRepoSummary } from '../../lib/queries/repo';
import { useRecentCommits } from '../../lib/queries/activity';
import { useProjectShape } from '../../lib/queries/project';
import { useActiveProject } from '../../lib/activeProject';
import { getLastDeploy } from '../../lib/deployStore';
import { shapeSubtitle } from '../../lib/projectShape';
import { useConnections, useVercelDeployments } from '../../lib/queries/connections';
import {
    Coins, GitCommit, FlaskConical, Hammer, CheckCircle2,
    TriangleAlert, CircleCheck, CloudUpload, ExternalLink,
    LayoutDashboard,
} from 'lucide-react';
import { Link } from 'react-router';
import NumberFlow from '@number-flow/react';
import { Card, SectionLabel, Badge, Button, Stat, StatLabel, StatValue, StatHint } from '@/components/ui';
import { bridge } from '../../lib/bridge';
import type { MetricsSummary, ReleaseSummary, VercelDeployment } from '../../lib/bridge';
import { WhatsNextTile } from './WhatsNextTile';
import { humanizeCommitSubject } from '../../lib/humanize';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { OverviewNewbie } from './OverviewNewbie';
import { Donut } from '../../components/viz';
import { PanelHeader } from '../_shell/PanelHeader';

/**
 * Overview - the Console's landing surface.
 *
 * Operator (seasoned) is a status-first cockpit: a single focal ship card
 * paired with the release-gate donut answers "can I ship?" at a glance, an
 * alert/next-step strip surfaces what needs attention, then a vitals row of
 * plain number cards, then the real git activity feed. The 90-day commit
 * heat-strip is omitted: the activity bridge caps history at 50 commits and
 * exposes no per-day count series, so a real strip can't be drawn.
 * Guided (newbie) is a separate, oriented surface (OverviewNewbie).
 */
export function OverviewPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <OverviewNewbie />;
    return <OverviewSeasoned />;
}

function pluralize(n: number, single: string, plural: string) {
    return n === 1 ? single : plural;
}

// The Build vital reflects the project's real latest CI run; 'none' reads as
// 'idle' so a repo with no CI does not imply a failure.
function ciLabel(status: MetricsSummary['ci']['status']): string {
    return status === 'none' ? 'idle' : status;
}

// Pass rate over passed/failed/errors. Returns a whole percent; 0 total
// reads as 0 rather than NaN.
function evalPassRate(p: { passed: number; failed: number; errors: number }): number {
    const total = p.passed + p.failed + p.errors;
    if (total === 0) return 0;
    return Math.round((p.passed / total) * 100);
}

interface Alert { label: string; tone: 'rose' | 'amber'; to?: string }

function OverviewSeasoned() {
    const metrics = useMetricsSummary();
    const releases = useReleaseList();
    const release = useReleaseSummary(releases.data?.[0]?.version ?? null);
    const obs = useObsCounters();
    const repo = useRepoSummary();
    const commits = useRecentCommits(6);
    const { project } = useActiveProject();
    const shape = useProjectShape(project?.path ?? '');
    const shapeLine = shape.data ? shapeSubtitle(shape.data, repo.data?.total_loc) : '';
    const connections = useConnections();
    const vercelConnected = connections.data?.vercel.connected ?? false;
    const deployments = useVercelDeployments(vercelConnected);
    // Scope the deployment card to THIS project: show only what Console deployed
    // for it. A never-deployed project must not show the account's global latest
    // deployment (which would be an unrelated project's URL).
    const stored = getLastDeploy(project?.path ?? '');
    const latestDeployment = stored
        ? (deployments.data?.find((d) => d.id === stored.id || d.url === stored.url)
            ?? { id: stored.id, name: stored.name, url: stored.url, state: 'READY', createdAt: stored.at, target: 'production' })
        : undefined;

    // Both Tests and Evals empty (loaded, zero runs) read as two near-blank
    // cells; collapse them into one inviting prompt instead.
    const testsAndEvalsEmpty =
        !!obs.data && obs.data.runs_last_24h === 0 &&
        !!metrics.data && !metrics.data.promptfoo.present;

    const alerts: Alert[] = [];
    if (release.data) {
        if (release.data.red > 0) alerts.push({ label: `${release.data.red} ${pluralize(release.data.red, 'gate', 'gates')} failing`, tone: 'rose', to: '/release' });
        if (release.data.overall_status === 'blocked' && release.data.blocked > 0)
            alerts.push({ label: `${release.data.blocked} ${pluralize(release.data.blocked, 'gate', 'gates')} blocked`, tone: 'amber', to: '/release' });
    }
    if (obs.data && obs.data.errors_last_24h > 0)
        alerts.push({ label: `${obs.data.errors_last_24h} ${pluralize(obs.data.errors_last_24h, 'error', 'errors')} in 24h`, tone: 'rose', to: '/observability' });
    if (metrics.data?.promptfoo.present && metrics.data.promptfoo.failed > 0)
        alerts.push({ label: `${metrics.data.promptfoo.failed} eval ${pluralize(metrics.data.promptfoo.failed, 'failure', 'failures')}`, tone: 'rose', to: '/observability' });

    return (
        <div className="flex h-full flex-col overflow-y-auto" data-testid="overview-panel">
            <PanelHeader
                icon={LayoutDashboard}
                title="Overview"
                subtitle={shapeLine
                    ? <span data-testid="overview-shape-line">{shapeLine}</span>
                    : 'Live state of the project, most urgent first.'}
                testid="overview-panel-header"
            />

            <div className="px-6 pt-4">
                <AlertStrip alerts={alerts} loading={!release.data && release.isLoading} />
            </div>

            {/* Focal row - the one question that matters: can I ship? The ship
                card carries the single primary action; the donut answers the
                gate breakdown as a part-of-whole the count alone can't. */}
            <section className="px-6 pt-5">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <ShipCard release={release.data} loading={!release.data && release.isLoading} />
                    <ReleaseGatesCard release={release.data} loading={!release.data && release.isLoading} />
                </div>
            </section>

            {/* Vitals - clean number cards, tabular. No hollow gauges; Evals
                shows its real empty state rather than a fake chart. When both
                Tests and Evals have no runs, those two empty cells collapse to
                one inviting prompt rather than two near-blank stat cells. */}
            <Section title="Vitals" className="mt-7">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {testsAndEvalsEmpty ? (
                        <EmptyTestsEvalsPrompt sbom={metrics.data?.sbom} />
                    ) : (
                        <VitalCell to="/observability">
                            <Stat>
                                <StatLabel icon={FlaskConical}>Tests</StatLabel>
                                {obs.data ? (
                                    obs.data.runs_last_24h > 0 ? (
                                        <>
                                            <StatValue>
                                                <NumberFlow value={obs.data.runs_last_24h} />
                                            </StatValue>
                                            <StatHint>
                                                {obs.data.errors_last_24h === 0
                                                    ? 'all passing in 24h'
                                                    : `${obs.data.errors_last_24h} ${pluralize(obs.data.errors_last_24h, 'error', 'errors')} in 24h`}
                                            </StatHint>
                                        </>
                                    ) : (
                                        <>
                                            <StatValue className="text-muted-foreground">0</StatValue>
                                            <StatHint>No test runs in 24h</StatHint>
                                        </>
                                    )
                                ) : <CellSkeleton />}
                            </Stat>
                        </VitalCell>
                    )}

                    <VitalCell to="/pipeline">
                        <Stat>
                            <StatLabel icon={Hammer}>Build</StatLabel>
                            {metrics.data ? (
                                <>
                                    <StatValue className="text-section">
                                        {ciLabel(metrics.data.ci.status)}
                                    </StatValue>
                                    <StatHint className="truncate">
                                        {metrics.data.ci.configured
                                            ? (metrics.data.ci.workflow ?? 'latest CI run')
                                            : 'No CI runs found'}
                                    </StatHint>
                                </>
                            ) : <CellSkeleton />}
                        </Stat>
                    </VitalCell>

                    <VitalCell to="/observability">
                        <Stat>
                            <StatLabel icon={Coins}>Cost today</StatLabel>
                            {metrics.data ? (
                                <>
                                    <StatValue>
                                        <NumberFlow
                                            value={metrics.data.cost_today_usd}
                                            format={{ style: 'currency', currency: 'USD' }}
                                        />
                                    </StatValue>
                                    <StatHint>
                                        {metrics.data.cost_today_usd === 0 ? 'No AI spend tracked yet' : 'AI spend today'}
                                    </StatHint>
                                </>
                            ) : <CellSkeleton />}
                        </Stat>
                    </VitalCell>

                    {/* When combined-empty the prompt above carries the
                        eval/SBOM testids, so suppress this duplicate cell. */}
                    {!testsAndEvalsEmpty && (
                        <VitalCell to="/observability">
                            <Stat>
                                <StatLabel icon={CheckCircle2}>Evals</StatLabel>
                                {metrics.data ? (
                                    metrics.data.promptfoo.present ? (
                                        <div data-testid="overview-eval-passrate" className="flex flex-col gap-2">
                                            <StatValue>{evalPassRate(metrics.data.promptfoo)}%</StatValue>
                                            <StatHint className="tabular-nums">
                                                {metrics.data.promptfoo.passed} pass · {metrics.data.promptfoo.failed} fail
                                                {metrics.data.promptfoo.errors > 0 ? ` · ${metrics.data.promptfoo.errors} err` : ''}
                                                <span className="ml-1" data-testid="overview-sbom-count">
                                                    {metrics.data.sbom.present ? `· ${metrics.data.sbom.components.toLocaleString()} SBOM` : ''}
                                                </span>
                                            </StatHint>
                                        </div>
                                    ) : (
                                        <>
                                            <StatValue className="text-muted-foreground">No runs</StatValue>
                                            <StatHint data-testid="overview-eval-passrate">No eval runs yet</StatHint>
                                            <span className="hidden" data-testid="overview-sbom-count">
                                                {metrics.data.sbom.present ? metrics.data.sbom.components : 0}
                                            </span>
                                        </>
                                    )
                                ) : <CellSkeleton />}
                            </Stat>
                        </VitalCell>
                    )}

                    {vercelConnected && (
                        <DeploymentCell deployment={latestDeployment} loading={deployments.isLoading} />
                    )}
                </div>
            </Section>

            {/* Next - the action queue. The headline alert already states the
                single most urgent item, so suppress the matching top NEXT row
                (same 'to') to avoid saying it twice. */}
            <Section title="Next" className="mt-7">
                <WhatsNextTile
                    metrics={metrics.data}
                    release={release.data}
                    obs={obs.data}
                    suppressTopTo={alerts[0]?.to}
                    hideHeader
                />
            </Section>

            {/* Activity - real git history */}
            <Section title="Recent activity" action={<Link to="/activity" className="text-small text-accent hover:underline">View all</Link>} className="mt-7">
                <Card className="gap-0 p-0 shadow-none">
                    {commits.isLoading ? (
                        <div className="flex flex-col gap-2 p-4">
                            {[0, 1, 2].map((i) => <div key={i} className="h-3 animate-pulse rounded bg-secondary/40" style={{ width: `${80 - i * 12}%` }} />)}
                        </div>
                    ) : commits.data && commits.data.length > 0 ? (
                        <ul className="divide-y divide-border/60">
                            {commits.data.map((c) => (
                                <li key={c.hash} className="group flex items-center gap-3 px-4 py-2.5">
                                    <GitCommit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    {/* Subject stays neutral so the feed reads as body text, not a
                                        column of accent links; the row's hover underline is the cue.
                                        Blue is reserved for the single "View all" affordance above. */}
                                    <span className="flex-1 truncate text-body text-foreground decoration-border underline-offset-4 group-hover:underline">{humanizeCommitSubject(c.subject)}</span>
                                    <span className="shrink-0 font-mono text-small text-muted-foreground/70">{c.hash}</span>
                                    <span className="w-24 shrink-0 text-right text-small text-muted-foreground tabular-nums">{c.relativeTime}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="px-4 py-5 text-body text-muted-foreground">
                            No commits found. This isn't a git checkout, or git isn't on PATH.
                        </p>
                    )}
                </Card>
            </Section>

            <div className="h-8" />
        </div>
    );
}

// -- Cockpit primitives --------------------------------------------------

function AlertStrip({ alerts, loading }: { alerts: Alert[]; loading: boolean }) {
    if (loading) {
        return <div className="h-9 animate-pulse rounded-lg bg-secondary/40" />;
    }
    if (alerts.length === 0) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/[0.07] px-3.5 py-2 text-body text-success-text">
                <CircleCheck className="h-4 w-4" />
                <span className="font-medium">All systems healthy.</span>
                <span className="text-success-text/70">Nothing needs your attention right now.</span>
            </div>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning/30 bg-warning/[0.06] px-3.5 py-2 text-body">
            <TriangleAlert className="h-4 w-4 shrink-0 text-warning-text" />
            <span className="font-medium text-foreground">Needs attention:</span>
            {alerts.map((a, i) => {
                const inner = (
                    <>
                        <span className={`h-1.5 w-1.5 rounded-full ${a.tone === 'rose' ? 'bg-danger' : 'bg-warning'}`} />
                        <span>{a.label}</span>
                    </>
                );
                return (
                    <span key={i} className="inline-flex items-center gap-1.5">
                        {i > 0 && <span className="text-muted-foreground/40">·</span>}
                        {a.to ? (
                            <Link to={a.to} className="inline-flex items-center gap-1.5 text-foreground underline-offset-4 hover:underline">
                                {inner}
                            </Link>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 text-foreground">{inner}</span>
                        )}
                    </span>
                );
            })}
        </div>
    );
}

// The single focal point: a plain-English ship VERDICT plus the one primary
// action on the surface. The AlertStrip above owns the urgent gate count, so
// this card must NOT paraphrase it: the supporting line is a forward-looking
// next-move, never a restatement of "N gates blocked/not passing". The button
// is the neutral-inverted default variant (Vercel "Deploy" pattern); the blue
// accent stays off buttons.
function ShipCard({ release, loading }: { release: ReleaseData; loading: boolean }) {
    const v = release ? shipVerdict(release) : null;
    return (
        <Card className="justify-between gap-5 p-5">
            {loading || !v ? (
                <div className="flex flex-col gap-3">
                    <div className="h-6 w-2/3 animate-pulse rounded bg-secondary/40" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-secondary/40" />
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <h2 className="text-section text-foreground">{v.headline}</h2>
                    <p className="text-body text-muted-foreground">{v.detail}</p>
                </div>
            )}
            {/* Neutral-inverted primary; no trailing chevron - a chevron on a
                Vercel-style primary reads as a templated nav tell. Chevrons stay
                on row-affordance Links only. */}
            <Button asChild variant="default" size="lg" className="w-fit">
                <Link to="/release">
                    {v?.ready ? 'Ship release' : 'Open Release'}
                </Link>
            </Button>
        </Card>
    );
}

interface ShipVerdict { headline: string; detail: string; ready: boolean }

// Verdict + a forward-looking line only. The detail must not echo the alert's
// count (that lives in the AlertStrip + the donut); it states the next move.
function shipVerdict(r: NonNullable<ReleaseData>): ShipVerdict {
    const open = r.amber + r.red + r.blocked;
    if (open === 0) {
        return { headline: 'Ready to ship.', detail: 'Every release gate is passing. You are clear to cut a release.', ready: true };
    }
    if (r.green >= r.gate_count - open && open <= 2) {
        return {
            headline: 'Almost ready to ship.',
            detail: 'Clear the last few gates from the release checklist, then ship.',
            ready: false,
        };
    }
    return {
        headline: r.red > 0 ? 'Not ready to ship.' : 'Checks pending.',
        detail: 'Open the release checklist to see what each gate needs.',
        ready: false,
    };
}

// The release-gate donut: three segments mapped 1:1 to three legend rows
// (passing / blocked / pending) so a reader can match every ring arc to a
// named count. The center reads "{passing}/{total}" with a "passing" caption
// so its meaning is never ambiguous. Tones are semantic and consistent with
// the rest of the panel: passing = success, blocked-needs-input = warning
// (amber), pending = neutral slate. Failing gates are urgent input too, so
// they fold into the blocked count rather than spawning a fourth unlabelled
// arc.
function ReleaseGatesCard({ release, loading }: { release: ReleaseData; loading: boolean }) {
    const blocked = release ? release.red + release.blocked : 0;
    return (
        <Link
            to="/release"
            className="group flex items-center gap-5 rounded-xl border bg-card p-5 shadow-sm transition-all hover:border-border-hover dark:shadow-none"
        >
            {loading || !release ? (
                <div className="h-16 w-full animate-pulse rounded bg-secondary/40" />
            ) : (
                <>
                    <Donut
                        size={84} stroke={9}
                        ariaLabel={`${release.green} of ${release.gate_count} gates passing`}
                        segments={[
                            { value: release.green,  tone: 'emerald' },
                            { value: blocked,         tone: 'amber' },
                            { value: release.amber,   tone: 'slate' },
                        ]}
                    >
                        <span className="text-card-title leading-none tabular-nums text-foreground">
                            {release.green}/{release.gate_count}
                        </span>
                        <span className="text-label text-muted-foreground">passing</span>
                    </Donut>
                    <div className="flex flex-col gap-2">
                        <SectionLabel>Release gates</SectionLabel>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-card-title tabular-nums text-foreground">{release.green}</span>
                            <span className="text-body text-muted-foreground">of {release.gate_count} passing</span>
                        </div>
                        <div className="mt-0.5 flex flex-col gap-1.5">
                            <LegendRow tone="bg-success" label="passing" count={release.green} />
                            <LegendRow tone="bg-warning" label="blocked" count={blocked} />
                            <LegendRow tone="bg-muted-foreground" label="pending" count={release.amber} />
                        </div>
                    </div>
                </>
            )}
        </Link>
    );
}

// One legend row per donut segment: a tone dot, the named status, the count.
// The count keeps each row honest against its arc.
function LegendRow({ tone, label, count }: { tone: string; label: string; count: number }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground">
            <span className={`size-1.5 rounded-full ${tone}`} />
            <span className="tabular-nums text-foreground">{count}</span>
            <span>{label}</span>
        </span>
    );
}

function Section({
    title, children, action, className = '',
}: React.PropsWithChildren<{ title: string; action?: React.ReactNode; className?: string }>) {
    return (
        <section className={`px-6 ${className}`}>
            <div className="mb-2.5 flex items-center justify-between">
                <SectionLabel>{title}</SectionLabel>
                {action}
            </div>
            {children}
        </section>
    );
}

function VitalCell({ children, to }: React.PropsWithChildren<{ to: string }>) {
    return (
        <Link to={to} className="group flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-border-hover dark:shadow-none">
            {children}
        </Link>
    );
}

// Stands in for the Tests + Evals cells when both have no runs: one quiet card
// inviting the first run rather than two near-blank stat cells. Spans the two
// columns those cells would have filled, and carries the eval/SBOM testids the
// Evals cell normally owns so existing queries still resolve.
function EmptyTestsEvalsPrompt({ sbom }: { sbom?: MetricsSummary['sbom'] }) {
    // Mirror the stat cells' vertical rhythm (label row -> body -> footer) and
    // padding so the spanned dashed prompt reads as part of a balanced grid row
    // rather than one wide hollow cell beside two normal ones. The action is
    // right-aligned on the footer line.
    return (
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-dashed bg-card/60 p-4 sm:col-span-2">
            <StatLabel icon={FlaskConical}>Tests + Evals</StatLabel>
            <div className="flex flex-col" data-testid="overview-eval-passrate">
                <span className="text-body-strong text-foreground">No test or eval runs yet</span>
                <span className="text-small text-muted-foreground">See past runs and start the first one in Observability.</span>
            </div>
            <div className="flex justify-end">
                <Button asChild variant="default" size="sm">
                    <Link to="/observability">Run a test</Link>
                </Button>
            </div>
            <span className="hidden" data-testid="overview-sbom-count">
                {sbom?.present ? sbom.components : 0}
            </span>
        </div>
    );
}

function deploymentStatusVariant(state: string): 'success' | 'warning' | 'danger' | 'secondary' {
    const s = state.toUpperCase();
    if (s === 'READY') return 'success';
    if (s === 'BUILDING' || s === 'QUEUED' || s === 'INITIALIZING') return 'warning';
    if (s === 'ERROR' || s === 'CANCELED') return 'danger';
    return 'secondary';
}

// Deployment vital - only mounted when Vercel is connected. Links to
// /services for the connection; the live deploy URL is a separate external
// click so it doesn't fight the card navigation.
function DeploymentCell({ deployment, loading }: { deployment?: VercelDeployment; loading: boolean }) {
    return (
        <Link
            to="/services"
            data-testid="overview-deployment-cell"
            className="group flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-border-hover dark:shadow-none"
        >
            <StatLabel icon={CloudUpload}>Deployment</StatLabel>
            {loading && !deployment ? (
                <CellSkeleton />
            ) : deployment ? (
                <div className="flex flex-col gap-1.5">
                    <Badge variant={deploymentStatusVariant(deployment.state)} className="w-fit rounded-md">
                        {deployment.state}
                    </Badge>
                    {deployment.url ? (
                        <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void bridge.openExternal(`https://${deployment.url}`); }}
                            className="inline-flex items-center gap-1 self-start truncate text-small text-muted-foreground hover:text-foreground"
                            title={deployment.url}
                        >
                            <span className="truncate">{deployment.url}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </button>
                    ) : (
                        <span className="text-small text-muted-foreground">No URL yet</span>
                    )}
                </div>
            ) : (
                <span className="text-small text-muted-foreground">No deployments yet.</span>
            )}
        </Link>
    );
}

type ReleaseData = ReleaseSummary | null | undefined;

function CellSkeleton() {
    return <div className="h-12 w-full animate-pulse rounded bg-secondary/40" />;
}
