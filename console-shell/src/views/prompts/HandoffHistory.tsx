import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Copy, FileCog, FileText, TerminalSquare, FolderOpen } from 'lucide-react';
import { bridge, type HandoffRecord, type HandoffTool } from '../../lib/bridge';
import { Button } from '@/components/ui/button';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

/**
 * The handoff audit trail: every prompt sent to a dev tool, logged locally to
 * .refringence-console/handoff-log.jsonl. The prompt text is never stored - only
 * a hash and length - so the log is a safe record of what was sent, when, where.
 */
export function HandoffHistoryButton({ root }: { root: string | null }) {
    const [open, setOpen] = useState(false);
    if (!root) return null;
    return (
        <>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="handoff-history-open">
                <History className="h-3 w-3" />
                History
            </Button>
            {open && <HandoffHistoryDialog root={root} open={open} onOpenChange={setOpen} />}
        </>
    );
}

const TOOL_META: Record<HandoffTool, { label: string; icon: typeof Copy }> = {
    copy: { label: 'Copied to clipboard', icon: Copy },
    cursorrules: { label: 'Wrote .cursorrules', icon: FileCog },
    agentsmd: { label: 'Wrote AGENTS.md', icon: FileText },
    claude: { label: 'Ran in Claude Code', icon: TerminalSquare },
    'open-cursor': { label: 'Opened in Cursor', icon: FolderOpen },
};

function relativeTime(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
}

function HandoffHistoryDialog({ root, open, onOpenChange }: { root: string; open: boolean; onOpenChange: (o: boolean) => void }) {
    const q = useQuery<HandoffRecord[]>({
        queryKey: ['devhandoff', 'recent', root],
        queryFn: () => bridge.devhandoff.recentHandoffs(root),
        staleTime: 10_000,
    });
    const items = q.data ?? [];
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Handoff history</DialogTitle>
                    <DialogDescription>
                        Every prompt you sent to a dev tool from this project, logged locally. The prompt text is never stored, only a hash, so this is a safe audit trail.
                    </DialogDescription>
                </DialogHeader>
                {items.length === 0 ? (
                    <p className="py-6 text-center text-small text-muted-foreground" data-testid="handoff-history-empty">
                        No handoffs yet. Send a prompt to a dev tool and it shows up here.
                    </p>
                ) : (
                    <ul className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto" data-testid="handoff-history-list">
                        {items.map((h, i) => {
                            const meta = TOOL_META[h.tool] ?? { label: h.tool, icon: History };
                            const Icon = meta.icon;
                            const showTarget = h.target && h.tool !== 'copy' && h.tool !== 'claude' && h.tool !== 'open-cursor';
                            return (
                                <li key={i} className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2">
                                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-small text-foreground">
                                            {meta.label}{showTarget ? ` · ${h.target}` : ''}
                                        </p>
                                        <p className="text-label text-muted-foreground">
                                            {relativeTime(h.ts)}{h.promptChars ? ` · ${h.promptChars.toLocaleString()} chars` : ''}
                                        </p>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    );
}
