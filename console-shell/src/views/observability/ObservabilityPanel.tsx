import { Activity, FolderOpen, ExternalLink, ChevronDown, ChevronRight, FileText, FlaskConical, PlayCircle, TestTube, Zap, GitBranch, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { bridge } from '../../lib/bridge';
import { useObsCounters, useObsRuns, useObsRunDetail } from '../../lib/queries/observability';
import { useConnections, useSentryIssues } from '../../lib/queries/connections';
import { useEvalsHealth, usePromptfooSummary } from '../../lib/queries/evals';
import { useProjectCapabilities } from '../../lib/queries/project';
import { usePipelineDetect } from '../../lib/queries/pipeline';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { useRunner, type RunState } from '../../lib/useRunner';
import { PanelHeader } from '../_shell/PanelHeader';
import { LiveConsole } from '../../components/LiveConsole';
import { RunningIndicator } from '../../components/RunningIndicator';
import { ObservabilityNewbie } from './ObservabilityNewbie';
import { humanizeRunLabel, summarizeArtifactKinds, type HumanRunLabel } from './humanizeRun';
import type { RunEntry, SentryIssue, RunnerStartOpts } from '../../lib/bridge';
import { Card, Badge, Button, SectionLabel, Stat, StatLabel, StatValue } from '@/components/ui';

/**
 * Observability panel - surfaces .refringence-qa/runs/ artifacts +
 * counters. Sources: useObsRuns, useObsCounters.
 *
 * Empty (zero-byte) runs are hidden behind a toggle so the table
 * shows real work first. Raw runIds are never rendered: every row
 * uses humanizeRunLabel for a human-readable title.
 */
export function ObservabilityPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <ObservabilityNewbie />;
    return <ObservabilitySeasoned />;
}

function ObservabilitySeasoned() {
    const counters = useObsCounters();
    const runs = useObsRuns();
    const runRows = runs.data ?? [];

    const connections = useConnections();
    const sentryConnected = connections.data?.sentry?.connected ?? false;
    const sentryIssues = useSentryIssues(sentryConnected);

    const { project } = useActiveProject();
    const projectRoot = project?.path ?? '';
    const capabilities = useProjectCapabilities(projectRoot);
    const evalsHealth = useEvalsHealth();
    const promptfoo = usePromptfooSummary();

    const realRuns = useMemo(() => runRows.filter((r) => r.totalBytes > 0 && r.totalFiles > 0), [runRows]);
    const emptyRuns = useMemo(() => runRows.filter((r) => r.totalBytes === 0 || r.totalFiles === 0), [runRows]);
    const recent = useMemo(() => realRuns.slice(0, 5), [realRuns]);

    const updatedAt = Math.max(runs.dataUpdatedAt, counters.dataUpdatedAt);
    const asOf = updatedAt
        ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background" data-testid="observability-panel">
            <PanelHeader
                icon={Activity}
                title="Observability"
                subtitle="QA run artifacts, counters, and trace logs"
                testid="observability-panel-header"
            >
                {asOf && (
                    <span className="text-small text-muted-foreground tabular-nums" data-testid="obs-freshness">
                        as of {asOf}
                    </span>
                )}
            </PanelHeader>

            <SectionDivider label="Run" />
            <div className="px-6">
                <RunSurface
                    hasEvals={capabilities.data?.hasEvals ?? false}
                    hasTests={capabilities.data?.hasTests ?? false}
                    hasCiWorkflows={capabilities.data?.hasCiWorkflows ?? false}
                    projectRoot={projectRoot}
                />
            </div>

            <SectionDivider label="Evals" />
            <div className="px-6">
                <EvalsSummary
                    summary={promptfoo.data ?? null}
                    hasOutput={evalsHealth.data?.promptfooOutputPresent === true}
                    hasEvals={capabilities.data?.hasEvals ?? false}
                />
            </div>

            <SectionDivider label="Counters" />
            <div className="px-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="obs-counters">
                    <CounterTile label="Runs total" value={counters.data?.runs ?? 0} loading={counters.isLoading} />
                    <CounterTile label="Runs / 24h" value={counters.data?.runs_last_24h ?? 0} loading={counters.isLoading} />
                    <CounterTile label="Errors total" value={counters.data?.errors ?? 0} loading={counters.isLoading} />
                    <CounterTile
                        label="Errors / 24h"
                        value={counters.data?.errors_last_24h ?? 0}
                        loading={counters.isLoading}
                        tone={counters.data && counters.data.errors_last_24h > 0 ? 'rose' : 'neutral'}
                    />
                </div>
            </div>

            <SectionDivider label="Production errors (Sentry)" />
            <div className="px-6">
                <SentryErrors connected={sentryConnected} issues={sentryIssues.data ?? []} loading={sentryIssues.isLoading} />
            </div>

            <SectionDivider label="Runs" />
            <div className="px-6">
                <RunsTable runs={realRuns} emptyRuns={emptyRuns} loading={runs.isLoading} />
            </div>

            <SectionDivider label="Artifact log" />
            <div className="px-6 pb-10">
                <ArtifactLog runs={recent} />
            </div>
        </div>
    );
}

