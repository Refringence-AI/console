import { useEffect, useMemo, useRef } from 'react';
import { Activity, FileText, PlayCircle, Loader2, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { bridge } from '../../lib/bridge';
import { useObsRuns } from '../../lib/queries/observability';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { useRunner } from '../../lib/useRunner';
import { PanelHeader } from '../_shell/PanelHeader';
import { humanizeRunLabel } from './humanizeRun';
import type { RunEntry } from '../../lib/bridge';
import { Card, Badge, Button, SectionLabel, EmptyState as EmptyStateCard } from '@/components/ui';

/**
 * Newbie-mode Observability.
 *
 * Single column, plain English. Surfaces the last test run as one big
 * card with a primary action, then up to three recent runs as sentence
 * rows. No raw runIds, no artifact paths, no counters tiles. Mirrors
 * the OverviewNewbie progressive-disclosure shape.
 */
export function ObservabilityNewbie() {
    const { setPersona } = usePersonaMode();
    const runs = useObsRuns();
    const rows = runs.data ?? [];
    const realRows = useMemo(() => rows.filter((r) => r.totalBytes > 0 && r.totalFiles > 0), [rows]);
    const last = realRows[0] ?? rows[0] ?? null;
    const recent = useMemo(() => realRows.slice(0, 3), [realRows]);

    const { start, runs: liveRuns } = useRunner();
    const qc = useQueryClient();
    const testRunIdRef = useRef<string | null>(null);
    const liveRun = liveRuns.find((r) => r.runId === testRunIdRef.current);
    const running = liveRun?.status === 'running';

    // Toast + refresh the runs list once a launched test finishes.
    const notified = useRef<Set<string>>(new Set());
    useEffect(() => {
        for (const r of liveRuns) {
            if (r.status === 'running' || notified.current.has(r.runId)) continue;
            notified.current.add(r.runId);
            if (r.status === 'done') toast.success('Test run finished.');
            else if (r.status === 'failed') toast.error('Test run failed.');
            void qc.invalidateQueries({ queryKey: ['obs', 'runs'] });
        }
    }, [liveRuns, qc]);

    const runTest = async () => {
        if (running) return; // single-fire guard
        const runId = await start({ kind: 'npm', args: ['run', 'smoke'], label: 'Run a test' });
        testRunIdRef.current = runId;
    };

    const openLastReport = () => {
        if (!last) return;
        void openRunFolder(`.refringence-qa/runs/${last.runId}`);
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-background" data-testid="observability-newbie">
            <PanelHeader
                icon={Activity}
                title="Observability"
                subtitle="Quick status of your recent test runs."
                testid="observability-newbie-header"
            >
                <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setPersona('seasoned')}
                    className="text-muted-foreground"
                    data-testid="observability-newbie-switch-power"
                >
                    Switch to Operator view
                </Button>
            </PanelHeader>

            <div className="flex-1 overflow-y-auto px-6 py-8">
                <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8">
                    <div className="flex flex-col gap-3" data-testid="observability-newbie-run">
                        <Button
                            variant="default"
                            onClick={() => { void runTest(); }}
                            disabled={running}
                            className="w-fit"
                            data-testid="observability-newbie-run-test"
                        >
                            {running
                                ? <><Loader2 className="h-4 w-4 animate-spin" /> Running.</>
                                : <><PlayCircle className="h-4 w-4" /> Run a test</>}
                        </Button>
                        {running && (
                            <p className="text-small text-muted-foreground" data-testid="observability-newbie-run-status">
                                Your test is running. This can take a minute.
                            </p>
                        )}
                    </div>

                    {runs.isLoading && (
                        <p className="text-body text-muted-foreground">Looking for recent runs.</p>
                    )}

                    {!runs.isLoading && !last && <EmptyState />}

                    {last && (
                        <div className="flex flex-col gap-4">
                            <LastRunCard run={last} />
                            <Button
                                variant="outline"
                                onClick={openLastReport}
                                className="w-fit"
                                data-testid="observability-newbie-open-last-report"
                            >
                                <FileText className="h-4 w-4" />
                                Open last test report
                            </Button>
                        </div>
                    )}

                    {recent.length > 0 && <RecentRuns runs={recent} />}
                </div>
            </div>
        </div>
    );
}

