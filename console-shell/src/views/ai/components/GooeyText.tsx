import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';

// Gooey morph between two short strings (the streaming verb). Algorithm from
// reacticx's gooey-text (threshold matrix
// 1 0 0 0 0 / 0 1 0 0 0 / 0 0 1 0 0 / 0 0 0 18 -7, Math.pow(f, 0.4) opacity). The
// blur is capped tight so small UI text never gets wiped to invisible at the
// midpoint. text-white -> text-foreground so it reads in both themes.
const MAX_BLUR_PX = 4;
const MIN_FRACTION = 0.001;
const MORPH_MS = 500;
const TRANSLATE_PX = 6;

function calcBlur(f: number): number {
    if (f <= MIN_FRACTION) return MAX_BLUR_PX;
    const b = 8 / f - 8;
    return Math.min(Math.max(b, 0), MAX_BLUR_PX);
}
function calcOpacity(f: number): number {
    return Math.pow(Math.max(0, Math.min(1, f)), 0.4);
}

export function GooeyText({
    text,
    className,
    fontSizePx,
}: {
    text: string;
    className?: string;
    fontSizePx?: number;
}) {
    const filterId = useId().replace(/:/g, '_');
    const outRef = useRef<HTMLSpanElement>(null);
    const inRef = useRef<HTMLSpanElement>(null);
    const prevRef = useRef<string>(text);
    const tokenRef = useRef<number>(0);

    useEffect(() => {
        if (text === prevRef.current) return;
        const prev = prevRef.current;
        prevRef.current = text;

        if (outRef.current) {
            outRef.current.textContent = prev;
            outRef.current.style.opacity = '1';
            outRef.current.style.filter = 'blur(0)';
            outRef.current.style.transform = 'translateY(0)';
        }
        if (inRef.current) {
            inRef.current.textContent = text;
            inRef.current.style.opacity = '0';
            inRef.current.style.filter = `blur(${MAX_BLUR_PX}px)`;
            inRef.current.style.transform = `translateY(${TRANSLATE_PX}px)`;
        }

        const start = performance.now();
        const myToken = ++tokenRef.current;

        const tick = (now: number) => {
            if (tokenRef.current !== myToken) return;
            const frac = Math.min(1, (now - start) / MORPH_MS);
            if (outRef.current) {
                const f = 1 - frac;
                outRef.current.style.opacity = String(calcOpacity(f));
                outRef.current.style.filter = `blur(${calcBlur(f)}px)`;
                outRef.current.style.transform = `translateY(${-frac * TRANSLATE_PX}px)`;
            }
            if (inRef.current) {
                inRef.current.style.opacity = String(calcOpacity(frac));
                inRef.current.style.filter = `blur(${calcBlur(frac)}px)`;
                inRef.current.style.transform = `translateY(${(1 - frac) * TRANSLATE_PX}px)`;
            }
            if (frac < 1) {
                requestAnimationFrame(tick);
            } else {
                if (outRef.current) { outRef.current.style.opacity = '0'; outRef.current.style.filter = 'blur(0)'; }
                if (inRef.current) { inRef.current.style.opacity = '1'; inRef.current.style.filter = 'blur(0)'; inRef.current.style.transform = 'translateY(0)'; }
            }
        };
        requestAnimationFrame(tick);
    }, [text]);

    const fontStyle = fontSizePx ? { fontSize: `${fontSizePx}px` } : undefined;

    return (
        <span className={cn('relative inline-grid leading-none', className)} style={fontStyle}>
            <svg className="absolute h-0 w-0 overflow-hidden" aria-hidden focusable={false}>
                <defs>
                    <filter id={`goo-${filterId}`}>
                        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
                    </filter>
                </defs>
            </svg>
            <span aria-hidden="true" className="col-start-1 row-start-1 invisible whitespace-nowrap font-medium">
                {text}
            </span>
            <span className="col-start-1 row-start-1 inline-grid" style={{ filter: `url(#goo-${filterId})` }}>
                <span ref={outRef} className="col-start-1 row-start-1 whitespace-nowrap font-medium text-foreground will-change-[opacity,filter,transform]" style={{ opacity: 0 }} />
                <span ref={inRef} className="col-start-1 row-start-1 whitespace-nowrap font-medium text-foreground will-change-[opacity,filter,transform]">
                    {text}
                </span>
            </span>
        </span>
    );
}
