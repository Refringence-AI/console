import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { MessageSquare, ExternalLink } from 'lucide-react';

import { bridge, type SlackIssue, type SlackTeam } from '../../lib/bridge';
import { useConnections } from '../../lib/queries/connections';
import { useSlackIssues } from '../../lib/queries/slack';
import { Button, Card, Skeleton, EmptyState } from '@/components/ui';

/**
 * Slack source for the Workboard. A calm read of the pulled Slack issues
 * grouped by team (Tech / Non-tech / Test). When Slack is not connected it
 * shows a connect empty state that points at Settings/Services. Reuses the
 * same card vocabulary as the GitHub board so the two sources read alike.
 *
 * `density` lets the Guided (newbie) view breathe a little more than the
 * Operator view without forking the whole component.
 */
const TEAM_META: { id: SlackTeam; label: string; blurb: string; dot: string }[] = [
    { id: 'tech',    label: 'Tech',     blurb: 'Engineering reports: bugs, blockers, regressions.', dot: 'bg-danger' },
    { id: 'nontech', label: 'Non-tech', blurb: 'Product, design, and ops reports.',                dot: 'bg-warning' },
    { id: 'test',    label: 'Test',     blurb: 'QA and test-channel findings.',                     dot: 'bg-success' },
];

export function SlackBoard({ density = 'compact' }: { density?: 'compact' | 'roomy' }) {
    const navigate = useNavigate();
    const connections = useConnections();
    const connected = connections.data?.slack.connected ?? false;
    const issues = useSlackIssues(connected);

    const groups = useMemo(() => groupByTeam(issues.data ?? []), [issues.data]);

    if (connections.isLoading || connections.data === undefined) {
        return (
            <div className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground" data-testid="slack-board-loading">
                Checking Slack connection...
            </div>
        );
    }

    if (!connected) {
        return (
            <div className="flex flex-1 items-center justify-center p-8" data-testid="slack-board-empty">
                <EmptyState
                    icon={MessageSquare}
                    title="Connect Slack to pull issues"
                    action={
                        <Button
                            size="sm"
                            onClick={() => navigate('/services')}
                            data-testid="slack-board-connect"
                        >
                            Open Services
                        </Button>
                    }
                >
                    Add a Slack bot token in Services, then tag the channels you
                    want to watch as Tech, Non-tech, or Test. Reports show up here.
                </EmptyState>
            </div>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6" data-testid="slack-board">
            <div className={`mx-auto flex w-full max-w-[960px] flex-col ${density === 'roomy' ? 'gap-10' : 'gap-6'}`}>
                {issues.isLoading && (
                    <div className="flex flex-col gap-6" data-testid="slack-board-fetching">
                        <TeamSkeleton rows={3} />
                        <TeamSkeleton rows={2} />
                    </div>
                )}

                {issues.isSuccess && TEAM_META.map((team) => (
                    <TeamSection
                        key={team.id}
                        meta={team}
                        items={groups[team.id]}
                        density={density}
                    />
                ))}
            </div>
        </div>
    );
}

function TeamSection({
    meta, items, density,
}: {
    meta: typeof TEAM_META[number];
    items: SlackIssue[];
    density: 'compact' | 'roomy';
}) {
    return (
        <Card className="gap-0 p-5 shadow-none" data-testid={`slack-team-${meta.id}`}>
            <header className="mb-3 flex items-baseline gap-3">
                <span className={`h-3 w-3 shrink-0 rounded-full ${meta.dot}`} />
                <h2 className="text-section text-foreground">{meta.label}</h2>
                <span className="text-small text-muted-foreground">
                    {items.length} item{items.length === 1 ? '' : 's'}
                </span>
            </header>
            {density === 'roomy' && (
                <p className="mb-4 text-body leading-relaxed text-muted-foreground">{meta.blurb}</p>
            )}

            {items.length === 0 ? (
                <p className="text-small italic text-muted-foreground/70">Nothing pulled for this team yet.</p>
            ) : (
                <ul className="flex flex-col divide-y divide-border/60">
                    {items.map((iss) => (
                        <SlackRow key={iss.id} issue={iss} />
                    ))}
                </ul>
            )}
        </Card>
    );
}

function SlackRow({ issue }: { issue: SlackIssue }) {
    const when = tsToDate(issue.ts);
    return (
        <li className="flex items-center gap-3 py-3" data-testid={`slack-issue-${issue.id}`}>
            {issue.severity && (
                <span className={`h-2 w-2 shrink-0 rounded-full ${issue.severity === 'critical' ? 'bg-danger' : 'bg-warning'}`} />
            )}
            <span className="inline-flex items-center gap-1 font-mono text-small text-muted-foreground">
                <MessageSquare className="h-3 w-3" />
                {issue.channel}
            </span>
            <span className="min-w-0 flex-1 truncate text-body-strong leading-snug text-foreground" title={issue.title}>
                {issue.title}
            </span>
            <span className="shrink-0 text-small text-muted-foreground tabular-nums">
                {when ? when.toLocaleDateString() : ''}
            </span>
            {issue.permalink && (
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => { void bridge.openExternal(issue.permalink); }}
                >
                    <ExternalLink className="h-3 w-3" />
                    Open
                </Button>
            )}
        </li>
    );
}

function TeamSkeleton({ rows }: { rows: number }) {
    return (
        <Card className="gap-0 p-5 shadow-none">
            <header className="mb-4 flex items-center gap-3">
                <Skeleton className="h-3 w-3 shrink-0 rounded-full" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-10" />
            </header>
            <ul className="flex flex-col divide-y divide-border/60">
                {Array.from({ length: rows }).map((_, i) => (
                    <li key={i} className="flex items-center gap-3 py-3">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 w-12" />
                    </li>
                ))}
            </ul>
        </Card>
    );
}

function groupByTeam(issues: SlackIssue[]): Record<SlackTeam, SlackIssue[]> {
    const out: Record<SlackTeam, SlackIssue[]> = { tech: [], nontech: [], test: [] };
    for (const i of issues) {
        if (i.team === 'tech' || i.team === 'nontech' || i.team === 'test') out[i.team].push(i);
    }
    return out;
}

// Slack ts is "<unix seconds>.<microseconds>"; the integer part is the epoch.
function tsToDate(ts: string): Date | null {
    const secs = Number(ts.split('.')[0]);
    return Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000) : null;
}

// A small bar used by both Workboard variants to switch source. Kept here so
// the source-toggle styling stays consistent across Operator and Guided.
export type WorkboardSource = 'github' | 'slack';

export function SourceToggle({
    source, setSource,
}: {
    source: WorkboardSource;
    setSource: (s: WorkboardSource) => void;
}) {
    return (
        <div className="flex overflow-hidden rounded-md border border-border" role="tablist" data-testid="workboard-source-toggle">
            <SourceButton id="github" current={source} setCurrent={setSource}>GitHub</SourceButton>
            <SourceButton id="slack"  current={source} setCurrent={setSource}>Slack</SourceButton>
        </div>
    );
}

function SourceButton({
    id, current, setCurrent, children,
}: {
    id: WorkboardSource; current: WorkboardSource; setCurrent: (s: WorkboardSource) => void; children: React.ReactNode;
}) {
    const active = current === id;
    return (
        <button
            type="button"
            data-testid={`workboard-source-${id}`}
            aria-pressed={active}
            onClick={() => setCurrent(id)}
            className={`px-2.5 py-1 text-label transition-colors ${
                id === 'slack' ? 'border-l border-border' : ''
            } ${
                active
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:bg-secondary/50'
            }`}
        >
            {children}
        </button>
    );
}
