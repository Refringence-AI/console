import { ShieldAlert, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiPermissionRequest, AiPermissionDecision } from '../../../lib/bridge';

// The composer morphs into this card when the assistant asks to write a file:
// a header with the action summary, a scrollable diff preview, and the three
// decisions. Allow-session remembers the choice for the rest of the turn so the
// assistant can make a series of edits without a prompt per file.
export function PermissionStickyCard({
    request,
    onRespond,
}: {
    request: AiPermissionRequest;
    onRespond: (decision: AiPermissionDecision) => void;
}) {
    const isRun = request.kind === 'run';
    const lines = (request.diff ?? '').split('\n');
    return (
        <div className="shrink-0 px-4 pb-4 pt-1" data-testid="ai-permission-card">
            <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-accent" />
                    <span className="shrink-0 text-small font-medium text-foreground">{isRun ? 'Run command' : 'Approve change'}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-label text-muted-foreground">{request.title}</span>
                </div>
                {isRun ? (
                    <pre className="max-h-56 overflow-auto px-3.5 py-2.5 font-mono text-label leading-relaxed text-foreground" data-testid="ai-perm-command">
                        <span className="text-muted-foreground/60">$ </span>{request.command}
                    </pre>
                ) : (
                    <pre className="max-h-56 overflow-auto px-3.5 py-2 font-mono text-label leading-relaxed">
                        {lines.map((l, i) => (
                            <div
                                key={i}
                                className={cn(
                                    l.startsWith('+') && !l.startsWith('+++') ? 'text-success'
                                        : l.startsWith('-') && !l.startsWith('---') ? 'text-danger'
                                            : l.startsWith('@@') ? 'text-accent'
                                                : 'text-muted-foreground/70',
                                )}
                            >
                                {l || ' '}
                            </div>
                        ))}
                    </pre>
                )}
                <div className="flex items-center justify-end gap-2 border-t border-border px-2.5 py-2">
                    <button
                        type="button"
                        onClick={() => onRespond('deny')}
                        data-testid="ai-perm-deny"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-small text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                        <X className="h-3.5 w-3.5" /> Deny
                    </button>
                    <button
                        type="button"
                        onClick={() => onRespond('allow-session')}
                        data-testid="ai-perm-session"
                        className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-small text-foreground transition-colors hover:bg-secondary"
                    >
                        Allow for session
                    </button>
                    <button
                        type="button"
                        onClick={() => onRespond('allow')}
                        data-testid="ai-perm-allow"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-small text-accent-foreground transition-colors hover:opacity-90"
                    >
                        <Check className="h-3.5 w-3.5" /> Allow
                    </button>
                </div>
            </div>
        </div>
    );
}
