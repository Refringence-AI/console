import { useId } from 'react';
import { cn } from '@/lib/utils';

// A calm SVG dot grid for use as a section background (the feature-carousel
// screenshot mat). Pure SVG, no animation, no dependency - lighter than the
// reactive ascii field. The dot colour is currentColor, so set it with a text
// utility (e.g. text-white/[0.07]); an optional radial fade keeps the dots
// densest behind the focal content and lets them dissolve at the edges.
export function DotPattern({
    className,
    gap = 22,
    radius = 1,
    fade = true,
}: {
    className?: string;
    gap?: number;
    radius?: number;
    fade?: boolean;
}) {
    const id = useId();
    const mask = 'radial-gradient(ellipse at center, black 35%, transparent 78%)';
    return (
        <svg
            aria-hidden
            className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
            style={fade ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        >
            <defs>
                <pattern id={id} x="0" y="0" width={gap} height={gap} patternUnits="userSpaceOnUse">
                    <circle cx={radius} cy={radius} r={radius} fill="currentColor" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id})`} />
        </svg>
    );
}