function SectionDivider({ label }: { label: string }) {
    return (
        <div className="mt-8 mb-3 flex items-center gap-3 px-6">
            <SectionLabel>{label}</SectionLabel>
            <div className="h-px flex-1 bg-border/60" />
        </div>
    );
}

// Each Run button owns a stable `kind` so we can disable it while one of
// its runs is active (single-fire guard) and label the spawned process.
type RunKey = 'evals' | 'e2e' | 'smoke' | 'ci';

const RUN_LABELS: Record<RunKey, string> = {
    evals: 'Run evals',
    e2e: 'Run e2e',
    smoke: 'Run smoke',
    ci: 'Run CI',
};

function RunSurface({
    hasEvals,
    hasTests,
    hasCiWorkflows,
    projectRoot,
}: {
    hasEvals: boolean;
    hasTests: boolean;
    hasCiWorkflows: boolean;
    projectRoot: string;
}) {
    const { start, stop, runs } = useRunner();
    const qc = useQueryClient();
    // runId per Run button kind so we can show the live console for the
    // most recent invocation and disable that button while it runs.
    const [activeIds, setActiveIds] = useState<Partial<Record<RunKey, string>>>({});
    // First workflow name drives the `gh workflow run <name>` invocation.
    const pipeline = usePipelineDetect(projectRoot);
    const firstWorkflow = pipeline.data?.workflows?.[0];

    // Toast + invalidate the runs table once when a tracked run completes,
    // so a fresh artifact run appears. The ref tracks which runIds have
    // already fired so a re-render of `runs` does not re-toast.
    const notified = useRef<Set<string>>(new Set());
    useEffect(() => {
        for (const r of runs) {
            if (r.status === 'running' || notified.current.has(r.runId)) continue;
            notified.current.add(r.runId);
            if (r.status === 'done') {
                toast.success(`${r.label} finished.`);
            } else if (r.status === 'failed') {
                toast.error(`${r.label} failed (exit ${r.exitCode ?? '?'}).`);
            } else if (r.status === 'killed') {
                toast.message(`${r.label} cancelled.`);
            }
            void qc.invalidateQueries({ queryKey: ['obs', 'runs'] });
            void qc.invalidateQueries({ queryKey: ['obs', 'counters'] });
        }
    }, [runs, qc]);

    const runFor = (key: RunKey): RunState | undefined => {
        const id = activeIds[key];
        return id ? runs.find((r) => r.runId === id) : undefined;
    };
    const isActive = (key: RunKey): boolean => runFor(key)?.status === 'running';

    async function launch(key: RunKey, opts: Omit<RunnerStartOpts, 'label'>) {
        if (isActive(key)) return; // single-fire guard
        const runId = await start({ ...opts, label: RUN_LABELS[key], cwd: projectRoot || undefined });
        setActiveIds((prev) => ({ ...prev, [key]: runId }));
    }

    const ciDisabled = !hasCiWorkflows || !firstWorkflow;

    return (
        <div className="flex flex-col gap-3" data-testid="obs-run-surface">
            <div className="flex flex-wrap items-center gap-2" data-testid="obs-run-toolbar">
                <RunButton
                    icon={FlaskConical}
                    label="Run evals"
                    testid="obs-run-evals"
                    running={isActive('evals')}
                    disabled={!hasEvals}
                    disabledReason="No eval config found"
                    onClick={() => void launch('evals', { kind: 'npm', args: ['run', 'eval:promptfoo'] })}
                />
                <RunButton
                    icon={TestTube}
                    label="Run e2e"
                    testid="obs-run-e2e"
                    running={isActive('e2e')}
                    disabled={!hasTests}
                    disabledReason="No tests found"
                    onClick={() => void launch('e2e', { kind: 'npm', args: ['run', 'qa:e2e'] })}
                />
                <RunButton
                    icon={Zap}
                    label="Run smoke"
                    testid="obs-run-smoke"
                    running={isActive('smoke')}
                    onClick={() => void launch('smoke', { kind: 'npm', args: ['run', 'smoke'] })}
                />
                <RunButton
                    icon={GitBranch}
                    label="Run CI"
                    testid="obs-run-ci"
                    running={isActive('ci')}
                    disabled={ciDisabled}
                    disabledReason={!hasCiWorkflows ? 'No CI workflows found' : 'No workflow to trigger'}
                    onClick={() => {
                        if (!firstWorkflow) return;
                        void launch('ci', { kind: 'gh', args: ['workflow', 'run', firstWorkflow.path] });
                    }}
                />
            </div>

            {(['evals', 'e2e', 'smoke', 'ci'] as RunKey[]).map((key) => {
                const run = runFor(key);
                if (!run) return null;
                return (
                    <div key={key} className="flex flex-col gap-2" data-testid={`obs-run-live-${key}`}>
                        {run.status === 'running' && (
                            <RunningIndicator
                                label={run.label}
                                startedAt={run.startedAt}
                                runId={run.runId}
                                onStop={(id) => void stop(id)}
                            />
                        )}
                        <LiveConsole lines={run.lines} />
                    </div>
                );
            })}
        </div>
    );
}

