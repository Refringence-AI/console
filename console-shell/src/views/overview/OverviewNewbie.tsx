import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import NumberFlow from '@number-flow/react';
import {
    ArrowRight, Coins, FlaskConical, GitCommit, Activity,
    KanbanSquare, BookMarked, GraduationCap,
} from 'lucide-react';
import { useMetricsSummary } from '../../lib/queries/metrics';
import { useReleaseList, useReleaseSummary } from '../../lib/queries/release';
import { useObsCounters } from '../../lib/queries/observability';
import { useRecentCommits } from '../../lib/queries/activity';
import { useProjectShape } from '../../lib/queries/project';
import { useRepoSummary } from '../../lib/queries/repo';
import { useActiveProject } from '../../lib/activeProject';
import { Card, SectionLabel, Badge } from '@/components/ui';
import { suggestNext } from '../../lib/ai/registry';
import { describeShape } from '../../lib/projectShape';
import { humanizeCommitSubject } from '../../lib/humanize';
import type { NextSuggestion, OverviewState } from '../../lib/ai/rules';
import type { GateStatus } from '../../lib/bridge';

/**
 * Guided-mode Overview.
 *
 * An oriented, single-column narrative: a calm headline, the one thing
 * worth doing next, a health verdict, the few metrics a newcomer actually
 * needs (budget, progress, testing), real recent activity, and a map of
 * where to explore. Not dumbed down — no SBOM counts, gate breakdowns, or
 * LOC, which mean nothing before you know the project. The distinct
 * counterpart to the Operator cockpit.
 */
export function OverviewNewbie() {
    const metrics = useMetricsSummary();
    const releases = useReleaseList();
    const release = useReleaseSummary(releases.data?.[0]?.version ?? null);
    const obs = useObsCounters();

    const [topSuggestion, setTopSuggestion] = useState<NextSuggestion | null>(null);

    useEffect(() => {
        let cancelled = false;
        const state: OverviewState = {};
        if (release.data) {
            state.release = {
                version: release.data.version,
                blocked: release.data.blocked,
                red: release.data.red,
                amber: release.data.amber,
                green: release.data.green,
            };
        }
        if (metrics.data) {
            state.evals = {
                lastRunIso: metrics.data.promptfoo.last_run,
                lastRunDays: null,
                failed: metrics.data.promptfoo.failed,
                errors: metrics.data.promptfoo.errors,
            };
        }
        suggestNext(state).then((all) => {
            if (cancelled) return;
            const ranked = [...all].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
            setTopSuggestion(ranked[0] ?? null);
        }).catch(() => {
            if (!cancelled) setTopSuggestion(null);
        });
        return () => { cancelled = true; };
    }, [metrics.data, release.data]);

    return (
        <div className="flex h-full flex-col overflow-y-auto px-8 py-10" data-testid="overview-newbie">
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7">

                <header className="flex flex-col gap-2">
                    <h1 className="text-display text-foreground">
                        How your project is doing
                    </h1>
                    {/* ONE supporting line under the H1. The inferred project
                        shape is inlined into the lede so the header reads as
                        H1 + a single sub-line, never two stacked muted rows. */}
                    <ProjectLede />
                </header>

                <NextStepCallout suggestion={topSuggestion} />

                <ReleaseStatusCard
                    status={release.data?.overall_status ?? null}
                    version={releases.data?.[0]?.version ?? null}
                    gateCount={release.data?.gate_count ?? null}
                    blocked={release.data?.blocked ?? 0}
                    amber={release.data?.amber ?? 0}
                />

                <NumbersThatMatter
                    budgetLoaded={!!metrics.data}
                    budget={metrics.data?.cost_today_usd ?? 0}
                    progressLoaded={!!metrics.data}
                    progress={metrics.data?.cycle_log.commits_landed ?? 0}
                    testedLoaded={!!obs.data}
                    tested={obs.data?.runs_last_24h ?? 0}
                />

                <RecentActivityCard />

                <section className="flex flex-col gap-3">
                    <SectionLabel>Explore</SectionLabel>
                    {/* A 3-up even row with equal column widths so the three
                        links share one tidy line and nothing is orphaned alone
                        on a second row. Each leads with icon + name; the blurb
                        sits below, lighter - a quiet wayfinding list, not three
                        hero tiles. */}
                    <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
                        <ExploreLink to="/issues"    icon={KanbanSquare}  title="Workboard"     body="What needs doing, by urgency." />
                        <ExploreLink to="/library"   icon={BookMarked}    title="Read the repo" body="Browse docs, configs, workflows." />
                        <ExploreLink to="/tutorials" icon={GraduationCap} title="Walk through"  body="Short walkthroughs of the basics." />
                    </div>
                </section>

            </div>
        </div>
    );
}

function severityRank(sev: NextSuggestion['severity']): number {
    if (sev === 'critical') return 0;
    if (sev === 'warning') return 1;
    return 2;
}

