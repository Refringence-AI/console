// console-shell/src/components/RunningIndicator.tsx
//
// Live status line for a running process: spinner + mm:ss elapsed + a
// Cancel button. Elapsed ticks client-side from startedAt so it stays
// truthful even between output lines.
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';

interface RunningIndicatorProps {
    label: string;
    startedAt: number;
    runId: string;
    onStop: (runId: string) => void;
    className?: string;
}

function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function RunningIndicator({ label, startedAt, runId, onStop, className }: RunningIndicatorProps) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);

    return (
        <div
            data-testid="running-indicator"
            className={cn(
                'flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2',
                className,
            )}
        >
            <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
            <span className="truncate text-small text-foreground">{label}</span>
            <span className="ml-auto font-mono text-small tabular-nums text-muted-foreground">
                {formatElapsed(now - startedAt)}
            </span>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onStop(runId)}
                className="h-7 gap-1.5 text-label"
            >
                <X className="size-3.5" />
                Cancel
            </Button>
        </div>
    );
}
