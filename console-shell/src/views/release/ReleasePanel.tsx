import { Rocket, CheckCircle2, AlertCircle, XCircle, MinusCircle, Play, ExternalLink, ChevronRight, KeyRound, ShieldCheck, Loader2, Tag, Circle, Plus } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import type { GateStatus, ReleaseGate, ReleaseSummary, SetupItem } from '../../lib/bridge';

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
    const { project } = useActiveProject();
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
                            projectRoot={project?.path ?? ''}
                        />
                        <GateDonutCard summary={summary.data} />
                    </div>
                    <SummaryCounts summary={summary.data} />
                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <SetupCard projectRoot={project?.path ?? ''} />
                        <SbomCard projectRoot={project?.path ?? ''} />
                    </div>
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

            <div className="flex flex-col gap-4 px-6 pt-7">
                <PreReleaseChecks />
                <EvalRegressionGate />
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

// Cut a release = tag the local repo for the package.json version, gated on no
// failing/blocked gate. The tag is local; pushing it to publish is the next step
// (surfaced in the success toast). A just-cut tag can be rolled back here.
export function ReleaseCutButton({ projectRoot }: { projectRoot: string }) {
    const [busy, setBusy] = useState(false);
    const [tag, setTag] = useState<string | null>(null);
    async function cut() {
        if (!projectRoot || busy) return;
        if (!window.confirm('Create an annotated git tag for this release? This tags your local repo; it does not push.')) return;
        setBusy(true);
        try {
            const r = await bridge.release.cut(projectRoot);
            if (r.ok && r.tag) { setTag(r.tag); toast.success(`Cut ${r.tag}. Publish it with: git push origin ${r.tag}`); }
            else toast.error(r.error ?? 'Could not cut the release.');
        } finally { setBusy(false); }
    }
    async function rollback() {
        if (!projectRoot || !tag || busy) return;
        setBusy(true);
        try {
            const r = await bridge.release.rollback(projectRoot, tag);
            if (r.ok) { toast.success(`Rolled back ${tag}.`); setTag(null); }
            else toast.error(r.error ?? 'Could not roll back.');
        } finally { setBusy(false); }
    }
    if (tag) {
        return (
            <div className="flex items-center gap-2" data-testid="release-cut-done">
                <Badge variant="success" className="rounded-md"><CheckCircle2 className="size-3" /> {tag}</Badge>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={rollback} data-testid="release-rollback">
                    Roll back
                </Button>
            </div>
        );
    }
    return (
        <Button type="button" size="lg" variant="outline" disabled={busy || !projectRoot} onClick={cut} data-testid="release-cut">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Tag className="size-4" />} Cut release
        </Button>
    );
}

// Keyless, deterministic project-readiness scaffolding: the release gates detect
// missing LICENSE / CI / etc; this writes them on one click. No network, no AI key.
function SetupCard({ projectRoot }: { projectRoot: string }) {
    const [items, setItems] = useState<SetupItem[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const load = useCallback(() => { if (projectRoot) void bridge.setup.detect(projectRoot).then(setItems); }, [projectRoot]);
    useEffect(() => { load(); }, [load]);
    const missing = items.filter((i) => !i.present).length;
    async function add(id: string, label: string) {
        setBusy(id);
        try {
            const r = await bridge.setup.scaffold(projectRoot, id);
            if (r.ok) { toast.success(`Added ${r.path}`); load(); }
            else toast.error(r.error ?? `Could not add ${label}`);
        } finally { setBusy(null); }
    }
    if (items.length === 0) return null;
    return (
        <Card className="gap-3 p-4" data-testid="release-setup">
            <div className="flex flex-col gap-0.5">
                <span className="text-card-title text-foreground">Get the project ready</span>
                <span className="text-small text-muted-foreground">
                    {missing === 0 ? 'The common readiness files are all present.' : `${missing} common file${missing === 1 ? '' : 's'} not present yet.`}
                </span>
            </div>
            <div className="flex flex-col gap-1.5">
                {items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2" data-testid={`setup-item-${it.id}`}>
                        <div className="flex min-w-0 items-center gap-2">
                            {it.present
                                ? <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                                : <Circle className="size-3.5 shrink-0 text-muted-foreground" />}
                            <div className="flex min-w-0 flex-col">
                                <span className="font-mono text-label text-foreground">{it.path}</span>
                                <span className="truncate text-label text-muted-foreground">{it.detail}</span>
                            </div>
                        </div>
                        {it.present
                            ? <span className="shrink-0 text-label text-muted-foreground">Present</span>
                            : (
                                <Button size="sm" variant="outline" disabled={busy === it.id} onClick={() => add(it.id, it.label)} data-testid={`setup-add-${it.id}`}>
                                    {busy === it.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add
                                </Button>
                            )}
                    </div>
                ))}
            </div>
        </Card>
    );
}

