import type { ReactNode } from 'react';
import { CornerDownRight } from 'lucide-react';

/**
 * DocDemo frames a LIVE Console component inside a bordered stage so a doc
 * page can show the real UI it is describing, not a screenshot. It builds on
 * the same dot-grid stage as DemoStage (a pulsing Live badge, a soft floor),
 * and adds two doc-only affordances: a scale knob so a heavier component can
 * be shrunk to fit the reading column, and an optional annotation callout that
 * points at one detail in the projection.
 *
 * The wrapper is marked not-prose so the projected component keeps its own
 * panel typography instead of inheriting the docs-body prose rules.
 */
export function DocDemo({
    children,
    caption,
    annotation,
    scale = 1,
    className,
    contentClassName,
}: {
    children?: ReactNode;
    /** A short line under the stage naming what the reader is looking at. */
    caption?: string;
    /** An inline note pointing at one detail inside the projection. */
    annotation?: ReactNode;
    /** Shrink a heavy component to fit the column. 1 means render at full size. */
    scale?: number;
    className?: string;
    contentClassName?: string;
}) {
    // Scaling visually shrinks the component but leaves its laid-out height
    // unchanged, so the stage would keep a tall gap below it. Reserving height
    // by the same factor closes that gap without clipping the content.
    const scaled = scale !== 1;

    return (
        <figure
            className={['not-prose my-6', className].filter(Boolean).join(' ')}
            data-testid="doc-demo"
        >
            <div className="relative rounded-xl border border-border bg-card shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)]">
                <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
                    <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Live
                </span>
                <div
                    className={['relative overflow-hidden rounded-xl p-6', contentClassName].filter(Boolean).join(' ')}
                    style={{
                        backgroundImage:
                            'radial-gradient(color-mix(in oklch, var(--muted-foreground) 22%, transparent) 1px, transparent 1px)',
                        backgroundSize: '18px 18px',
                    }}
                >
                    {scaled ? (
                        <div style={{ height: `calc(100% / ${1 / scale})` }} className="flex justify-center">
                            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
                                {children}
                            </div>
                        </div>
                    ) : (
                        children
                    )}
                </div>
            </div>

            {annotation && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-accent-subtle bg-accent-subtle/40 px-3 py-2 text-small text-foreground/90">
                    <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    <span>{annotation}</span>
                </div>
            )}

            {caption && (
                <figcaption className="mt-2 text-center text-small text-muted-foreground">
                    {caption}
                </figcaption>
            )}
        </figure>
    );
}
