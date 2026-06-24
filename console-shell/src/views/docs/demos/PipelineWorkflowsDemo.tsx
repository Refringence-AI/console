import { GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui';

/**
 * A static projection of how the Pipeline panel reads CI workflows: one row
 * per workflow file, each tagged with the events that trigger it. The real
 * panel lays these out as an SVG node graph, which is too heavy for a doc
 * body, so this lighter row form carries the same information (workflow name,
 * triggers) using the real Badge token styling.
 */
const WORKFLOWS: { name: string; file: string; triggers: string[] }[] = [
    { name: 'Lint and unit', file: 'ci.yml', triggers: ['push'] },
    { name: 'Type check + QA', file: 'qa.yml', triggers: ['pull_request'] },
    { name: 'Build and publish', file: 'release.yml', triggers: ['tag'] },
];

export function PipelineWorkflowsDemo() {
    return (
        <div className="flex w-full max-w-[520px] flex-col gap-2">
            {WORKFLOWS.map((w) => (
                <div
                    key={w.file}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                    <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                        <div className="text-body-strong text-foreground">{w.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">.github/workflows/{w.file}</div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                        {w.triggers.map((t) => (
                            <Badge key={t} variant="secondary" className="rounded-md font-mono">
                                {t}
                            </Badge>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
