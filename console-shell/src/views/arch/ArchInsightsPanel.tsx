import { Repeat, Unlink, Share2, ArrowDownUp, ShieldCheck } from 'lucide-react';
import { useArchitectureGraph } from '../../lib/queries/arch';
import { SectionLabel } from '../../components/ui';
import type { ArchFinding, DependencyGraph } from '../../lib/bridge';

/**
 * Architecture insights: deterministic findings the dependency graph implies but
 * a picture alone does not surface - cycles, orphaned packages, central hubs, and
 * layering smells. Medium-confidence findings are labelled so the reader treats
 * them as a prompt to look, never an instruction to delete.
 */

const KIND_ICON: Record<ArchFinding['kind'], typeof Repeat> = {
    cycle: Repeat,
    orphan: Unlink,
    hub: Share2,
    'layer-violation': ArrowDownUp,
};

const SEV_CLASS: Record<ArchFinding['severity'], string> = {
    high: 'text-danger',
    medium: 'text-warning',
    info: 'text-muted-foreground',
};

export function ArchInsightsPanel({ root }: { root: string }) {
    const graph = useArchitectureGraph(root, false, false);
    if (!graph.data || graph.data.nodes.length === 0) return null;
    const findings = graph.data.insights?.findings ?? [];

    return (
        <div className="flex flex-col gap-6">
            <CouplingMetrics graph={graph.data} />
            <section className="flex flex-col gap-3" data-testid="arch-insights">
                <div className="flex items-baseline justify-between">
                    <SectionLabel>{findings.length === 0 ? 'Insights' : 'Refactoring opportunities'}</SectionLabel>
                    <p className="tabular-nums text-small text-muted-foreground">
                        {findings.length === 0 ? 'no issues found' : `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`}
                    </p>
                </div>
                {findings.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-small text-muted-foreground" data-testid="arch-insights-clean">
                        <ShieldCheck className="size-4 text-success-text" />
                        No cycles, orphaned packages, or layering issues found in the dependency graph.
                    </div>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {findings.map((f, i) => <FindingRow key={`${f.kind}-${i}`} f={f} />)}
                    </ul>
                )}
            </section>
        </div>
    );
}

// Per-package coupling: who depends on what, and how stable each package is.
// fanIn is the load-bearing signal (a high-fanIn package is a hub to keep
// stable); instability pairs with it to flag a fragile core (many depend on it,
// yet it itself depends on a lot).
function CouplingMetrics({ graph }: { graph: DependencyGraph }) {
    const metrics = (graph.insights?.metrics ?? []).filter((m) => m.fanIn + m.fanOut > 0);
    if (metrics.length < 2) return null;
    const labelById = new Map(graph.nodes.map((n) => [n.id, n.label]));
    const ranked = [...metrics].sort((a, b) => b.fanIn - a.fanIn || b.fanOut - a.fanOut).slice(0, 8);

    return (
        <section className="flex flex-col gap-3" data-testid="arch-coupling">
            <SectionLabel>Coupling</SectionLabel>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-5 border-b border-border px-4 py-2 text-label uppercase tracking-wide text-muted-foreground/70">
                    <span>Package</span>
                    <span className="text-right">Dependents</span>
                    <span className="text-right">Depends on</span>
                    <span className="text-right">Instability</span>
                </div>
                {ranked.map((m) => {
                    const risky = m.fanIn >= 3 && m.instability >= 0.5;
                    return (
                        <div key={m.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-5 border-b border-border px-4 py-2 text-small last:border-0">
                            <code className="truncate font-mono text-label text-foreground">{labelById.get(m.id) ?? m.id}</code>
                            <span className={`text-right tabular-nums ${m.fanIn >= 3 ? 'text-foreground' : 'text-muted-foreground'}`}>{m.fanIn}</span>
                            <span className="text-right tabular-nums text-muted-foreground">{m.fanOut}</span>
                            <span className={`text-right tabular-nums ${risky ? 'text-warning' : 'text-muted-foreground'}`}>{m.instability.toFixed(2)}</span>
                        </div>
                    );
                })}
            </div>
            <p className="text-label text-muted-foreground">
                Dependents = packages that import this one (a high count is a hub to keep stable and well tested). Instability runs 0 (nothing depends on it changing) to 1 (a pure consumer); a high-dependent package that is also unstable is a fragile core worth a look.
            </p>
        </section>
    );
}

function FindingRow({ f }: { f: ArchFinding }) {
    const Icon = KIND_ICON[f.kind];
    return (
        <li className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3" data-testid={`arch-finding-${f.kind}`}>
            <Icon className={`mt-0.5 size-4 shrink-0 ${SEV_CLASS[f.severity]}`} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-card-title text-foreground">{f.title}</p>
                    {f.confidence === 'medium' && (
                        <span className="rounded border border-border px-1.5 py-0.5 text-label text-muted-foreground">worth a look</span>
                    )}
                </div>
                <p className="mt-1 text-small leading-relaxed text-muted-foreground">{f.detail}</p>
            </div>
        </li>
    );
}
