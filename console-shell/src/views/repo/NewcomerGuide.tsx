import { Compass, Flame, BookOpen } from 'lucide-react';
import { useProjectSummary, useHotFiles, useReadingOrder } from '../../lib/queries/repoIntrospect';
import type { ProjectSummary, HotFile, ReadingEntry } from '../../lib/bridge';
import { cleanRepoDescription } from '../../lib/humanize';
import { Card, Skeleton, SectionLabel } from '../../components/ui';

interface Props {
    projectRoot: string;
}

export function NewcomerGuide({ projectRoot }: Props) {
    return (
        <div className="flex flex-col gap-3 p-4" data-testid="newcomer-guide">
            <SummaryCard projectRoot={projectRoot} />
            <HotFilesCard projectRoot={projectRoot} />
            <ReadingOrderCard projectRoot={projectRoot} />
        </div>
    );
}

function CardShell({
    icon,
    title,
    children,
    testid,
}: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
    testid: string;
}) {
    return (
        <Card className="gap-0 p-0 shadow-none" data-testid={testid}>
            <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                <span className="text-muted-foreground">{icon}</span>
                <h3 className="text-card-title text-foreground">{title}</h3>
            </header>
            <div className="px-4 py-3 text-body">{children}</div>
        </Card>
    );
}

function SkeletonLine({ width }: { width: string }) {
    return <Skeleton className={`h-3 ${width}`} />;
}

function SummaryCard({ projectRoot }: Props) {
    const q = useProjectSummary(projectRoot);
    return (
        <CardShell icon={<Compass className="h-4 w-4" aria-hidden />} title="Project summary" testid="newcomer-summary">
            {q.isLoading && (
                <div className="space-y-2">
                    <SkeletonLine width="w-1/3" />
                    <SkeletonLine width="w-2/3" />
                    <SkeletonLine width="w-1/2" />
                </div>
            )}
            {q.isError && <p className="text-body text-muted-foreground">Failed to read package.json, pyproject.toml or Cargo.toml.</p>}
            {q.data && <SummaryBody data={q.data} />}
        </CardShell>
    );
}

function SummaryBody({ data }: { data: ProjectSummary }) {
    const langs = Object.entries(data.languages).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const description = data.description ? cleanRepoDescription(data.description) : '';
    const hasAnything = data.name || description || data.license || langs.length > 0 || data.runCommands.length > 0;
    if (!hasAnything) {
        return <p className="text-body text-muted-foreground">No metadata found in this project.</p>;
    }
    return (
        <div className="space-y-3">
            <div>
                <div className="font-mono text-body text-foreground" data-testid="newcomer-summary-name">{data.name || 'unknown'}</div>
                {description && (
                    <p className="mt-1 text-body text-muted-foreground">{description}</p>
                )}
            </div>

            {langs.length > 0 && (
                <div>
                    <SectionLabel className="mb-1">Languages</SectionLabel>
                    <div className="flex flex-wrap gap-1.5" data-testid="newcomer-summary-languages">
                        {langs.map(([lang, count]) => (
                            <span key={lang} className="rounded-md border border-border bg-secondary px-2 py-0.5 text-label">
                                {lang} <span className="text-muted-foreground">({count})</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {data.license && (
                <div className="text-small">
                    <span className="text-muted-foreground">License: </span>
                    <span className="text-foreground">{data.license}</span>
                </div>
            )}

            {data.runCommands.length > 0 && (
                <div>
                    <SectionLabel className="mb-1">Run commands</SectionLabel>
                    <ul className="space-y-1" data-testid="newcomer-summary-commands">
                        {data.runCommands.map((cmd) => (
                            <li key={cmd}>
                                <code className="block w-full rounded-md bg-secondary px-2 py-1 font-mono text-small text-foreground">
                                    {cmd}
                                </code>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function HotFilesCard({ projectRoot }: Props) {
    const q = useHotFiles(projectRoot, 30);
    return (
        <CardShell icon={<Flame className="h-4 w-4" aria-hidden />} title="Hot files (last 30 days)" testid="newcomer-hotfiles">
            {q.isLoading && (
                <div className="space-y-2">
                    <SkeletonLine width="w-full" />
                    <SkeletonLine width="w-5/6" />
                    <SkeletonLine width="w-4/6" />
                </div>
            )}
            {q.isError && <p className="text-body text-muted-foreground">Not a git repo, or git is not on PATH. Run git init to populate hot files.</p>}
            {q.data && <HotFilesBody rows={q.data} />}
        </CardShell>
    );
}

function HotFilesBody({ rows }: { rows: HotFile[] }) {
    if (rows.length === 0) {
        return <p className="text-body text-muted-foreground">No git history in the last 30 days, or this is not a git repo.</p>;
    }
    return (
        <ul className="divide-y divide-border text-small" data-testid="newcomer-hotfiles-list">
            {rows.map((f, i) => (
                <li key={f.path} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 py-1.5">
                    <span className="w-5 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                    <span className="truncate font-mono text-foreground" title={f.path}>{f.path}</span>
                    <span className="tabular-nums text-muted-foreground">{f.changes.toLocaleString()} lines</span>
                    <span className="tabular-nums text-muted-foreground">{f.commits} commits</span>
                </li>
            ))}
        </ul>
    );
}

function ReadingOrderCard({ projectRoot }: Props) {
    const q = useReadingOrder(projectRoot);
    return (
        <CardShell icon={<BookOpen className="h-4 w-4" aria-hidden />} title="Recommended reading order" testid="newcomer-reading">
            {q.isLoading && (
                <div className="space-y-2">
                    <SkeletonLine width="w-full" />
                    <SkeletonLine width="w-5/6" />
                    <SkeletonLine width="w-4/6" />
                </div>
            )}
            {q.isError && <p className="text-body text-muted-foreground">Failed to analyse imports. No TS or JS files found in this project root.</p>}
            {q.data && <ReadingBody rows={q.data} />}
        </CardShell>
    );
}

function ReadingBody({ rows }: { rows: ReadingEntry[] }) {
    if (rows.length === 0) {
        return <p className="text-body text-muted-foreground">No JavaScript or TypeScript files found in this project.</p>;
    }
    return (
        <ol className="space-y-1 text-small" data-testid="newcomer-reading-list">
            {rows.map((r, i) => (
                <li key={r.path} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                    <span className="w-5 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                    <span className="truncate font-mono text-foreground" title={r.path}>{r.path}</span>
                    <span className="tabular-nums text-muted-foreground">{r.score} in</span>
                </li>
            ))}
        </ol>
    );
}
