import { Rocket, CheckCircle2, AlertCircle, XCircle, MinusCircle, Play, ExternalLink, ChevronRight, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useReleaseList, useReleaseChecklist, useReleaseSummary } from '../../lib/queries/release';
import { useEnvLocalNames } from '../../lib/queries/env';
import { useActiveProject } from '../../lib/activeProject';
import { PanelHeader } from '../_shell/PanelHeader';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { ReleaseNewbie } from './ReleaseNewbie';
import { bridge } from '../../lib/bridge';
import { cleanCopy } from '../../lib/humanize';
import { Card, SectionLabel, Button, Badge, EmptyState, Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui';
import { Donut } from '../../components/viz';
import type { GateStatus, ReleaseGate, ReleaseSummary } from '../../lib/bridge';

export type AggregateStatus = 'green' | 'pending' | 'blocked';

type GateFilter = 'all' | 'blocked' | 'pending';

function matchesFilter(gate: ReleaseGate, filter: GateFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'blocked') return gate.status === 'red' || gate.status === 'blocked';
    /* pending */ return gate.status === 'amber';
}

export function aggregateGateStatus(gates: ReleaseGate[]): AggregateStatus {
    if (!gates || gates.length === 0) return 'pending';
    const hasBlocked = gates.some((g) => g.status === 'red' || g.status === 'blocked');
    if (hasBlocked) return 'blocked';
    const hasPending = gates.some((g) => g.status === 'amber');
    if (hasPending) return 'pending';
    return 'green';
}

/**
 * Release panel - compliance posture + release readiness.
 *
 * Reads `docs/release-checklists/<version>.yaml` via the bridge and
 * renders the gate checklist. The focal row pairs a plain-English ship
 * verdict (one neutral-inverted primary action) with a gate-status donut
 * that answers the passing/blocked/pending split as a part-of-whole. Per
 * docs/CONSOLE-DESIGN-DIRECTION.md sections 8, 10, 11.
 */
export function ReleasePanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <ReleaseNewbie />;
    return <ReleaseSeasoned />;
}

function pluralize(n: number, single: string, plural: string) {
    return n === 1 ? single : plural;
}

function ReleaseSeasoned() {
    const list = useReleaseList();
    const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
    const activeVersion = selectedVersion ?? list.data?.[0]?.version ?? null;
    const checklist = useReleaseChecklist(activeVersion);
    const summary = useReleaseSummary(activeVersion);
    const [gateFilter, setGateFilter] = useState<GateFilter>('all');

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="release-panel">
            <PanelHeader
                icon={Rocket}
                title="Release"
                subtitle="Compliance posture + release readiness"
                testid="release-panel-header"
            >
                {list.data && list.data.length > 0 && (
                    <>
                        <label htmlFor="release-version" className="text-small text-muted-foreground">Version:</label>
                        <select
                            id="release-version"
                            data-testid="release-version-select"
                            className="rounded-md border border-input bg-background px-2 py-1 text-small tabular-nums"
                            value={activeVersion ?? ''}
                            onChange={(e) => setSelectedVersion(e.target.value || null)}
                        >
                            {list.data.map((r) => (
                                <option key={r.version} value={r.version}>
                                    {r.version} ({r.status})
                                </option>
                            ))}
                        </select>
                    </>
                )}
                <Tooltip>
                    <TooltipTrigger asChild>
                        {/* span wrapper: disabled buttons don't fire the pointer events the tooltip needs */}
                        <span tabIndex={0}>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled
                                data-testid="release-run-checks"
                                className="text-muted-foreground"
                            >
                                <Play className="h-3.5 w-3.5" />
                                Run all checks
                                <Badge variant="secondary" className="rounded-md font-normal">Planned</Badge>
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        Runs the QA harness against every gate. Not wired up yet; run checks from the CLI for now.
                    </TooltipContent>
                </Tooltip>
            </PanelHeader>

            {list.isLoading && (
                <div className="p-6 text-body text-muted-foreground">Loading release checklists.</div>
            )}
            {list.isError && (
                <div className="p-6">
                    <EmptyState
                        icon={XCircle}
                        title="Could not read release checklists"
                        data-testid="release-list-error"
                        className="py-10"
                    >
                        {String(list.error)}
                    </EmptyState>
                </div>
            )}
            {list.isSuccess && (!list.data || list.data.length === 0) && (
                <div className="p-6">
                    <EmptyState
                        icon={Rocket}
                        title="No release checklists yet"
                        data-testid="release-list-empty"
                        className="py-10"
                    >
                        Create your first checklist at <code className="font-mono text-small">docs/release-checklists/&lt;version&gt;.yaml</code> to start tracking release gates.
                    </EmptyState>
                </div>
            )}

            {/* Focal row: the ship verdict plus the gate donut. The verdict
                card owns the single neutral-inverted primary action; status
                colour stays on the donut + badges, never the headline. */}
            {summary.data && (
                <section className="px-6 pt-5">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <ShipCard
                            summary={summary.data}
                            version={activeVersion}
                            onFilter={setGateFilter}
                        />
                        <GateDonutCard summary={summary.data} />
                    </div>
                    <SummaryCounts summary={summary.data} />
                </section>
            )}

            {checklist.isSuccess && checklist.data && checklist.data.gates.length === 0 && (
                <div className="px-6 pt-5">
                    <EmptyState
                        icon={Rocket}
                        title="No gates configured"
                        data-testid="release-empty"
                        className="py-10"
                    >
                        Add gates in <code className="font-mono text-small">.refringence-qa/</code> to track release readiness.
                    </EmptyState>
                </div>
            )}

            <div className="px-6 pt-7">
                <EnvVarsCard />
            </div>

            {checklist.data && checklist.data.gates.length > 0 && (
                <section className="px-6 pb-8 pt-7">
                    <SectionLabel>Gates</SectionLabel>
                    <div className="mt-2.5">
                        <GateList gates={checklist.data.gates} filter={gateFilter} onClearFilter={() => setGateFilter('all')} />
                    </div>
                </section>
            )}
        </div>
    );
}

