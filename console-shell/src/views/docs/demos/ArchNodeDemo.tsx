import { cn } from '@/lib/utils';

/**
 * A static projection of one architecture-graph node plus its tier legend.
 * The full ArchitectureGraph needs a ReactFlow canvas, an ELK layout pass,
 * and a live dependency walk, so projecting it whole is too heavy for a doc
 * body. Instead this mirrors ArchitectureGraph.tsx::ArchNodeCard and Legend
 * verbatim: the same tier tint, the same dot, the same LOC / files line, so
 * the reader meets the exact node they will click on in the panel.
 */
const TIERS: { key: string; label: string; border: string; tint: string; dot: string }[] = [
    { key: 'shell', label: 'Shell', border: 'border-accent-solid', tint: 'bg-accent-subtle', dot: 'bg-accent-solid' },
    { key: 'presentation', label: 'Presentation', border: 'border-info/50', tint: 'bg-info/10', dot: 'bg-info' },
    { key: 'domain', label: 'Domain', border: 'border-foreground/40', tint: 'bg-foreground/5', dot: 'bg-foreground' },
    { key: 'data', label: 'Data', border: 'border-warning/50', tint: 'bg-warning/10', dot: 'bg-warning' },
    { key: 'infra', label: 'Infra', border: 'border-border', tint: 'bg-muted/40', dot: 'bg-muted-foreground' },
];

export function ArchNodeDemo() {
    const presentation = TIERS[1];
    return (
        <div className="flex w-full max-w-[520px] flex-col items-center gap-5">
            <div
                className={cn(
                    'rounded-xl border bg-card px-3 py-2 shadow-sm',
                    presentation.border,
                    presentation.tint,
                )}
            >
                <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', presentation.dot)} aria-hidden />
                    <span className="font-mono text-card-title text-foreground">console-shell</span>
                </div>
                <p className="mt-0.5 pl-4 text-small tabular-nums text-muted-foreground">
                    8,420 LOC · 96 files
                </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card p-3">
                {TIERS.map((t) => (
                    <div key={t.key} className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', t.dot)} aria-hidden />
                        <span className="text-label text-muted-foreground">{t.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