// THE single supporting line under the H1, in the page-header rhythm (no
// card, no icon badge). It carries the standing lede and inlines the
// inferred project shape as a continuation of the same sentence, so the
// header is H1 + one line. Graceful fallbacks when no project is open or
// the shape has not resolved yet.
function ProjectLede() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const shape = useProjectShape(root);
    const repo = useRepoSummary();

    const lede = 'A plain-English snapshot, and the one thing worth doing next.';

    if (!root) {
        return (
            <p data-testid="newbie-project-lede" className="max-w-xl text-body leading-relaxed text-muted-foreground">
                {lede} Pick a folder from the top bar to get a read on it.
            </p>
        );
    }

    const shapeSummary = shape.data ? describeShape(shape.data, repo.data?.total_loc) : '';
    // The inferred shape stays at the same body weight as the lede so the
    // header reads as H1 + one clean supporting line, never a detached muted
    // tail on a second row.
    return (
        <p data-testid="newbie-project-lede" className="max-w-xl text-body leading-relaxed text-muted-foreground">
            {shapeSummary ? `${lede} ${shapeSummary}` : lede}
        </p>
    );
}

function NextStepCallout({ suggestion }: { suggestion: NextSuggestion | null }) {
    const label = suggestion?.label ?? 'Everything looks calm. Open the Repo panel to keep exploring.';
    const to = suggestion?.to ?? '/repo';
    const severity = suggestion?.severity;
    // Blocked gates are awaiting input, not failing, so they take the amber
    // warning tone (matching the Operator alert strip + ReleaseStatusCard).
    // Rose stays reserved for genuinely failing/critical work.
    const blockedAwaitingInput = suggestion?.id === 'release-blocked';
    const dot = severity === 'critical' && !blockedAwaitingInput
        ? 'bg-danger'
        : severity === 'warning' || blockedAwaitingInput
            ? 'bg-warning'
            : 'bg-muted-foreground/50';

    return (
        <div data-testid="newbie-next-step" className="flex flex-col gap-1.5">
            <span className="text-label uppercase text-muted-foreground">
                Next step
            </span>
            {/* Card-title size, not page-title: the display H1 above owns the
                largest line. The trailing arrow is revealed only on hover so
                the resting state drops the nav tell. */}
            <Link
                to={to}
                className="group inline-flex w-fit items-center gap-2.5 text-card-title leading-snug text-foreground"
            >
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                <span>{label}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-foreground group-hover:opacity-100" />
            </Link>
        </div>
    );
}

function ReleaseStatusCard({
    status, version, gateCount, blocked, amber,
}: { status: GateStatus | null; version: string | null; gateCount: number | null; blocked: number; amber: number }) {
    // Status drives only a small chip now, never a large colored headline.
    // The variants map to the Badge success/warning/danger/secondary tones.
    // "blocked" = warning (amber) here, matching the Operator alert + donut:
    // blocked means "needs your input", one tone across both personas.
    const map: Record<GateStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
        green:   { label: 'Ready',   variant: 'success' },
        amber:   { label: 'Pending', variant: 'warning' },
        red:     { label: 'Failing', variant: 'danger' },
        blocked: { label: 'Blocked', variant: 'warning' },
    };
    const m = status ? map[status] : null;

    function liveBlurb(): string {
        if (status === null) return 'Checking gate status.';
        if (status === 'green') return 'All checks passing. You can cut a release.';
        if (status === 'blocked') {
            const n = blocked || 1;
            return `${n} ${n === 1 ? 'gate needs' : 'gates need'} your input before you can ship.`;
        }
        if (status === 'amber') {
            const n = amber || 1;
            return `${n} ${n === 1 ? 'gate' : 'gates'} pending review.`;
        }
        return 'One or more checks are failing. Open the Release panel to investigate.';
    }

    return (
        <Link
            to="/release"
            data-testid="newbie-release-status"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-border-hover dark:shadow-none"
        >
            <div className="flex items-center justify-between">
                <span className="text-body-strong text-muted-foreground">Is it ready to ship?</span>
                {version && (
                    <Badge variant="outline" className="rounded-md font-mono">
                        {version}
                    </Badge>
                )}
            </div>
            {/* Large slot holds a number (the gate count), with the status word
                demoted to a normal-weight chip beside it. */}
            {/* The big number is the count the STATUS refers to (blocked count when
                blocked, all gates when green), so it never reads as "18 blocked". */}
            <div className="flex items-center gap-3">
                {status === null ? (
                    <span className="text-body text-muted-foreground">Loading</span>
                ) : (
                    <>
                        <span className="text-metric tabular-nums text-foreground">
                            {status === 'green' ? (gateCount ?? 0) : status === 'amber' ? (amber || 0) : (blocked || 0)}
                        </span>
                        {m ? (
                            <Badge variant={m.variant} className="rounded-md">{m.label}</Badge>
                        ) : (
                            <Badge variant="secondary" className="rounded-md">Unknown</Badge>
                        )}
                        <span className="text-small text-muted-foreground">
                            {status === 'green'
                                ? (gateCount === 1 ? 'gate passing' : 'gates passing')
                                : gateCount !== null ? `of ${gateCount} gates` : 'gates'}
                        </span>
                    </>
                )}
            </div>
            <p className="text-body leading-relaxed text-muted-foreground">
                {liveBlurb()}
            </p>
        </Link>
    );
}