// The focal verdict: plain-English headline, the one neutral-inverted
// primary action, and a quiet jump to the relevant gate filter.
function ShipCard({ summary, version, onFilter }: { summary: ReleaseSummary; version: string | null; onFilter: (f: GateFilter) => void }) {
    const open = summary.amber + summary.red + summary.blocked;
    const blocked = summary.red + summary.blocked;
    const v = shipVerdict(summary, version);

    return (
        <Card className="justify-between gap-5 p-5" data-testid="release-ship-card">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <h2 className="text-section text-foreground">{v.headline}</h2>
                    <GateBadge status={summary.overall_status} />
                </div>
                <p className="text-body text-muted-foreground">{v.detail}</p>
            </div>
            {v.ready ? (
                // Ready to ship: lead with the real action (review the passing
                // gates), and demote "Cut release" to a quiet Planned affordance
                // so the surface never reads as a dead primary CTA.
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        size="lg"
                        variant="default"
                        onClick={() => onFilter('all')}
                        data-testid="release-hero-green"
                        className="w-fit"
                    >
                        Review {summary.gate_count} {pluralize(summary.gate_count, 'gate', 'gates')}
                        <ChevronRight className="size-4" />
                    </Button>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            {/* span wrapper: disabled buttons don't fire the pointer events the tooltip needs */}
                            <span tabIndex={0}>
                                <Button
                                    type="button"
                                    size="lg"
                                    variant="ghost"
                                    disabled
                                    data-testid="release-cut-planned"
                                    className="text-muted-foreground"
                                >
                                    Cut release
                                    <Badge variant="secondary" className="rounded-md font-normal">Planned</Badge>
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            Tags and publishes the release. Not wired up yet; cut the tag manually for now.
                        </TooltipContent>
                    </Tooltip>
                </div>
            ) : (
                <Button
                    type="button"
                    size="lg"
                    variant="default"
                    onClick={() => onFilter(blocked > 0 ? 'blocked' : 'pending')}
                    data-testid={blocked > 0 ? 'release-hero-blocked' : 'release-hero-pending'}
                    className="w-fit"
                >
                    {blocked > 0 ? `Open ${blocked} ${pluralize(blocked, 'blocker', 'blockers')}` : `View ${open} pending`}
                    <ChevronRight className="size-4" />
                </Button>
            )}
        </Card>
    );
}

interface ShipVerdict { headline: string; detail: string; ready: boolean }

