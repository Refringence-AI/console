import { GripVertical, MessageCircle, ExternalLink } from 'lucide-react';

/**
 * A static, non-interactive port of the Workboard's IssueCard. Lives inside
 * a DemoStage on the Workboard docs page so readers see exactly the same
 * card they'll meet in the panel: grip handle, mono number, title clamp,
 * coloured label chips, comment count.
 *
 * Styling mirrors IssuesPanel.tsx::CardBody / SortableIssueCard verbatim;
 * just no dnd-kit wiring.
 */
export function WorkboardCardDemo() {
    const issue = {
        number: 142,
        author: 'octocat',
        title: 'Workboard: drag a critical card to phase to keep the rolled-up severity stable',
        labels: [
            { name: 'severity:critical', color: 'e11d48' },
            { name: 'area:workboard', color: '3b82f6' },
            { name: 'phase:Q3b', color: '10b981' },
        ],
        commentCount: 4,
    };

    return (
        <div className="mx-auto w-full max-w-[296px]">
            <div className="group relative rounded-md border border-border bg-background text-left shadow-sm">
                <div className="cursor-grab touch-none px-1.5 py-2 align-middle text-muted-foreground/40">
                    <GripVertical className="h-3 w-3" />
                </div>
                <div className="pl-7 pr-2.5 pt-2 pb-2.5">
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[10.5px]">
                            <span className="font-mono tabular-nums text-muted-foreground/80">
                                #{issue.number}
                            </span>
                            <span className="text-muted-foreground/40">/</span>
                            <span className="text-muted-foreground/80">{issue.author}</span>
                            <ExternalLink className="ml-auto h-2.5 w-2.5 text-muted-foreground/40" />
                        </div>
                        <div className="text-[12.5px] font-medium leading-snug text-foreground line-clamp-2">
                            {issue.title}
                        </div>
                        <div className="flex flex-wrap gap-1 pt-0.5">
                            {issue.labels.map((l) => (
                                <span
                                    key={l.name}
                                    className="rounded px-1.5 py-0.5 text-[9.5px] font-medium leading-none"
                                    style={{
                                        backgroundColor: `#${l.color}26`,
                                        color: `#${l.color}`,
                                        border: `1px solid #${l.color}3a`,
                                    }}
                                >
                                    {l.name}
                                </span>
                            ))}
                        </div>
                        <div className="flex items-center gap-1 pt-0.5 text-[10px] text-muted-foreground">
                            <MessageCircle className="h-2.5 w-2.5" />
                            <span className="tabular-nums">{issue.commentCount}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
