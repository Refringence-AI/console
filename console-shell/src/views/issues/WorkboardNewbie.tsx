import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    ExternalLink, MessageCircle, X, RefreshCw, Calendar, KanbanSquare,
    ChevronRight, ChevronDown,
} from 'lucide-react';

import { bridge, type IssueRow } from '../../lib/bridge';
import { useIssuesList, useIssueDetail } from '../../lib/queries/issues';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PanelHeader } from '../_shell/PanelHeader';
import { cleanIssueTitle } from '../../lib/humanize';
import { SlackBoard, SourceToggle, type WorkboardSource } from './SlackBoard';
import { Card, Button, Skeleton } from '@/components/ui';
import { renderMarkdown } from '@/lib/markdown';

/**
 * Newbie-mode Workboard.
 *
 * A clean three-bucket list view: Critical, High, Other. No kanban
 * columns, no drag handles, no severity:* dropdowns. Each row has a
 * single big "Open" button that pops the same in-app detail sheet the
 * seasoned view uses. Footer lets the user flip back to the dense
 * kanban view.
 */
export function WorkboardNewbie() {
    const { setPersona } = usePersonaMode();
    const [source, setSource] = useState<WorkboardSource>('github');
    const issues = useIssuesList({ state: 'open', limit: 100 });
    const [openIssue, setOpenIssue] = useState<number | null>(null);

    const groups = useMemo(() => groupBySeverity(issues.data ?? []), [issues.data]);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="workboard-newbie">
            <PanelHeader
                icon={KanbanSquare}
                title="Workboard"
                subtitle={
                    source === 'github'
                        // Always render a left-aligned count so the header reads
                        // balanced rather than leaving the source toggle floating
                        // alone against an empty band (even before issues load).
                        ? <span>{issues.data ? `${issues.data.length} open right now` : 'Loading...'}</span>
                        : <span>Pulled from Slack</span>
                }
                testid="workboard-newbie-header"
            >
                <SourceToggle source={source} setSource={setSource} />
            </PanelHeader>

            {source === 'slack' && <SlackBoard density="roomy" />}

            {source === 'github' && (
            <div className="flex-1 overflow-y-auto px-6 py-8">
                <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6">
                    {issues.isLoading && (
                        <div data-testid="workboard-newbie-loading" className="flex flex-col gap-6">
                            <BucketSkeleton rows={3} />
                            <BucketSkeleton rows={2} />
                            <BucketSkeleton rows={3} />
                        </div>
                    )}

                    {issues.isSuccess && (
                        <>
                            <Bucket
                                title="Critical"
                                blurb="These are things blocking ship. Look at these first."
                                dot="bg-danger"
                                items={groups.critical}
                                onOpen={setOpenIssue}
                            />
                            <Bucket
                                title="High"
                                blurb="Important, but not blocking ship today."
                                dot="bg-warning"
                                items={groups.high}
                                onOpen={setOpenIssue}
                            />
                            <Bucket
                                title="Other"
                                blurb="Everything else, most recently updated first."
                                // Hollow neutral dot so Other reads as a distinct
                                // step from the solid status dots above it.
                                dot="bg-transparent ring-1 ring-inset ring-muted-foreground/70"
                                items={groups.other}
                                onOpen={setOpenIssue}
                            />
                        </>
                    )}

                    {issues.isSuccess && (
                        <footer className="border-t border-border pt-6">
                            <Button
                                variant="link"
                                onClick={() => setPersona('seasoned')}
                                className="h-auto p-0"
                                data-testid="workboard-newbie-switch-power"
                            >
                                Switch to Operator view
                            </Button>
                        </footer>
                    )}
                </div>
            </div>
            )}

            <IssueDetailSheet
                num={openIssue}
                onOpenChange={(open) => { if (!open) setOpenIssue(null); }}
            />
        </div>
    );
}

// Cap each bucket so a long catch-all (Other) never renders as a scroll wall
// that undercuts the calm Guided framing; the tail collapses behind an expander.
const BUCKET_ROW_CAP = 6;