function RunButton({
    icon: Icon,
    label,
    testid,
    running,
    disabled = false,
    disabledReason,
    onClick,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    testid: string;
    running: boolean;
    disabled?: boolean;
    disabledReason?: string;
    onClick: () => void;
}) {
    return (
        <Button
            variant="secondary"
            size="sm"
            data-testid={testid}
            disabled={disabled || running}
            title={disabled ? disabledReason : undefined}
            onClick={onClick}
        >
            {running ? <PlayCircle className="h-3.5 w-3.5 animate-pulse" /> : <Icon className="h-3.5 w-3.5" />}
            {running ? 'Running.' : label}
        </Button>
    );
}

function EvalsSummary({
    summary,
    hasOutput,
    hasEvals,
}: {
    summary: { passed: number; failed: number; errors: number; timestamp?: string } | null;
    hasOutput: boolean;
    hasEvals: boolean;
}) {
    if (!hasOutput || !summary) {
        return (
            <Card className="gap-1 border-dashed p-5 shadow-none" data-testid="obs-evals-empty">
                <div className="text-card-title text-foreground">No eval results yet.</div>
                <div className="text-small text-muted-foreground">
                    {hasEvals
                        ? 'Use Run evals above to populate this card.'
                        : 'No eval config found in this project.'}
                </div>
            </Card>
        );
    }
    const allPass = summary.failed === 0 && summary.errors === 0;
    return (
        <Card className="flex-row flex-wrap items-center gap-4 p-4 shadow-none" data-testid="obs-evals-summary">
            <Badge variant={allPass ? 'success' : 'danger'} className="shrink-0">
                <span className={`h-1.5 w-1.5 rounded-full ${allPass ? 'bg-success' : 'bg-danger'}`} />
                {allPass ? 'All passing' : 'Failures'}
            </Badge>
            <EvalTally icon={CheckCircle2} value={summary.passed} label="passed" tone="success" />
            <EvalTally icon={XCircle} value={summary.failed} label="failed" tone={summary.failed > 0 ? 'danger' : 'muted'} />
            <EvalTally icon={AlertCircle} value={summary.errors} label="errors" tone={summary.errors > 0 ? 'warning' : 'muted'} />
            {summary.timestamp && (
                <span className="ml-auto text-small text-muted-foreground">Last run {summary.timestamp}</span>
            )}
        </Card>
    );
}