function shipVerdict(s: ReleaseSummary, version: string | null): ShipVerdict {
    const open = s.amber + s.red + s.blocked;
    const tag = version ? ` ${version}` : '';
    if (open === 0) {
        return { headline: `Ready to ship${tag}`.trim() + '.', detail: `All ${s.gate_count} release gates are passing.`, ready: true };
    }
    const noun = pluralize(open, 'gate', 'gates');
    if (s.red + s.blocked > 0) {
        return {
            headline: 'Blocked from ship.',
            detail: `${open} of ${s.gate_count} release ${noun} ${pluralize(open, 'is', 'are')} not passing.`,
            ready: false,
        };
    }
    return {
        headline: 'Awaiting checks.',
        detail: `${open} of ${s.gate_count} release ${noun} still ${pluralize(open, 'needs', 'need')} review.`,
        ready: false,
    };
}

// The gate-status donut: passing vs blocked vs pending as a part-of-whole,
// the passing count in the centre, a legend beside it. Status tones are
// semantic and stay off the brand accent.
function GateDonutCard({ summary }: { summary: ReleaseSummary }) {
    const blocked = summary.red + summary.blocked;
    return (
        <Card className="flex-row items-center gap-5 p-5" data-testid="release-gate-donut">
            <Donut
                size={84}
                stroke={9}
                ariaLabel={`${summary.green} of ${summary.gate_count} gates passing`}
                segments={[
                    { value: summary.green, tone: 'emerald' },
                    { value: blocked, tone: 'rose' },
                    { value: summary.amber, tone: 'amber' },
                ]}
            >
                <span className="text-card-title leading-none tabular-nums text-foreground">{summary.green}</span>
                <span className="text-label tabular-nums text-muted-foreground">/ {summary.gate_count}</span>
            </Donut>
            <div className="flex flex-col gap-2">
                <SectionLabel>Release gates</SectionLabel>
                <div className="flex items-baseline gap-1.5">
                    <span className="text-card-title tabular-nums text-foreground">{summary.green}</span>
                    <span className="text-body text-muted-foreground">passing</span>
                </div>
                <p className="text-small tabular-nums text-muted-foreground">
                    {blocked} blocked · {summary.amber} pending
                </p>
                <div className="mt-0.5 flex items-center gap-3">
                    <LegendItem tone="bg-success" label="passing" />
                    <LegendItem tone="bg-danger" label="blocked" />
                    {summary.amber > 0 && <LegendItem tone="bg-warning" label="pending" />}
                </div>
            </div>
        </Card>
    );
}

function LegendItem({ tone, label }: { tone: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground">
            <span className={`size-1.5 rounded-full ${tone}`} />
            {label}
        </span>
    );
}

// Quiet meta line of canonical counts under the focal row. Plain neutral
// text, tabular numerals; no large colored status headline.
function SummaryCounts({ summary }: { summary: ReleaseSummary }) {
    return (
        <p
            data-testid="release-summary"
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-small tabular-nums text-muted-foreground"
        >
            <span><strong className="text-foreground">{summary.green}</strong> green</span>
            <span><strong className="text-foreground">{summary.amber}</strong> amber</span>
            <span><strong className="text-foreground">{summary.red}</strong> red</span>
            <span><strong className="text-foreground">{summary.blocked}</strong> blocked</span>
            <span className="text-muted-foreground/70">{summary.gate_count} gates total</span>
        </p>
    );
}