function LastRunCard({ run }: { run: RunEntry }) {
    const status = deriveStatus(run);
    const errorCount = countErrors(run);
    const headline =
        status === 'failed'
            ? `Your last test run had ${errorCount} problem${errorCount === 1 ? '' : 's'}.`
            : status === 'ok'
                ? 'Your last test run finished cleanly.'
                : 'Your last test run finished, but the result is unclear.';
    const label = humanizeRunLabel(run);
    const folderPath = `.refringence-qa/runs/${run.runId}`;

    return (
        <Card
            data-testid="newbie-last-run"
            className="gap-5 p-5"
        >
            <div className="flex items-center gap-3">
                <SectionLabel>Last run : {label.title}</SectionLabel>
                <SimpleStatus status={status} />
            </div>
            <p className="text-body leading-relaxed text-foreground" data-testid="newbie-last-run-headline">
                {headline}
                {label.when && <span className="text-muted-foreground"> {label.when}.</span>}
            </p>
            <Button
                variant="outline"
                onClick={() => { void openRunFolder(folderPath); }}
                className="w-fit"
                data-testid="newbie-last-run-open"
            >
                See the report folder
            </Button>
        </Card>
    );
}

function RecentRuns({ runs }: { runs: RunEntry[] }) {
    return (
        <section className="flex flex-col gap-4" data-testid="newbie-recent-runs">
            <SectionLabel>Recent runs</SectionLabel>
            <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border bg-card">
                {runs.map((r) => {
                    const status = deriveStatus(r);
                    const folderPath = `.refringence-qa/runs/${r.runId}`;
                    const label = humanizeRunLabel(r);
                    return (
                        <li
                            key={r.runId}
                            data-testid={`newbie-run-${r.runId.slice(0, 24)}`}
                            className="flex items-center gap-4 px-5 py-4"
                        >
                            <span className="flex-1 text-body leading-snug text-foreground">
                                {label.title} <span className="text-muted-foreground">{label.when}</span>
                            </span>
                            <SimpleStatus status={status} />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { void openRunFolder(folderPath); }}
                                className="shrink-0"
                            >
                                Open
                            </Button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function EmptyState() {
    return (
        <EmptyStateCard
            icon={FlaskConical}
            title="No test runs yet"
            data-testid="newbie-runs-empty"
            className="py-10"
        >
            Press Run a test above, or open a terminal and run{' '}
            <code className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-small">npm run smoke</code>{' '}
            to get started.
        </EmptyStateCard>
    );
}

function SimpleStatus({ status }: { status: 'ok' | 'failed' | 'unknown' }) {
    if (status === 'ok') {
        return (
            <Badge variant="success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Passing
            </Badge>
        );
    }
    if (status === 'failed') {
        return (
            <Badge variant="danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                Failed
            </Badge>
        );
    }
    return (
        <Badge variant="secondary" className="text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            Unclear
        </Badge>
    );
}

async function openRunFolder(folderPath: string): Promise<void> {
    const r = await bridge.openPath(folderPath);
    if (!r.ok) toast.error('Could not open: ' + (r.error || folderPath));
}

function deriveStatus(r: RunEntry): 'ok' | 'failed' | 'unknown' {
    if (r.totalFiles === 0) return 'unknown';
    const hasFailure = r.artifactKinds.some((k) => /fail|error/i.test(k));
    return hasFailure ? 'failed' : 'ok';
}

function countErrors(r: RunEntry): number {
    return r.artifactKinds.filter((k) => /fail|error/i.test(k)).length;
}
