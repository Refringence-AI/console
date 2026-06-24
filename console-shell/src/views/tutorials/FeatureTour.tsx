import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { GUIDED_SLIDES, OPERATOR_SLIDES } from './TutorialSlides';

/**
 * Walk-through carousel. A centered, single-column layout (distinct from the
 * onboarding tour's split): the TITLE sits on top, the large screenshot is
 * centre-justified with the prev/next arrows spaced out at either end of it,
 * and the DESCRIPTION sits below. Title + description live in fixed-height rows
 * and the slides cross-fade as absolutely-stacked layers, so nothing shifts as
 * you move between slides.
 */
export function FeatureTour({ compact = false }: { compact?: boolean }) {
    // Operator gets the full feature tour; Guided gets the four essentials.
    const { isNewbie } = usePersonaMode();
    const slides = isNewbie ? GUIDED_SLIDES : OPERATOR_SLIDES;
    const count = slides.length;
    const [selected, setSelected] = useState(0);
    const slide = slides[selected];
    const isFirst = selected === 0;
    const isLast = selected === count - 1;
    const prev = () => setSelected((s) => Math.max(0, s - 1));
    const next = () => setSelected((s) => Math.min(count - 1, s + 1));

    return (
        <div className="flex w-full flex-col items-center gap-6" data-testid="feature-tour">
            {/* TITLE on top - fixed height so the screenshot never shifts up/down. */}
            <div className="flex h-[84px] shrink-0 flex-col items-center justify-end gap-1.5 text-center">
                <span
                    className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground"
                    data-testid="feature-tour-counter"
                >
                    Walk through · {selected + 1} of {count}
                </span>
                <h2 className="max-w-[28ch] font-serif text-[clamp(1.6rem,2.5vw,2.1rem)] leading-[1.12] tracking-tight text-foreground">
                    {slide.title}
                </h2>
            </div>

            {/* SCREENSHOT centre-justified, arrows spaced out at either end. */}
            <div className="flex w-full items-center justify-center gap-4 sm:gap-7">
                <ArrowButton dir="left" onClick={prev} disabled={isFirst} testid="feature-tour-prev" />
                <div className={cn(
                    'relative aspect-[16/10] w-full shrink overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
                    compact ? 'max-w-2xl' : 'max-w-3xl',
                )}>
                    {slides.map((s, i) => (
                        // Imported assets (bundled by Vite) resolve under file://. Two
                        // imgs per slide so the screenshot matches the app theme; the
                        // slide cross-fades as a stacked layer.
                        <div
                            key={s.id}
                            aria-hidden={i !== selected}
                            className={cn(
                                'absolute inset-0 transition-opacity duration-200 ease-out',
                                i === selected ? 'opacity-100' : 'opacity-0',
                            )}
                        >
                            <img src={s.light} alt={s.title} className="h-full w-full object-cover object-top dark:hidden" />
                            <img src={s.dark} alt="" aria-hidden className="hidden h-full w-full object-cover object-top dark:block" />
                        </div>
                    ))}
                </div>
                <ArrowButton dir="right" onClick={next} disabled={isLast} testid="feature-tour-next" />
            </div>

            {/* DESCRIPTION on the bottom + dot rail - fixed height. */}
            <div className="flex h-[116px] shrink-0 flex-col items-center gap-4">
                <p className="min-h-[60px] max-w-prose text-center text-body leading-relaxed text-muted-foreground">
                    {slide.body}
                </p>
                <div className="flex items-center gap-2" role="tablist" aria-label="Walk through">
                    {slides.map((s, i) => (
                        <button
                            key={s.id}
                            type="button"
                            role="tab"
                            aria-selected={i === selected}
                            onClick={() => setSelected(i)}
                            aria-label={`Go to ${i + 1}: ${s.title}`}
                            data-testid={`feature-tour-dot-${i}`}
                            className={cn(
                                'h-1.5 rounded-full transition-all',
                                i === selected ? 'w-6 bg-accent' : 'w-1.5 bg-border hover:bg-muted-foreground',
                            )}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ArrowButton({
    dir, onClick, disabled, testid,
}: {
    dir: 'left' | 'right'; onClick: () => void; disabled: boolean; testid: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-testid={testid}
            aria-label={dir === 'left' ? 'Previous' : 'Next'}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:border-foreground/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
            {dir === 'left' ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
        </button>
    );
}