function EvalTally({
    icon: Icon,
    value,
    label,
    tone,
}: {
    icon: React.ComponentType<{ className?: string }>;
    value: number;
    label: string;
    tone: 'success' | 'danger' | 'warning' | 'muted';
}) {
    const colour = {
        success: 'text-success-text',
        danger: 'text-danger-text',
        warning: 'text-warning-text',
        muted: 'text-muted-foreground',
    }[tone];
    return (
        <span className="inline-flex items-center gap-1.5 text-body">
            <Icon className={`h-3.5 w-3.5 ${colour}`} />
            <strong className="tabular-nums text-foreground">{value}</strong>
            <span className="text-muted-foreground">{label}</span>
        </span>
    );
}

function CounterTile({
    label,
    value,
    loading,
    tone = 'neutral',
}: {
    label: string;
    value: number;
    loading?: boolean;
    tone?: 'neutral' | 'rose';
}) {
    const valueClass =
        tone === 'rose' && value > 0
            ? 'text-danger-text'
            : value === 0
            ? 'text-muted-foreground'
            : 'text-foreground';
    return (
        <Card className="gap-2 p-4 shadow-none">
            <Stat>
                <StatLabel className="normal-case tracking-normal">{label}</StatLabel>
                <StatValue className={`tabular-nums ${valueClass}`}>
                    {loading ? '-' : value.toLocaleString()}
                </StatValue>
            </Stat>
        </Card>
    );
}