// Deterministic supply-chain inventory: builds a CycloneDX SBOM from the project
// manifests + lockfiles and writes it to sbom.cdx.json, so it is a committable
// release artifact rather than only an assistant side effect. No network.
function SbomCard({ projectRoot }: { projectRoot: string }) {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; path?: string; componentCount?: number; error?: string } | null>(null);
    async function generate() {
        if (!projectRoot || busy) return;
        setBusy(true);
        try { setResult(await bridge.sbom.write(projectRoot, new Date().toISOString())); }
        finally { setBusy(false); }
    }
    return (
        <Card className="gap-2 p-4" data-testid="release-sbom">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-card-title text-foreground">Software bill of materials</span>
                    <span className="text-small text-muted-foreground">A CycloneDX inventory of the project dependencies, written to sbom.cdx.json.</span>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={busy || !projectRoot} onClick={generate} data-testid="release-sbom-generate">
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Generate SBOM
                </Button>
            </div>
            {result && result.ok && (
                <p className="text-small text-success" data-testid="release-sbom-result">Wrote {result.path} with {result.componentCount} component{result.componentCount === 1 ? '' : 's'}.</p>
            )}
            {result && !result.ok && (
                <p className="text-small text-warning-text" data-testid="release-sbom-error">{result.error ?? 'Could not generate the SBOM.'}</p>
            )}
        </Card>
    );
}