function Bucket({
    title, blurb, dot, items, onOpen,
}: {
    title: string;
    blurb: string;
    dot: string;
    items: IssueRow[];
    onOpen: (num: number) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const overCap = items.length > BUCKET_ROW_CAP;
    const visible = expanded || !overCap ? items : items.slice(0, BUCKET_ROW_CAP);
    const hiddenCount = items.length - visible.length;

    return (
        // Keep the faint card lift (no shadow-none override) so buckets read as
        // distinct surfaces rather than dissolving into a wide viewport.
        <Card className="gap-0 p-4">
            <header className="mb-3 flex items-baseline gap-3">
                <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
                <h2 className="text-section text-foreground">
                    {title}
                </h2>
                <span className="text-small text-muted-foreground">
                    {items.length} item{items.length === 1 ? '' : 's'}
                </span>
            </header>
            <p className="mb-3 text-body leading-relaxed text-muted-foreground">{blurb}</p>

            {items.length === 0 ? (
                <p className="text-small italic text-muted-foreground/70">No items in this bucket. Triage the next bucket down.</p>
            ) : (
                <ul className="flex flex-col divide-y divide-border/60">
                    {visible.map((iss) => (
                        <li
                            key={iss.number}
                            data-testid={`workboard-newbie-row-${iss.number}`}
                        >
                            {/* Whole row is the click target: drop the per-row dot
                                (the bucket header already encodes severity) and the
                                per-row Open button (a button ladder) in favour of a
                                hover chevron affordance. */}
                            <button
                                type="button"
                                onClick={() => onOpen(iss.number)}
                                className="group/row flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-secondary/40"
                            >
                                <span className="font-mono text-small text-muted-foreground tabular-nums">
                                    #{iss.number}
                                </span>
                                <span className="flex-1 text-body-strong leading-snug text-foreground group-hover/row:underline">
                                    {cleanIssueTitle(iss.title)}
                                </span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover/row:opacity-100" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {overCap && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    data-testid={`workboard-newbie-bucket-expander-${title.toLowerCase()}`}
                    className="mt-3 inline-flex items-center gap-1 self-start text-small font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    {expanded ? 'Show less' : `Show ${hiddenCount} more`}
                </button>
            )}
        </Card>
    );
}

function BucketSkeleton({ rows }: { rows: number }) {
    return (
        <Card className="gap-0 p-4">
            <header className="mb-3 flex items-center gap-3">
                <Skeleton className="h-3 w-3 shrink-0 rounded-full" />
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-12" />
            </header>
            <Skeleton className="mb-3 h-4 w-3/5" />
            <ul className="flex flex-col divide-y divide-border/60">
                {Array.from({ length: rows }).map((_, i) => (
                    <li key={i} className="flex items-center gap-4 py-3">
                        <Skeleton className="h-4 w-10" />
                        <Skeleton className="h-4 flex-1" />
                    </li>
                ))}
            </ul>
        </Card>
    );
}

function groupBySeverity(issues: IssueRow[]): {
    critical: IssueRow[]; high: IssueRow[]; other: IssueRow[];
} {
    const out = { critical: [] as IssueRow[], high: [] as IssueRow[], other: [] as IssueRow[] };
    for (const i of issues) {
        const names = i.labels.map((l) => l.name.toLowerCase());
        if (names.includes('severity:critical')) out.critical.push(i);
        else if (names.includes('severity:high')) out.high.push(i);
        else out.other.push(i);
    }
    // Other is the catch-all and runs long, so surface the freshest rows first
    // (the cap hides the tail behind a "Show N more" expander downstream).
    out.other.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return out;
}

// Inline detail sheet mirroring the seasoned panel's shape, with the
// same IPC source. Kept local so the newbie file is self-contained.
function IssueDetailSheet({
    num, onOpenChange,
}: {
    num: number | null;
    onOpenChange: (open: boolean) => void;
}) {
    const detail = useIssueDetail(num);
    const open = num !== null;
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[640px] flex-col border-l border-border bg-popover text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8"
                    data-testid="issue-detail-sheet"
                >
                    <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                        <div className="min-w-0 flex-1">
                            {detail.data && (
                                <>
                                    <div className="flex items-center gap-2 text-small text-muted-foreground">
                                        <span className="font-mono tabular-nums">#{detail.data.number}</span>
                                        <span>opened by {detail.data.author ?? 'unknown'}</span>
                                        <span>{new Date(detail.data.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <Dialog.Title className="mt-1 text-page-title leading-snug">
                                        {cleanIssueTitle(detail.data.title)}
                                    </Dialog.Title>
                                </>
                            )}
                            {!detail.data && detail.isLoading && (
                                <Dialog.Title className="text-body text-muted-foreground">Loading issue...</Dialog.Title>
                            )}
                            {!detail.data && !detail.isLoading && (
                                <Dialog.Title className="text-body text-muted-foreground">Issue not found. It may have been closed or transferred.</Dialog.Title>
                            )}
                        </div>
                        <Dialog.Close
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            aria-label="Close"
                        >
                            <X className="h-4 w-4" />
                        </Dialog.Close>
                    </header>

                    <div className="flex-1 overflow-y-auto px-5 py-4">
                        {detail.isLoading && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                <span>Loading issue...</span>
                            </div>
                        )}
                        {detail.data && (
                            <>
                                {detail.data.body ? (
                                    <article
                                        data-testid="issue-body"
                                        className="prose-issue text-body leading-relaxed text-foreground"
                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.data.body) }}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground">No description.</p>
                                )}

                                {detail.data.comments.length > 0 && (
                                    <section className="mt-6">
                                        <h3 className="mb-2 flex items-center gap-2 text-label uppercase text-muted-foreground">
                                            <MessageCircle className="h-3 w-3" />
                                            {detail.data.comments.length} comment{detail.data.comments.length === 1 ? '' : 's'}
                                        </h3>
                                        <div className="space-y-3">
                                            {detail.data.comments.map((c, idx) => (
                                                <div key={idx} className="rounded-md border border-border bg-card px-3.5 py-3">
                                                    <div className="mb-1.5 flex items-center gap-2 text-small text-muted-foreground">
                                                        <span className="font-medium text-foreground">{c.author}</span>
                                                        <Calendar className="h-2.5 w-2.5" />
                                                        <span>{c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}</span>
                                                    </div>
                                                    <article
                                                        className="prose-issue text-body leading-relaxed text-foreground"
                                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </>
                        )}
                    </div>

                    {detail.data && (
                        <footer className="border-t border-border px-5 py-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { void bridge.openExternal(detail.data!.url); }}
                            >
                                <ExternalLink className="h-3 w-3" />
                                View on GitHub
                            </Button>
                        </footer>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
