import { CheckCircle2, AlertCircle, XCircle, MinusCircle } from 'lucide-react';
import { Badge } from '@/components/ui';

/**
 * A static projection of the Release panel's gate rows plus the summary bar.
 * It mirrors ReleasePanel.tsx::GateList / SummaryBar exactly: the same status
 * icons, the same green / amber / red / blocked badge variants and labels,
 * the same artifact line. Sample gates stand in for a live checklist read.
 */
type DemoStatus = 'green' | 'amber' | 'red' | 'blocked';

const GATES: { label: string; artifact: string; status: DemoStatus }[] = [
    { label: 'Type check passes', artifact: '.github/workflows/typecheck.yml', status: 'green' },
    { label: 'QA suite green', artifact: '.refringence-qa/runs/latest', status: 'green' },
    { label: 'Eval pass rate above 90%', artifact: 'eval-harness/promptfoo/report.json', status: 'amber' },
    { label: 'Release tag signed', artifact: 'git tag v0.3.0', status: 'blocked' },
];

export function ReleaseGatesDemo() {
    return (
        <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border border-l-2 border-l-warning bg-card px-4 py-2.5 text-small">
                <AlertCircle className="h-4 w-4 shrink-0 text-warning-text" />
                <span className="text-body-strong text-foreground">Soft-block, pending verification</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground"><strong className="text-foreground">2</strong> green</span>
                <span className="text-muted-foreground"><strong className="text-foreground">1</strong> amber</span>
                <span className="text-muted-foreground"><strong className="text-foreground">0</strong> red</span>
                <span className="text-muted-foreground"><strong className="text-foreground">1</strong> blocked</span>
            </div>
            <ul className="divide-y divide-border">
                {GATES.map((g) => (
                    <li key={g.label} className="flex items-start gap-3 px-4 py-2.5">
                        <StatusIcon status={g.status} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-small">
                                <span className="text-body-strong text-foreground">{g.label}</span>
                                <Badge variant={badgeVariant(g.status)} className="rounded-md">
                                    {label(g.status)}
                                </Badge>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                                {g.artifact}
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function StatusIcon({ status }: { status: DemoStatus }) {
    const cls = 'mt-0.5 h-4 w-4 shrink-0';
    if (status === 'green') return <CheckCircle2 className={`${cls} text-success-text`} />;
    if (status === 'amber') return <AlertCircle className={`${cls} text-warning-text`} />;
    if (status === 'red') return <XCircle className={`${cls} text-danger-text`} />;
    return <MinusCircle className={`${cls} text-muted-foreground`} />;
}

function badgeVariant(status: DemoStatus): 'success' | 'warning' | 'danger' | 'secondary' {
    if (status === 'green') return 'success';
    if (status === 'amber') return 'warning';
    if (status === 'red') return 'danger';
    return 'secondary';
}

function label(status: DemoStatus): string {
    if (status === 'green') return 'Passing';
    if (status === 'amber') return 'Pending';
    if (status === 'red') return 'Failing';
    return 'Blocked';
}
