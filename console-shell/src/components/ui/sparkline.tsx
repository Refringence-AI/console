import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Sparkline - a dependency-free inline-SVG trend line for MEANINGFUL time series
 * (eval pass-rate, CI duration), never decoration. Draws a polyline in
 * `currentColor`; default tone is text-muted-foreground so it stays neutral.
 *
 * Single flat or empty series renders nothing (a flat line answers no question).
 */
export function Sparkline({
    data,
    width = 96,
    height = 24,
    className,
    title,
    ...props
}: React.SVGProps<SVGSVGElement> & {
    data: number[];
    width?: number;
    height?: number;
    title?: string;
}) {
    if (data.length < 2) return null;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    // 1px inset so the stroke is not clipped at the top/bottom edges.
    const pad = 1;
    const innerH = height - pad * 2;
    const step = data.length > 1 ? width / (data.length - 1) : 0;

    const points = data
        .map((v, i) => {
            const x = i * step;
            const y = pad + innerH - ((v - min) / span) * innerH;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');

    return (
        <svg
            data-slot="sparkline"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role={title ? 'img' : undefined}
            aria-hidden={title ? undefined : true}
            aria-label={title}
            className={cn('text-muted-foreground', className)}
            {...props}
        >
            {title && <title>{title}</title>}
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

// 5 intensity buckets: empty/quiet cell -> increasing success wash. Token-driven
// (bg-muted for zero, bg-success at rising alpha) so it tracks both themes.
const HEAT_LEVELS = [
    'bg-muted',
    'bg-success/30',
    'bg-success/50',
    'bg-success/70',
    'bg-success/90',
] as const;

/**
 * HeatStrip - a GitHub-style commit-activity strip (90 cells by default). Maps
 * each value to one of 5 neutral->success intensity levels by quantile of the
 * series max, so it reads as "how busy was each day" at a glance.
 */
export function HeatStrip({
    values,
    cells = 90,
    className,
    title,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    values: number[];
    cells?: number;
    title?: string;
}) {
    // Right-align the most recent `cells` values (newest on the right).
    const recent = values.slice(-cells);
    const max = Math.max(0, ...recent);

    const level = (v: number) => {
        if (max <= 0 || v <= 0) return 0;
        // 4 active bands over (0, max]; quantise the ratio into 1..4.
        return Math.min(4, Math.ceil((v / max) * 4));
    };

    return (
        <div
            data-slot="heat-strip"
            role={title ? 'img' : undefined}
            aria-hidden={title ? undefined : true}
            aria-label={title}
            title={title}
            className={cn('flex flex-wrap gap-[3px]', className)}
            {...props}
        >
            {recent.map((v, i) => (
                <span
                    key={i}
                    aria-hidden
                    className={cn('size-2.5 rounded-sm', HEAT_LEVELS[level(v)])}
                />
            ))}
        </div>
    );
}
