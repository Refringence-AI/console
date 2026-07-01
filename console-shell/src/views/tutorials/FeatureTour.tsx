import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { GUIDED_SLIDES, OPERATOR_SLIDES } from './TutorialSlides';
import Grainient from '@/components/Grainient/Grainient';

/**
 * Walk-through carousel. Two panels: a 1/3 white copy panel on the LEFT (title +
 * body + dot nav + back/next) and a 2/3 stage on the RIGHT where a light-mode
 * screenshot floats in a glassmorphic frame over a soft, on-brand Grainient
 * gradient. Screenshots are deliberately light-only here, so the stage reads the
 * same in either app theme. Slides cross-fade as absolutely-stacked layers.
 */
export function FeatureTour() {
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
        <div
            className="grid min-h-[460px] w-full grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
            data-testid="feature-tour"
        >
            {/* LEFT 1/3 - white copy panel. */}
            <div className="flex min-w-0 flex-col justify-between gap-8 bg-card p-7 sm:p-9">
                <div className="flex flex-col gap-3">
                    <span
                        className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground"
                        data-testid="feature-tour-counter"
                    >
                        Walk through · {selected + 1} of {count}
                    </span>
                    <h2 className="font-serif text-[clamp(1.5rem,2.4vw,2.1rem)] leading-[1.12] tracking-tight text-foreground">
                        {slide.title}
                    </h2>
                    <p className="text-body leading-relaxed text-muted-foreground">{slide.body}</p>
                </div>
                <div className="flex flex-col gap-5">
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
                    <div className="flex items-center gap-2">
                        <NavButton dir="left" onClick={prev} disabled={isFirst} testid="feature-tour-prev" />
                        <NavButton dir="right" onClick={next} disabled={isLast} testid="feature-tour-next" />
                    </div>
                </div>
            </div>

            {/* RIGHT 2/3 - Grainient stage with the light screenshot in a glass frame.
                A soft on-brand gradient sits under the Grainient as a guaranteed
                backdrop (the WebGL canvas may not paint in every environment). */}
            <div
                className="relative hidden min-w-0 items-center justify-center overflow-hidden p-7 sm:p-10 md:flex"
                style={{ background: 'linear-gradient(135deg, #c4d6fb 0%, #d8c6f4 50%, #bfe9f3 100%)' }}
            >
                <div className="absolute inset-0" aria-hidden>
                    <Grainient
                        className="h-full w-full"
                        color1="#9fc0fa"
                        color2="#c4a9ee"
                        color3="#9bdcec"
                        grainAmount={0.08}
                        warpStrength={0.6}
                        timeSpeed={0.4}
                    />
                </div>
                <div className="relative w-full max-w-3xl rounded-2xl border border-white/45 bg-white/15 p-2 shadow-[0_2px_10px_rgba(0,0,0,0.08),0_24px_60px_-16px_rgba(0,0,0,0.35)] backdrop-blur-md">
                    <div className="relative aspect-[16/10] overflow-hidden rounded-xl">
                        {slides.map((s, i) => (
                            // Light screenshots only - the stage reads the same in either
                            // app theme. Imported assets resolve under file:// via Vite.
                            <img
                                key={s.id}
                                src={s.light}
                                alt={i === selected ? s.title : ''}
                                aria-hidden={i !== selected}
                                className={cn(
                                    'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-200 ease-out',
                                    i === selected ? 'opacity-100' : 'opacity-0',
                                )}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function NavButton({
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
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:border-foreground/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
            {dir === 'left' ? <ArrowLeft className="size-4" /> : <ArrowRight className="size-4" />}
        </button>
    );
}