// The focal verdict: plain-English headline, the one neutral-inverted
// primary action, and a quiet jump to the relevant gate filter.
function ShipCard({ summary, version, onFilter, projectRoot }: { summary: ReleaseSummary; version: string | null; onFilter: (f: GateFilter) => void; projectRoot: string }) {
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
                    <ReleaseCutButton projectRoot={projectRoot} />
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

// The deterministic checks (env, database migrations, committed files) framed as
// pre-release gates. Runs locally on any repo, so the Release panel is useful
// even before a docs/release-checklists/<version>.yaml exists. A failing check
// (a committed .env, a missing migration rollback) is a real ship blocker.
function PreReleaseChecks() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const q = useQuery({
        queryKey: ['checks', 'run', root],
        queryFn: () => bridge.checks.run(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    if (!root) return null;
    const checks = (q.data ?? []).filter((c) => c.status !== 'skip' && c.id !== 'error');
    if (checks.length === 0) return null;
    const blocking = checks.filter((c) => c.status === 'fail').length;
    const review = checks.filter((c) => c.status === 'warn').length;

    return (
        <Card className="gap-4 p-5" data-testid="release-prechecks">
            <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-card-title text-foreground">Pre-release checks</span>
                <Badge
                    variant={blocking ? 'danger' : review ? 'warning' : 'success'}
                    className="ml-auto rounded-md"
                    data-testid="release-prechecks-badge"
                >
                    {blocking ? `${blocking} blocking` : review ? `${review} to review` : 'all clear'}
                </Badge>
            </div>
            <ul className="flex flex-col gap-2">
                {checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/20 px-3 py-2" data-testid={`release-precheck-${c.id}`}>
                        <StatusIcon status={c.status === 'fail' ? 'red' : c.status === 'warn' ? 'amber' : 'green'} className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <p className="text-small text-foreground">{c.title}</p>
                            <p className="text-small text-muted-foreground">{c.summary}</p>
                            {c.nextAction && c.status !== 'pass' && (
                                <p className="mt-0.5 text-label text-warning-text">{c.nextAction}</p>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            <p className="text-small text-muted-foreground">
                These run locally on every repo. A failing check is worth fixing before you tag a release.
            </p>
        </Card>
    );
}

/**
 * The eval-regression gate: a baseline captures the last good promptfoo run; a
 * later run that breaks a test which passed at baseline blocks the release and
 * names the broken tests. A gate that doesn't block is theatre.
 */
function EvalRegressionGate() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const q = useQuery({
        queryKey: ['evals', 'gate', root],
        queryFn: () => bridge.evals.gate(root),
        enabled: root.length > 0,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });
    const [busy, setBusy] = useState(false);
    if (!root) return null;
    const g = q.data;
    if (!g || g.status === 'no-current') return null; // no promptfoo run to gate

    async function capture() {
        setBusy(true);
        try {
            const r = await bridge.evals.setBaseline(root);
            if (r.ok) { toast.success('Captured this run as the eval baseline'); void q.refetch(); }
            else toast.error(r.error ?? 'Could not set the baseline');
        } finally { setBusy(false); }
    }

    const pct = (n?: number) => (n === undefined ? 'n/a' : `${Math.round(n * 100)}%`);
    const noBaseline = g.status === 'no-baseline';

    return (
        <Card className="gap-4 p-5" data-testid="release-eval-gate">
            <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-card-title text-foreground">Eval regression gate</span>
                <Badge
                    variant={noBaseline ? 'secondary' : g.blocked ? 'danger' : 'success'}
                    className="ml-auto rounded-md"
                    data-testid="release-eval-gate-badge"
                >
                    {noBaseline ? 'no baseline' : g.blocked ? `${g.regressions.length} regressed` : 'no regressions'}
                </Badge>
            </div>

            <p className="text-small text-muted-foreground">
                {noBaseline
                    ? `Your eval has ${g.currentPassed}/${g.currentTotal} (${pct(g.currentPassRate)}) passing. Capture it as the baseline so a later run that breaks a passing test blocks the release.`
                    : `Now ${pct(g.currentPassRate)} passing versus ${pct(g.baselinePassRate)} at baseline.`}
            </p>

            {g.blocked && g.regressions.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5" data-testid="release-eval-gate-regressions">
                    <p className="text-small font-medium text-danger-text">Passed at baseline, fails now:</p>
                    <ul className="flex flex-col gap-0.5">
                        {g.regressions.slice(0, 8).map((id) => (
                            <li key={id} className="font-mono text-label text-foreground/80">{id}</li>
                        ))}
                    </ul>
                </div>
            )}

            {!noBaseline && !g.blocked && g.newlyPassing.length > 0 && (
                <p className="text-small text-success-text">
                    {g.newlyPassing.length} test{g.newlyPassing.length === 1 ? '' : 's'} now passing that failed at baseline.
                </p>
            )}

            <div className="flex items-center gap-2">
                <Button size="sm" variant={noBaseline ? 'default' : 'outline'} disabled={busy} onClick={capture} data-testid="release-eval-gate-baseline">
                    {noBaseline ? 'Set as baseline' : 'Update baseline'}
                </Button>
                {!noBaseline && g.baselineCapturedAt && (
                    <span className="text-label text-muted-foreground">baseline set {new Date(g.baselineCapturedAt).toLocaleDateString()}</span>
                )}
            </div>
        </Card>
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
