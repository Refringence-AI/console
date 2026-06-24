import { Rocket, Coins, ShieldCheck, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Donut, Gauge, SegmentedBar } from '@/components/viz';

/**
 * A static, non-interactive projection of the Overview "Vitals" tiles. It
 * reuses the exact viz primitives (Donut, Gauge, SegmentedBar) and Badge that
 * OverviewPanel renders, with fixed sample numbers in place of the live
 * queries, so a reader sees the real tile chrome rather than a screenshot.
 *
 * Styling mirrors OverviewPanel.tsx::VitalCell verbatim, minus the Link
 * navigation and the hover affordance.
 */
export function OverviewTilesDemo() {
    return (
        <div className="grid w-full max-w-[520px] grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile icon={Rocket} title="Release">
                <div className="flex items-center gap-3">
                    <Donut
                        size={64}
                        stroke={7}
                        segments={[
                            { value: 9, tone: 'emerald' },
                            { value: 2, tone: 'amber' },
                            { value: 1, tone: 'rose' },
                            { value: 2, tone: 'slate' },
                        ]}
                    >
                        <span className="text-card-title leading-none tabular-nums">14</span>
                    </Donut>
                    <div className="flex flex-col gap-1">
                        <Badge variant="warning" className="rounded-md">Pending checks</Badge>
                        <span className="text-small text-muted-foreground tabular-nums">9 ok · 5 open</span>
                    </div>
                </div>
            </Tile>

            <Tile icon={Coins} title="Cost today">
                <div className="flex items-center gap-3">
                    <Gauge value={12} max={50} size={64} stroke={7}>
                        <span className="text-small font-semibold leading-none tabular-nums">24%</span>
                    </Gauge>
                    <div className="flex flex-col">
                        <span className="text-metric leading-none tabular-nums">$12.40</span>
                        <span className="text-small text-muted-foreground">of $50 cap</span>
                    </div>
                </div>
            </Tile>

            <Tile icon={ShieldCheck} title="Evals">
                <div className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-2">
                        <span className="text-metric leading-none tabular-nums">92%</span>
                        <span className="text-small text-muted-foreground">pass rate</span>
                    </div>
                    <div className="flex items-center gap-3 text-body">
                        <Tally tone="text-success-text" Icon={CheckCircle2} value={46} />
                        <Tally tone="text-danger-text" Icon={XCircle} value={3} />
                        <Tally tone="text-warning-text" Icon={AlertCircle} value={1} />
                    </div>
                    <SegmentedBar
                        segments={[
                            { value: 46, tone: 'emerald' },
                            { value: 3, tone: 'rose' },
                            { value: 1, tone: 'amber' },
                        ]}
                    />
                </div>
            </Tile>
        </div>
    );
}

function Tile({
    children,
    icon: Icon,
    title,
}: React.PropsWithChildren<{ icon: React.ComponentType<{ className?: string }>; title: string }>) {
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-4">
            <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-body-strong text-foreground">{title}</h3>
            </div>
            {children}
        </div>
    );
}

function Tally({
    Icon,
    value,
    tone,
}: {
    Icon: React.ComponentType<{ className?: string }>;
    value: number;
    tone: string;
}) {
    return (
        <span className="inline-flex items-center gap-1">
            <Icon className={`h-3 w-3 ${tone}`} />
            <strong className="font-semibold tabular-nums">{value}</strong>
        </span>
    );
}