function EnvVarsCard() {
    const { project } = useActiveProject();
    const projectRoot = project?.path ?? '';
    const env = useEnvLocalNames(projectRoot);
    const files = env.data?.files.filter((f) => f.names.length > 0) ?? [];
    const total = env.data?.allNames.length ?? 0;

    return (
        <Card data-testid="release-env-card" className="gap-4 p-5">
            <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-card-title text-foreground">Environment variables</span>
                {total > 0 && (
                    <Badge variant="secondary" className="rounded-md font-mono tabular-nums" data-testid="release-env-count">
                        {total}
                    </Badge>
                )}
            </div>

            {!projectRoot && (
                <EmptyState
                    icon={KeyRound}
                    title="No project linked"
                    data-testid="release-env-no-project"
                    className="py-8"
                >
                    Pick a project folder to scan its local <code className="font-mono text-small">.env</code> files for variable names.
                </EmptyState>
            )}

            {projectRoot && env.isError && (
                <EmptyState
                    icon={XCircle}
                    title="Could not read .env files"
                    data-testid="release-env-error"
                    className="py-8"
                >
                    {String(env.error)}
                </EmptyState>
            )}

            {projectRoot && env.isSuccess && files.length === 0 && (
                <EmptyState
                    icon={KeyRound}
                    title="No .env files in the project root"
                    data-testid="release-env-empty"
                    className="py-8"
                >
                    Add a <code className="font-mono text-small">.env.local</code> and its variable names will list here.
                </EmptyState>
            )}

            {projectRoot && files.length > 0 && (
                <div className="flex flex-col gap-3" data-testid="release-env-files">
                    {files.map((f) => (
                        <div key={f.file} data-testid={`release-env-file-${f.file}`}>
                            <div className="mb-1.5 font-mono text-small text-muted-foreground">{f.file}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {f.names.map((name) => (
                                    <Badge
                                        key={name}
                                        variant="secondary"
                                        className="rounded-md font-mono"
                                        data-testid={`release-env-name-${name}`}
                                    >
                                        {name}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    ))}
                    <p className="text-small text-muted-foreground" data-testid="release-env-note">
                        Connect Vercel and link a project to check which of these are missing on the host.
                    </p>
                </div>
            )}
        </Card>
    );
}

function GateList({ gates, filter, onClearFilter }: { gates: ReleaseGate[]; filter: GateFilter; onClearFilter: () => void }) {
    const visible = gates.filter((g) => matchesFilter(g, filter));
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm dark:shadow-none">
            {filter !== 'all' && (
                <div data-testid="release-gates-filter-chip" className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-2 text-small text-muted-foreground">
                    <span>Showing {filter} <span className="tabular-nums">({visible.length})</span></span>
                    <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={onClearFilter}
                        data-testid="release-gates-filter-clear"
                    >
                        Clear
                    </Button>
                </div>
            )}
            <ul className="divide-y divide-border/60" data-testid="release-gates">
            {visible.map((g) => (
                <li key={g.id} data-testid={`release-gate-${g.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-secondary/30">
                    <StatusIcon status={g.status} className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-body">
                            <span className="text-body-strong text-foreground">{cleanCopy(g.label)}</span>
                            <GateBadge status={g.status} />
                        </div>
                        <div className="mt-0.5 truncate font-mono text-small text-muted-foreground" title={g.artifact}>
                            {g.artifact}
                        </div>
                        {g.status === 'amber' && !g.notes && (
                            <div
                                data-testid={`release-gate-skeleton-${g.id}`}
                                className="mt-1.5 h-4 w-32 animate-pulse rounded-sm bg-secondary/50"
                            />
                        )}
                        {g.notes && (
                            <div className="mt-1 text-small text-muted-foreground">{cleanCopy(g.notes)}</div>
                        )}
                        {g.blocker && (
                            <div className="mt-1 text-small text-warning-text">{cleanCopy(g.blocker)}</div>
                        )}
                    </div>
                    {g.artifact && (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => { void bridge.openExternal(g.artifact); }}
                            data-testid={`release-gate-view-${g.id}`}
                            className="ml-2"
                        >
                            <ExternalLink className="h-3 w-3" />
                            View
                        </Button>
                    )}
                </li>
            ))}
            </ul>
        </div>
    );
}

function StatusIcon({ status, className }: { status: GateStatus; className: string }) {
    if (status === 'green')   return <CheckCircle2 className={`${className} text-success-text`} />;
    if (status === 'amber')   return <AlertCircle className={`${className} text-warning-text`} />;
    if (status === 'red')     return <XCircle className={`${className} text-danger-text`} />;
    /* blocked */             return <MinusCircle className={`${className} text-muted-foreground`} />;
}

// Status reads as a small semantic chip, never a large colored headline.
function GateBadge({ status }: { status: GateStatus }) {
    if (status === 'green')   return <Badge variant="success" className="rounded-md">Passing</Badge>;
    if (status === 'amber')   return <Badge variant="warning" className="rounded-md">Pending</Badge>;
    if (status === 'red')     return <Badge variant="danger" className="rounded-md">Failing</Badge>;
    /* blocked */             return <Badge variant="secondary" className="rounded-md">Blocked</Badge>;
}
