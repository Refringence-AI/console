import { useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, XCircle, MinusCircle, ChevronRight } from 'lucide-react';
import { useReleaseList, useReleaseChecklist, useReleaseSummary } from '../../lib/queries/release';
import { Card, Button, Badge, SectionLabel, EmptyState, Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui';
import { Donut } from '../../components/viz';
import { cleanCopy } from '../../lib/humanize';
import type { GateStatus, ReleaseGate, ReleaseSummary } from '../../lib/bridge';

/**
 * Guided-mode Release.
 *
 * Single column, plain English. One focal ship card pairs a verdict with a
 * gate-status donut (passing/blocked/pending as a part-of-whole), then a
 * short list of gates with sentence-case status badges. Status reads as a
 * small chip, never a large colored headline. Mono artifact paths hide
 * behind a per-row 'Show file' toggle.
 */
export function ReleaseNewbie() {
    const list = useReleaseList();
    const activeVersion = list.data?.[0]?.version ?? null;
    const checklist = useReleaseChecklist(activeVersion);
    const summary = useReleaseSummary(activeVersion);
    const gatesRef = useRef<HTMLElement>(null);
    const scrollToGates = () => gatesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    return (
        <div className="flex h-full flex-col overflow-y-auto px-6 py-10" data-testid="release-newbie">
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8">

                <header className="flex flex-col gap-2">
                    <h1 className="text-display text-foreground">
                        Release
                    </h1>
                    <p className="text-body text-muted-foreground">
                        Is this build ready to ship?
                    </p>
                </header>

                {list.isLoading && (
                    <p className="text-body text-muted-foreground">Loading release checklists.</p>
                )}

                {list.isSuccess && (!list.data || list.data.length === 0) && (
                    <EmptyState
                        icon={CheckCircle2}
                        title="No release pipeline yet"
                        data-testid="release-newbie-empty"
                        className="py-10"
                    >
                        Add gates in <code className="font-mono text-small">.refringence-qa/</code> and your release checklist will show up here.
                    </EmptyState>
                )}

                {summary.data && (
                    <ShipHeroNewbie summary={summary.data} version={activeVersion} onViewGates={scrollToGates} />
                )}

                {summary.data && (
                    <ShipReadyHero version={activeVersion} />
                )}

                {checklist.data && checklist.data.gates.length > 0 && (
                    <GateListNewbie gates={checklist.data.gates} gatesRef={gatesRef} />
                )}

            </div>
        </div>
    );
}

function pluralize(n: number, single: string, plural: string) {
    return n === 1 ? single : plural;
}

function ShipHeroNewbie({ summary, version, onViewGates }: { summary: ReleaseSummary; version: string | null; onViewGates: () => void }) {
    const open = summary.amber + summary.red + summary.blocked;
    const blocked = summary.red + summary.blocked;
    const ready = open === 0;
    const headline = ready
        ? `Ready to ship ${version ?? ''}`.trim()
        : blocked > 0
            ? 'Blocked from ship'
            : 'Awaiting checks';
    const detail = ready
        ? 'Every safety check is passing.'
        : blocked > 0
            ? `${blocked} ${pluralize(blocked, 'check', 'checks')} ${pluralize(blocked, 'is', 'are')} blocked. Resolve ${pluralize(blocked, 'it', 'them')} first.`
            : `${open} of ${summary.gate_count} checks still need a quick review.`;

    return (
        <Card data-testid="release-newbie-ship-hero" className="flex-row items-center gap-5 p-5">
            <Donut
                size={88}
                stroke={9}
                ariaLabel={`${summary.green} of ${summary.gate_count} checks passing`}
                segments={[
                    { value: summary.green, tone: 'emerald' },
                    { value: blocked, tone: 'rose' },
                    { value: summary.amber, tone: 'amber' },
                ]}
            >
                <span className="text-section leading-none tabular-nums text-foreground">{summary.green}</span>
                <span className="text-label tabular-nums text-muted-foreground">/ {summary.gate_count}</span>
            </Donut>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-page-title text-foreground">{headline}</span>
                    <StatusBadge status={summary.overall_status} />
                </div>
                <p className="text-body text-muted-foreground">{detail}</p>
                {ready ? (
                    // Ready: lead with the real action (review the checks), and
                    // demote "Cut release" to a quiet Planned affordance so the
                    // card never reads as a dead primary CTA.
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={onViewGates}
                            data-testid="release-newbie-hero-green"
                            className="w-fit"
                        >
                            Review the checks
                            <ChevronRight className="size-4" />
                        </Button>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                {/* span wrapper: disabled buttons don't fire the pointer events the tooltip needs */}
                                <span tabIndex={0}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled
                                        data-testid="release-newbie-cut-planned"
                                        className="text-muted-foreground"
                                    >
                                        Cut release
                                        <Badge variant="secondary" className="rounded-md font-normal">Planned</Badge>
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>
                                This tags and publishes the release. It is not wired up yet.
                            </TooltipContent>
                        </Tooltip>
                    </div>
                ) : (
                    <Button
                        type="button"
                        variant="default"
                        onClick={onViewGates}
                        data-testid={blocked > 0 ? 'release-newbie-hero-blocked' : 'release-newbie-hero-pending'}
                        className="mt-1 w-fit"
                    >
                        {blocked > 0 ? 'Open blockers' : 'View pending'}
                        <ChevronRight className="size-4" />
                    </Button>
                )}
            </div>
        </Card>
    );
}

function ShipReadyHero({
    version,
}: {
    version: string | null;
}) {
    return (
        <Card
            data-testid="release-newbie-hero"
            className="gap-4 p-5"
        >
            <div className="flex items-center justify-between">
                <SectionLabel>How releases work</SectionLabel>
                {version && (
                    <Badge variant="secondary" className="rounded-md tabular-nums">
                        {version}
                    </Badge>
                )}
            </div>
            <p className="text-body leading-relaxed text-muted-foreground">
                Each release runs through a short list of safety checks. Green checks pass on their own. Pending ones need a human to confirm. Failing ones block the release until they are fixed.
            </p>
        </Card>
    );
}

function GateListNewbie({ gates, gatesRef }: { gates: ReleaseGate[]; gatesRef: React.RefObject<HTMLElement | null> }) {
    const top = gates.slice(0, 3);
    return (
        <section ref={gatesRef} className="flex flex-col gap-3" data-testid="release-newbie-gates">
            <SectionLabel>What still needs attention</SectionLabel>
            <Card className="gap-0 p-0">
                <ul className="divide-y divide-border/60">
                    {top.map((g) => (
                        <GateRowNewbie key={g.id} gate={g} />
                    ))}
                </ul>
            </Card>
        </section>
    );
}

function GateRowNewbie({ gate }: { gate: ReleaseGate }) {
    const [showFile, setShowFile] = useState(false);
    return (
        <li
            data-testid={`release-newbie-gate-${gate.id}`}
            className="flex items-start gap-4 px-6 py-4"
        >
            <StatusIcon status={gate.status} className="mt-1 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-card-title text-foreground">{cleanCopy(gate.label)}</span>
                    <StatusBadge status={gate.status} />
                </div>
                {gate.status === 'amber' && !gate.notes ? (
                    <div
                        data-testid={`release-newbie-gate-skeleton-${gate.id}`}
                        className="mt-2 h-4 w-32 animate-pulse rounded-sm bg-secondary/50"
                    />
                ) : (
                    <p className="mt-1.5 text-body leading-relaxed text-muted-foreground">
                        What this means: {cleanCopy(plainEnglish(gate))}
                    </p>
                )}
                {gate.blocker && (
                    <p className="mt-1.5 text-small text-warning-text">
                        {cleanCopy(gate.blocker)}
                    </p>
                )}
                {gate.artifact && (
                    <div className="mt-2">
                        {!showFile ? (
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                onClick={() => setShowFile(true)}
                                className="h-auto px-0 underline underline-offset-4"
                            >
                                Show file
                            </Button>
                        ) : (
                            <code
                                className="block break-all rounded-sm bg-secondary/60 px-2 py-1 font-mono text-small text-muted-foreground"
                                title={gate.artifact}
                            >
                                {gate.artifact}
                            </code>
                        )}
                    </div>
                )}
            </div>
        </li>
    );
}

function StatusBadge({ status }: { status: GateStatus }) {
    const map: Record<GateStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
        green:   { label: 'Passing',      variant: 'success' },
        amber:   { label: 'Needs review', variant: 'warning' },
        red:     { label: 'Blocked',      variant: 'danger' },
        blocked: { label: 'Waiting',      variant: 'secondary' },
    };
    const m = map[status];
    return (
        <Badge variant={m.variant} className="rounded-md">
            {m.label}
        </Badge>
    );
}

function StatusIcon({ status, className }: { status: GateStatus; className: string }) {
    if (status === 'green')   return <CheckCircle2 className={`${className} text-success-text`} />;
    if (status === 'amber')   return <AlertCircle className={`${className} text-warning-text`} />;
    if (status === 'red')     return <XCircle className={`${className} text-danger-text`} />;
    /* blocked */             return <MinusCircle className={`${className} text-muted-foreground`} />;
}

function plainEnglish(gate: ReleaseGate): string {
    if (gate.notes) return gate.notes;
    if (gate.status === 'green')   return 'This safety check is passing. Nothing for you to do here.';
    if (gate.status === 'amber')   return 'A reviewer needs to sign off on this before the release can go out.';
    if (gate.status === 'red')     return 'This check is failing. Fix the underlying issue before shipping.';
    /* blocked */                  return 'Waiting on something outside this build. Check back later.';
}
