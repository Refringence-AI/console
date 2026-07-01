import { Activity as ActivityIcon } from 'lucide-react';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PanelHeader } from '../_shell/PanelHeader';
import { useRecentCommits } from '../../lib/queries/activity';
import { humanizeCommitSubject } from '../../lib/humanize';
import { Card, EmptyState, Button } from '@/components/ui';

/**
 * Guided-mode Activity.
 *
 * The last few real commits as plain cards. No timeline rail, no
 * kind/source header row. Conventional-commit type prefixes (fix:, feat:)
 * are stripped so the line reads as plain English.
 */

export function ActivityNewbie() {
    const { setPersona } = usePersonaMode();
    const commits = useRecentCommits(5);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="activity-newbie">
            <PanelHeader
                icon={ActivityIcon}
                title="Activity"
                testid="activity-newbie-header"
            />

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[820px] px-6 py-7">
                    <p className="text-body leading-relaxed text-muted-foreground">
                        The last few things that happened.
                    </p>

                    <div className="mt-8 flex flex-col gap-3" data-testid="activity-newbie-feed">
                        {commits.isLoading && (
                            [0, 1, 2].map((i) => (
                                <div key={i} className="h-16 animate-pulse rounded-xl bg-secondary/40" />
                            ))
                        )}

                        {!commits.isLoading && commits.data && commits.data.length > 0 && (
                            commits.data.map((c) => (
                                <Card
                                    key={c.hash}
                                    data-testid={`activity-newbie-${c.hash}`}
                                    className="gap-1.5 p-5 shadow-none transition-colors hover:bg-secondary/40"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <h2 className="text-card-title text-foreground">
                                            {humanizeCommitSubject(c.subject)}
                                        </h2>
                                        <span className="flex-shrink-0 text-small text-muted-foreground tabular-nums">
                                            {c.relativeTime}
                                        </span>
                                    </div>
                                    <p className="text-body leading-relaxed text-muted-foreground">
                                        Committed by {c.author}.
                                    </p>
                                </Card>
                            ))
                        )}

                        {!commits.isLoading && (!commits.data || commits.data.length === 0) && (
                            <EmptyState icon={ActivityIcon} title="No commits in the last 24h">
                                New commits and loop runs will show up here.
                            </EmptyState>
                        )}
                    </div>

                    <footer className="mt-10 border-t border-border pt-6">
                        <Button
                            variant="link"
                            onClick={() => setPersona('seasoned')}
                            className="h-auto p-0 text-muted-foreground hover:text-foreground"
                        >
                            See full activity
                        </Button>
                    </footer>
                </div>
            </div>
        </div>
    );
}
