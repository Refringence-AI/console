/**
 * Lightweight inline-SVG dashboard primitives.
 *
 * No chart-library dependency: each primitive is a small, theme-aware
 * SVG built from the data the panel already has. The aesthetic target is
 * Linear / Vercel / Notion: thin strokes, rounded caps, a muted track, a
 * single semantic accent per shape, generous negative space. Numbers stay
 * in the surrounding markup (tabular-nums); these shapes carry the
 * proportion, not the precision.
 *
 * Every primitive is honest about empty data: a zero total renders the
 * muted track only, never a fabricated series.
 */

export type Tone = 'emerald' | 'amber' | 'rose' | 'slate' | 'accent' | 'foreground';

const STROKE: Record<Tone, string> = {
    emerald: 'stroke-success',
    amber: 'stroke-warning',
    rose: 'stroke-danger',
    slate: 'stroke-muted-foreground',
    accent: 'stroke-accent',
    foreground: 'stroke-foreground',
};

const FILL: Record<Tone, string> = {
    emerald: 'fill-success',
    amber: 'fill-warning',
    rose: 'fill-danger',
    slate: 'fill-muted-foreground',
    accent: 'fill-accent',
    foreground: 'fill-foreground',
};

export interface Segment {
    value: number;
    tone: Tone;
    label?: string;
}

/**
 * Donut — a segmented ring. Segments are drawn clockwise from 12 o'clock
 * with a hairline gap between them. The centre is free for a total + caption.
 */
export function Donut({
    segments,
    size = 92,
    stroke = 9,
    gap = 2,
    ariaLabel,
    children,
}: {
    segments: Segment[];
    size?: number;
    stroke?: number;
    gap?: number;
    ariaLabel?: string;
    children?: React.ReactNode;
}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);

    let offset = 0;
    const arcs = total > 0
        ? segments
            .filter((s) => s.value > 0)
            .map((s, i) => {
                const frac = s.value / total;
                const len = Math.max(0, frac * c - gap);
                const dash = `${len} ${c - len}`;
                const node = (
                    <circle
                        key={i}
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        className={STROKE[s.tone]}
                        strokeDasharray={dash}
                        strokeDashoffset={-offset}
                    />
                );
                offset += frac * c;
                return node;
            })
        : [];

    return (
        <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                className="-rotate-90"
                role="img"
                aria-label={ariaLabel}
            >
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    className="stroke-muted"
                />
                {arcs}
            </svg>
            {children && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
            )}
        </div>
    );
}

/**
 * SegmentedBar — a thin horizontal stacked bar with rounded ends. Reads as
 * one continuous rail; a zero total renders the muted track alone.
 */
export function SegmentedBar({
    segments,
    height = 8,
    className = '',
    ariaLabel,
}: {
    segments: Segment[];
    height?: number;
    className?: string;
    ariaLabel?: string;
}) {
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    return (
        <div
            className={`flex w-full overflow-hidden rounded-full bg-muted ${className}`}
            style={{ height }}
            role="img"
            aria-label={ariaLabel}
        >
            {total > 0 &&
                segments
                    .filter((s) => s.value > 0)
                    .map((s, i) => (
                        <div
                            key={i}
                            className={FILL[s.tone].replace('fill-', 'bg-')}
                            style={{ width: `${(s.value / total) * 100}%` }}
                            title={s.label ? `${s.label}: ${s.value}` : String(s.value)}
                        />
                    ))}
        </div>
    );
}

/**
 * Gauge — a 270-degree radial arc for a single value against a max. The
 * arc opens at the bottom; the fill sweeps clockwise from the lower-left.
 */
export function Gauge({
    value,
    max,
    size = 92,
    stroke = 9,
    tone = 'foreground',
    ariaLabel,
    children,
}: {
    value: number;
    max: number;
    size?: number;
    stroke?: number;
    tone?: Tone;
    ariaLabel?: string;
    children?: React.ReactNode;
}) {
    const r = (size - stroke) / 2;
    const sweep = 0.75; // 270deg
    const c = 2 * Math.PI * r;
    const arc = c * sweep;
    const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

    return (
        <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                className="rotate-[135deg]"
                role="img"
                aria-label={ariaLabel}
            >
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    className="stroke-muted"
                    strokeDasharray={`${arc} ${c - arc}`}
                />
                {frac > 0 && (
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        className={STROKE[tone]}
                        strokeDasharray={`${arc * frac} ${c - arc * frac}`}
                    />
                )}
            </svg>
            {children && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
            )}
        </div>
    );
}

/**
 * BarList — Vercel-style horizontal bars: label on the left, a proportional
 * bar, the value right-aligned. Bars share a max so lengths are comparable.
 */
export function BarList({
    items,
    tone = 'foreground',
    max,
    ariaLabel,
    formatValue = (n) => n.toLocaleString(),
}: {
    items: { label: string; value: number }[];
    tone?: Tone;
    max?: number;
    ariaLabel?: string;
    formatValue?: (n: number) => string;
}) {
    const top = max ?? Math.max(1, ...items.map((i) => i.value));
    const barBg = FILL[tone].replace('fill-', 'bg-');
    return (
        <div className="flex flex-col gap-1.5" role="img" aria-label={ariaLabel}>
            {items.map((it) => (
                <div key={it.label} className="flex items-center gap-2.5">
                    <span className="w-28 shrink-0 truncate text-[11.5px] text-muted-foreground">{it.label}</span>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/70">
                        <div
                            className={`absolute inset-y-0 left-0 rounded-full ${barBg} opacity-80`}
                            style={{ width: `${Math.max(2, (it.value / top) * 100)}%` }}
                        />
                    </div>
                    <span className="w-12 shrink-0 text-right text-[11.5px] tabular-nums text-foreground">
                        {formatValue(it.value)}
                    </span>
                </div>
            ))}
        </div>
    );
}

/**
 * Sparkline — a tiny inline-SVG trend line, no library. Points are
 * normalized to their own min/max and stroked in a muted tone by default,
 * so the line carries proportion without competing with the one cyan accent.
 *
 * It refuses to draw a misleading slope: a series of fewer than three
 * points, a perfectly flat series, or one with fewer than two distinct
 * nonzero values renders nothing. A real trend needs more than a diagonal
 * between two stray samples.
 */
export function Sparkline({
    points,
    tone,
    width = 80,
    height = 24,
    ariaLabel,
}: {
    points: number[];
    tone?: Tone;
    width?: number;
    height?: number;
    ariaLabel?: string;
}) {
    if (points.length < 3) return null;

    const distinctNonzero = new Set(points.filter((p) => p !== 0));
    if (distinctNonzero.size < 2) return null;

    const pad = 2;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;

    const coords = points.map((p, i) => {
        const x = pad + (i / (points.length - 1)) * innerW;
        const y = span > 0 ? pad + (1 - (p - min) / span) * innerH : pad + innerH / 2;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={ariaLabel}
            className="overflow-visible"
        >
            <polyline
                points={coords.join(' ')}
                fill="none"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={tone ? STROKE[tone] : 'stroke-muted-foreground'}
            />
        </svg>
    );
}

/**
 * LegendDot — a labelled count keyed to a tone, for sitting beside a Donut.
 */
export function LegendDot({ tone, count, label }: { tone: Tone; count: number; label: string }) {
    const bg = FILL[tone].replace('fill-', 'bg-');
    return (
        <span className="inline-flex items-center gap-1.5 text-[12px]">
            <span className={`h-1.5 w-1.5 rounded-full ${bg}`} />
            <strong className="tabular-nums text-foreground">{count}</strong>
            <span className="text-muted-foreground">{label}</span>
        </span>
    );
}