function RecentActivityCard() {
    const commits = useRecentCommits(3);
    return (
        <Card
            data-testid="newbie-recent-activity"
            className="gap-3 p-5"
        >
            <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-body-strong text-muted-foreground">Lately</span>
            </div>
            {commits.isLoading ? (
                <div className="flex flex-col gap-2">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-3.5 animate-pulse rounded bg-secondary/40" style={{ width: `${80 - i * 14}%` }} />
                    ))}
                </div>
            ) : commits.data && commits.data.length > 0 ? (
                <ul className="flex flex-col gap-2.5">
                    {commits.data.map((c) => (
                        <li key={c.hash} className="flex items-baseline gap-3">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                            {/* min-w-0 lets the subject truncate inside the flex row; the
                                timestamp gets a fixed-width right-aligned column so the
                                ellipsis lands cleanly against it instead of mid-word with
                                a floating time. */}
                            <span className="min-w-0 flex-1 truncate text-body text-foreground">{humanizeCommitSubject(c.subject)}</span>
                            <span className="w-20 shrink-0 text-right text-small text-muted-foreground tabular-nums">{c.relativeTime}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-body leading-relaxed text-muted-foreground">
                    No commits in the last 24h. New commits will show up here.
                </p>
            )}
        </Card>
    );
}

// The three headline numbers. When all three are loaded and zero there's
// nothing to compare, so collapse to a single muted line rather than three
// identical "None yet" cards. Once any has data, the cards differentiate
// themselves through their real values and per-metric zero captions.
function NumbersThatMatter({
    budgetLoaded, budget, progressLoaded, progress, testedLoaded, tested,
}: {
    budgetLoaded: boolean; budget: number;
    progressLoaded: boolean; progress: number;
    testedLoaded: boolean; tested: number;
}) {
    const allLoaded = budgetLoaded && progressLoaded && testedLoaded;
    const allZero = allLoaded && budget === 0 && progress === 0 && tested === 0;

    return (
        <section className="flex flex-col gap-3">
            <SectionLabel>The numbers that matter</SectionLabel>
            {allZero ? (
                <Link
                    to="/observability"
                    data-testid="newbie-numbers-quiet"
                    className="text-body leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
                >
                    No automation activity in the last 24h.
                </Link>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <MetricCard
                        to="/observability"
                        icon={Coins}
                        label="AI spend today"
                        loaded={budgetLoaded}
                        value={budget}
                        format={{ style: 'currency', currency: 'USD' }}
                        zeroCaption="No AI spend tracked yet."
                        explainer="What you have spent on AI through Console today."
                    />
                    <MetricCard
                        to="/observability"
                        icon={GitCommit}
                        label="Progress"
                        loaded={progressLoaded}
                        value={progress}
                        zeroCaption="No commits landed yet."
                        explainer="Commits landed in your project so far."
                    />
                    <MetricCard
                        to="/observability"
                        icon={FlaskConical}
                        label="Tested"
                        loaded={testedLoaded}
                        value={tested}
                        zeroCaption="No test runs in the last 24h."
                        explainer="Test runs that finished in the last 24 hours."
                    />
                </div>
            )}
        </section>
    );
}

function MetricCard({
    to, icon: Icon, label, value, loaded, format, zeroCaption, explainer,
}: {
    to: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: number;
    loaded: boolean;
    format?: React.ComponentProps<typeof NumberFlow>['format'];
    zeroCaption: string;
    explainer: string;
}) {
    const isZero = loaded && value === 0;
    return (
        <Link
            to={to}
            className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-border-hover dark:shadow-none"
        >
            <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <SectionLabel>{label}</SectionLabel>
            </div>
            {!loaded ? (
                <span className="text-metric text-muted-foreground">—</span>
            ) : isZero ? (
                // Reserve the large numeric slot for real values: a zero card
                // reads as a quiet caption, not a headline-sized "None yet".
                <span className="text-body text-muted-foreground">{zeroCaption}</span>
            ) : (
                <NumberFlow value={value} format={format} className="text-metric tabular-nums text-foreground" />
            )}
            <p className="text-body leading-relaxed text-muted-foreground">
                {explainer}
            </p>
        </Link>
    );
}

// A single Explore column: icon + name on the lead line, the blurb stacked
// below in a lighter weight. Stacking (vs. an inline blurb) keeps each of the
// three equal-width columns readable. Deliberately lower-emphasis than a
// filled card so the block reads as a quiet wayfinding list, not three tiles.
function ExploreLink({
    to, icon: Icon, title, body,
}: {
    to: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    body: string;
}) {
    return (
        <Link
            to={to}
            className="group flex flex-col gap-0.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-card"
        >
            <span className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                <span className="text-body-strong text-foreground">{title}</span>
            </span>
            <span className="text-small text-muted-foreground">{body}</span>
        </Link>
    );
}