function deriveStatus(r: RunEntry): 'ok' | 'failed' | 'unknown' {
    if (r.totalFiles === 0) return 'unknown';
    const hasFailure = r.artifactKinds.some((k) => /fail|error/i.test(k));
    return hasFailure ? 'failed' : 'ok';
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusPill({ status }: { status: 'ok' | 'failed' | 'unknown' }) {
    if (status === 'ok') {
        return (
            <Badge variant="success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                ok
            </Badge>
        );
    }
    if (status === 'failed') {
        return (
            <Badge variant="danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                failed
            </Badge>
        );
    }
    return (
        <Badge variant="secondary" className="text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            empty
        </Badge>
    );
}

function RunRow({ run, label }: { run: RunEntry; label: HumanRunLabel }) {
    const [expanded, setExpanded] = useState(false);
    const heuristicStatus = deriveStatus(run);
    const detail = useObsRunDetail(expanded ? run.runId : null);
    // Once a manifest-backed status is known, prefer it (honest);
    // otherwise the filename heuristic is the best we have.
    const status = detail.data?.status ?? heuristicStatus;
    const inferred = !detail.data || detail.data.statusSource === 'heuristic';

    return (
        <>
            <tr
                className="cursor-pointer border-t border-border/60 hover:bg-secondary/30"
                data-testid={`obs-run-${run.runId.slice(0, 24)}`}
                onClick={() => setExpanded((v) => !v)}
            >
                <td className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                        {expanded
                            ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <div>
                            <div className="text-body-strong text-foreground" title={label.rawId}>{label.title}</div>
                            <div className="mt-0.5 text-small text-muted-foreground">{label.subline}</div>
                        </div>
                    </div>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{label.when}</td>
                <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                        <StatusPill status={status} />
                        {inferred && (
                            <span className="text-label text-muted-foreground" title="No run manifest found; status inferred from artifact filenames.">
                                inferred
                            </span>
                        )}
                    </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{run.totalFiles.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatSize(run.totalBytes)}</td>
            </tr>
            {expanded && (
                <tr className="border-t border-border/60 bg-secondary/20">
                    <td colSpan={5} className="px-4 py-3">
                        <RunDetailFiles runId={run.runId} loading={detail.isLoading} files={detail.data?.files ?? []} />
                    </td>
                </tr>
            )}
        </>
    );
}

function RunDetailFiles({
    runId,
    loading,
    files,
}: {
    runId: string;
    loading: boolean;
    files: { relPath: string; kind: string; sizeBytes: number }[];
}) {
    if (loading) {
        return <div className="text-small text-muted-foreground" data-testid="obs-run-detail-loading">Reading artifacts.</div>;
    }
    if (files.length === 0) {
        return <div className="text-small text-muted-foreground" data-testid="obs-run-detail-empty">No artifact files in this run.</div>;
    }
    return (
        <div className="flex flex-col gap-1" data-testid={`obs-run-detail-${runId.slice(0, 24)}`}>
            {files.map((f) => {
                const fullPath = `.refringence-qa/runs/${runId}/${f.relPath}`;
                return (
                    <div
                        key={f.relPath}
                        className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-card"
                    >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono text-small text-foreground">{f.relPath}</span>
                        <span className="shrink-0 text-small text-muted-foreground">{f.kind}</span>
                        <span className="shrink-0 tabular-nums text-small text-muted-foreground">{formatSize(f.sizeBytes)}</span>
                        <Button
                            variant="ghost"
                            size="xs"
                            className="shrink-0 text-muted-foreground"
                            onClick={(e) => {
                                e.stopPropagation();
                                void (async () => {
                                    const r = await bridge.openPath(fullPath);
                                    if (!r.ok) toast.error('Could not open: ' + (r.error || fullPath));
                                })();
                            }}
                        >
                            <ExternalLink className="h-3 w-3" />
                            Open
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}

function RunsTable({
    runs,
    emptyRuns,
    loading,
}: {
    runs: RunEntry[];
    emptyRuns: RunEntry[];
    loading?: boolean;
}) {
    const [showEmpty, setShowEmpty] = useState(false);

    if (loading) {
        return (
            <Card className="gap-0 p-4 text-body text-muted-foreground shadow-none">
                Scanning .refringence-qa/runs.
            </Card>
        );
    }
    if (runs.length === 0 && emptyRuns.length === 0) {
        return (
            <Card className="gap-1 border-dashed p-5 shadow-none" data-testid="obs-runs-empty">
                <div className="text-card-title text-foreground">No QA runs recorded.</div>
                <div className="text-small text-muted-foreground">
                    Run <code className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-small">npm run smoke</code> or{' '}
                    <code className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-small">npm run eval:regression</code>{' '}
                    from a terminal in the repo root.
                </div>
            </Card>
        );
    }
    return (
        <div className="flex flex-col gap-3" data-testid="obs-runs">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-left text-body">
                    <thead className="bg-secondary/40 text-label uppercase text-muted-foreground">
                        <tr>
                            <th className="px-4 py-2 font-medium">Run</th>
                            <th className="px-4 py-2 font-medium">Started</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium text-right">Files</th>
                            <th className="px-4 py-2 font-medium text-right">Size</th>
                        </tr>
                    </thead>
                    <tbody>
                        {runs.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-small text-muted-foreground">
                                    No completed runs yet. Empty runs are hidden below.
                                </td>
                            </tr>
                        )}
                        {runs.map((r) => (
                            <RunRow key={r.runId} run={r} label={humanizeRunLabel(r)} />
                        ))}
                        {showEmpty && emptyRuns.length > 0 && (
                            <>
                                <tr className="border-t border-border/60 bg-secondary/30">
                                    <td colSpan={5} className="px-4 py-1.5">
                                        <SectionLabel>Empty runs (no artifacts)</SectionLabel>
                                    </td>
                                </tr>
                                {emptyRuns.map((r) => (
                                    <RunRow key={r.runId} run={r} label={humanizeRunLabel(r)} />
                                ))}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
            {emptyRuns.length > 0 && (
                <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setShowEmpty((v) => !v)}
                    className="w-fit text-muted-foreground"
                    data-testid="obs-toggle-empty-runs"
                >
                    {showEmpty ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {showEmpty ? 'Hide' : 'Show'} empty runs ({emptyRuns.length})
                </Button>
            )}
        </div>
    );
}

function relativeTime(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const diffMs = Date.now() - t;
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    return `${day}d ago`;
}

function levelVariant(level: string): 'danger' | 'warning' {
    const l = level.toLowerCase();
    return l === 'fatal' || l === 'error' ? 'danger' : 'warning';
}

function SentryErrors({
    connected,
    issues,
    loading,
}: {
    connected: boolean;
    issues: SentryIssue[];
    loading?: boolean;
}) {
    if (!connected) {
        return (
            <p className="text-small text-muted-foreground" data-testid="obs-sentry-disconnected">
                Connect Sentry in Services to see production errors.
            </p>
        );
    }
    if (loading) {
        return (
            <Card className="gap-0 p-4 text-body text-muted-foreground shadow-none">
                Loading Sentry issues.
            </Card>
        );
    }
    if (issues.length === 0) {
        return (
            <Card className="gap-1 border-dashed p-5 shadow-none" data-testid="obs-sentry-empty">
                <div className="text-card-title text-foreground">No unresolved errors.</div>
                <div className="text-small text-muted-foreground">No production errors in the last 24 hours.</div>
            </Card>
        );
    }
    return (
        <div className="flex flex-col gap-2" data-testid="obs-sentry-issues">
            {issues.map((issue) => (
                <Card
                    key={issue.id}
                    className="flex-row items-center gap-3 p-4 shadow-none"
                    data-testid={`obs-sentry-issue-${issue.id}`}
                >
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-card-title text-foreground">{issue.title}</div>
                        <div className="mt-0.5 truncate text-small text-muted-foreground">
                            {issue.culprit || 'unknown'}
                            {issue.lastSeen && <> : {relativeTime(issue.lastSeen)}</>}
                        </div>
                    </div>
                    <Badge variant={levelVariant(issue.level)} className="shrink-0">
                        {issue.level}
                    </Badge>
                    <span className="shrink-0 tabular-nums text-small text-muted-foreground">
                        {issue.count.toLocaleString()}×
                    </span>
                    <Button
                        variant="secondary"
                        size="xs"
                        className="shrink-0"
                        disabled={!issue.permalink}
                        onClick={() => { if (issue.permalink) void bridge.openExternal(issue.permalink); }}
                    >
                        <ExternalLink className="h-3 w-3" />
                        Open
                    </Button>
                </Card>
            ))}
        </div>
    );
}

function ArtifactLog({ runs }: { runs: RunEntry[] }) {
    if (runs.length === 0) {
        return (
            <Card className="gap-0 border-dashed p-5 text-body text-muted-foreground shadow-none">
                Artifact paths appear here once the first run completes.
            </Card>
        );
    }
    return (
        <div className="flex flex-col gap-2" data-testid="obs-artifact-log">
            {runs.map((r) => {
                const folderPath = `.refringence-qa/runs/${r.runId}`;
                const label = humanizeRunLabel(r);
                return (
                    <Card
                        key={r.runId}
                        className="flex-row items-center gap-3 p-4 shadow-none"
                    >
                        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-card-title text-foreground" title={label.rawId}>{label.title}</div>
                            <div className="mt-0.5 truncate text-small text-muted-foreground">
                                {label.when} : {summarizeArtifactKinds(r.artifactKinds)}
                            </div>
                        </div>
                        <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => {
                                void (async () => {
                                    const r = await bridge.openPath(folderPath);
                                    if (!r.ok) toast.error('Could not open: ' + (r.error || folderPath));
                                })();
                            }}
                            className="shrink-0"
                            data-testid={`obs-open-${r.runId.slice(0, 24)}`}
                        >
                            <ExternalLink className="h-3 w-3" />
                            Open folder
                        </Button>
                    </Card>
                );
            })}
        </div>
    );
}
