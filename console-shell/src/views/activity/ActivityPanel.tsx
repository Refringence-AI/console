import { GitCommit, Activity as ActivityIcon } from 'lucide-react';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PanelHeader } from '../_shell/PanelHeader';
import { ActivityNewbie } from './ActivityNewbie';
import { useRecentCommits, useDeliveryCadence } from '../../lib/queries/activity';
import { humanizeCommitSubject } from '../../lib/humanize';
import { EmptyState } from '@/components/ui';

/** Git-derived delivery cadence: a compact row of stat tiles above the feed. */
function CadenceStrip() {
    const { data } = useDeliveryCadence();
    if (!data) return null;
    const tiles: { label: string; value: string }[] = [
        { label: 'Commits, 7d', value: String(data.commits7d) },
        { label: 'Commits, 30d', value: String(data.commits30d) },
        { label: 'Contributors, 30d', value: String(data.contributors30d) },
        {
            label: 'Last commit',
            value: data.daysSinceLastCommit === null ? 'n/a'
                : data.daysSinceLastCommit === 0 ? 'today'
                : `${data.daysSinceLastCommit}d ago`,
        },
        {
            label: 'Releases',
            value: data.releaseCount === 0 ? 'none'
                : data.daysSinceLastRelease === null ? String(data.releaseCount)
                : `${data.releaseCount} · last ${data.daysSinceLastRelease}d`,
        },
    ];
    return (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="activity-cadence">
            {tiles.map((t) => (
                <div key={t.label} className="rounded-lg border border-border bg-card px-3 py-2">
                    <p className="text-card-title tabular-nums text-foreground">{t.value}</p>
                    <p className="text-label uppercase tracking-wide text-muted-foreground">{t.label}</p>
                </div>
            ))}
        </div>
    );
}

/**
 * Activity panel - real chronological git history from the active branch.
 *
 * Deploy and eval events join the stream once Services connections land
 * (see docs/CONSOLE-PRODUCT-STRATEGY.md); until then the feed is commits,
 * honestly, rather than synthetic placeholders.
 */
export function ActivityPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <ActivityNewbie />;
    return <ActivitySeasoned />;
}

function ActivitySeasoned() {
    const commits = useRecentCommits(20);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="activity-panel">
            <PanelHeader
                icon={ActivityIcon}
                title="Activity"
                subtitle="Recent commits on the active branch"
                testid="activity-panel-header"
            />

            <div className="flex min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[820px] px-6 pb-6 pt-6">
                    <CadenceStrip />
                    {commits.isLoading ? (
                        <div className="flex flex-col gap-3" data-testid="activity-loading">
                            {[0, 1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-10 animate-pulse rounded-md bg-secondary/40" />
                            ))}
                        </div>
                    ) : commits.data && commits.data.length > 0 ? (
                        <ol className="relative" data-testid="activity-feed">
                            <span className="absolute left-[10px] top-1 bottom-1 w-px bg-border" />
                            {commits.data.map((c) => (
                                <li
                                    key={c.hash}
                                    data-testid={`activity-${c.hash}`}
                                    className="relative flex gap-4 pb-6 pl-7"
                                >
                                    <span className="absolute left-0 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                                        <GitCommit className="h-3 w-3" />
                                    </span>
                                    <article className="flex flex-1 flex-col gap-1">
                                        <header className="flex items-center gap-2">
                                            <span className="text-label uppercase text-muted-foreground">commit</span>
                                            <span className="text-muted-foreground/40">/</span>
                                            <span className="text-small text-muted-foreground">{c.author}</span>
                                            <span className="text-muted-foreground/40">/</span>
                                            <span className="text-small text-muted-foreground tabular-nums">{c.relativeTime}</span>
                                            <span className="ml-auto font-mono text-label tabular-nums text-muted-foreground/60">{c.hash}</span>
                                        </header>
                                        {/* Plain text only: commit subjects must never be linkified or
                                            colored with the accent. Render the raw subject as foreground. */}
                                        <h3 className="text-card-title text-foreground [&_a]:text-foreground [&_a]:no-underline">{humanizeCommitSubject(c.subject)}</h3>
                                    </article>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <EmptyState
                            data-testid="activity-empty"
                            icon={GitCommit}
                            title="No commits found"
                        >
                            This isn't a git checkout, or git isn't on PATH.
                        </EmptyState>
                    )}

                    {commits.data && commits.data.length > 0 && (
                        <p className="mt-2 text-center text-small text-muted-foreground/70">
                            Deploy and eval events join this feed once you connect services.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
