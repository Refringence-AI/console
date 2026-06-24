// console-shell/src/components/LiveConsole.tsx
//
// Terminal-styled, fixed-height scrolling log for one run's output.
// Auto-scrolls to the bottom unless the user has scrolled up. stderr
// lines render in the danger token. Copy-all lifts the whole buffer.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import type { RunLine } from '../lib/useRunner';

interface LiveConsoleProps {
    lines: RunLine[];
    className?: string;
}

export function LiveConsole({ lines, className }: LiveConsoleProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const stickRef = useRef(true);
    const [copied, setCopied] = useState(false);

    // Keep pinned to the bottom unless the user scrolled away.
    useEffect(() => {
        const el = scrollRef.current;
        if (el && stickRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [lines]);

    function onScroll() {
        const el = scrollRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        stickRef.current = atBottom;
    }

    async function copyAll() {
        try {
            await navigator.clipboard.writeText(lines.map((l) => l.line).join('\n'));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard blocked; ignore */
        }
    }

    return (
        <div
            data-testid="live-console"
            className={cn(
                'relative rounded-xl border border-border bg-card overflow-hidden',
                className,
            )}
        >
            <Button
                variant="ghost"
                size="sm"
                onClick={copyAll}
                disabled={lines.length === 0}
                className="absolute right-2 top-2 z-10 h-7 gap-1.5 text-label"
            >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy all'}
            </Button>
            <div
                ref={scrollRef}
                onScroll={onScroll}
                className="max-h-[320px] overflow-y-auto px-3 py-2.5 font-mono text-small leading-relaxed"
            >
                {lines.length === 0 ? (
                    <div className="text-muted-foreground">Waiting for output...</div>
                ) : (
                    lines.map((l, i) => (
                        <div
                            key={i}
                            className={cn(
                                'whitespace-pre-wrap break-all',
                                l.stream === 'stderr' ? 'text-danger-text' : 'text-foreground',
                            )}
                        >
                            {l.line || ' '}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
