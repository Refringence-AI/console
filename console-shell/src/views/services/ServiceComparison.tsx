import { useState } from 'react';
import { Scale, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
    SERVICE_CATALOG, SERVICE_CATEGORIES, fitsBudget,
    type CatalogService, type ServiceCategory,
} from './serviceCatalog';

const BUDGET_KEY = 'refringence-console-budget-cap';

function readBudget(): number {
    try { const v = Number(localStorage.getItem(BUDGET_KEY)); return Number.isFinite(v) && v >= 0 ? v : 0; }
    catch { return 0; }
}

/**
 * Compare + choose services by what they do and what they cost. Tier data is
 * researched against 2026 pricing; a budget cap dims what does not fit and the
 * cheapest shippable option per category is marked Recommended.
 */
export function CompareServicesButton() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="services-compare-open">
                <Scale className="h-3 w-3" />
                Compare
            </Button>
            {open && <ComparisonDialog open={open} onOpenChange={setOpen} />}
        </>
    );
}

function recommendedId(services: CatalogService[], cap: number): string | null {
    // Prefer the cheapest shippable: a real free tier first, else the lowest
    // flat fee that fits the cap.
    const free = services.filter((s) => s.freeUsable);
    if (free.length > 0) return free[0].id;
    const affordable = services.filter((s) => fitsBudget(s, cap)).sort((a, b) => a.paidFromUsd - b.paidFromUsd);
    return affordable[0]?.id ?? null;
}

function ComparisonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const [budget, setBudget] = useState<number>(() => readBudget());

    function setCap(v: number) {
        const n = Number.isFinite(v) && v >= 0 ? v : 0;
        setBudget(n);
        try { localStorage.setItem(BUDGET_KEY, String(n)); } catch { /* noop */ }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent data-testid="services-compare-dialog" className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Compare services</DialogTitle>
                    <DialogDescription>Pick what fits your project and budget. Free-tier limits and paid entry points are current as of 2026.</DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
                    <span className="text-small text-muted-foreground">Monthly budget</span>
                    <div className="flex items-center">
                        <span className="text-small text-muted-foreground">$</span>
                        <Input
                            type="number" min={0} value={budget}
                            onChange={(e) => setCap(Number(e.target.value))}
                            className="h-7 w-20 px-2"
                            data-testid="services-budget-input"
                        />
                    </div>
                    <span className="text-small text-muted-foreground">{budget === 0 ? 'Free tiers only - paid options are dimmed.' : `Showing what fits $${budget}/mo.`}</span>
                </div>

                <div className="flex max-h-[58vh] flex-col gap-6 overflow-y-auto px-0.5 pr-1.5">
                    {SERVICE_CATEGORIES.map((cat) => {
                        const services = SERVICE_CATALOG.filter((s) => s.category === cat.id);
                        if (services.length === 0) return null;
                        const rec = recommendedId(services, budget);
                        return (
                            <section key={cat.id} className="flex flex-col gap-2.5" data-testid={`compare-cat-${cat.id}`}>
                                <div className="flex items-baseline gap-2">
                                    <h3 className="text-card-title text-foreground">{cat.label}</h3>
                                    <span className="text-small text-muted-foreground">{cat.need}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                    {services.map((s) => (
                                        <ServiceCompareCard key={s.id} service={s} budget={budget} recommended={s.id === rec} />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>

                <DialogFooter className="sm:justify-end">
                    <Button variant="primary" onClick={() => onOpenChange(false)} data-testid="services-compare-done">Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ServiceCompareCard({ service: s, budget, recommended }: { service: CatalogService; budget: number; recommended: boolean }) {
    const fits = fitsBudget(s, budget);
    return (
        <div
            className={`flex flex-col gap-1.5 rounded-lg border p-3.5 transition ${
                recommended ? 'border-foreground/30 bg-secondary/40' : 'border-border bg-card'
            } ${fits ? '' : 'opacity-50'}`}
            data-testid={`compare-service-${s.id}`}
        >
            <div className="flex items-center gap-2">
                <span className="text-small font-medium text-foreground">{s.name}</span>
                {s.freeUsable
                    ? <Badge variant="success" className="rounded-md">Free tier</Badge>
                    : <Badge variant="secondary" className="rounded-md">{s.paidFromUsd > 0 ? `from $${s.paidFromUsd}/mo` : 'usage-based'}</Badge>}
                {recommended && (
                    <Badge variant="outline" className="ml-auto rounded-md text-foreground"><Check className="h-2.5 w-2.5" />Pick</Badge>
                )}
            </div>
            <p className="text-small text-muted-foreground">{s.bestFor}</p>
            <dl className="flex flex-col gap-0.5">
                <div className="flex gap-1.5 text-label">
                    <dt className="shrink-0 uppercase tracking-wide text-muted-foreground/70">Free</dt>
                    <dd className="text-muted-foreground">{s.free}</dd>
                </div>
                <div className="flex gap-1.5 text-label">
                    <dt className="shrink-0 uppercase tracking-wide text-muted-foreground/70">Paid</dt>
                    <dd className="text-muted-foreground">{s.paidFrom}</dd>
                </div>
            </dl>
            <p className="text-label text-muted-foreground/70">{s.caveat}</p>
        </div>
    );
}

// Re-export the category type for callers that filter by it.
export type { ServiceCategory };
