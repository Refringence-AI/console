import { useMemo, useState } from 'react';
import { Workflow, FolderOpen, Loader2, ArrowRight, ChevronRight, Boxes, Network } from 'lucide-react';
import { Link } from 'react-router';
import { useRepoSummary } from '../../lib/queries/repo';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { bridge, type RepoPackageEntry } from '../../lib/bridge';
import { PanelHeader } from '../_shell/PanelHeader';
import { ArchitectureNewbie } from './ArchitectureNewbie';
import { ArchitectureGraph } from './ArchitectureGraph';
import { SystemsView } from './SystemsView';
import { Card, Button, SectionLabel, EmptyState } from '../../components/ui';
import { cn } from '../../lib/utils';

/**
 * Architecture panel.
 *
 * Surfaces a package-level dependency overview: each top-level
 * package gets a row showing role, LOC, file count, and the
 * hand-authored map of which other packages it imports from and
 * is imported by.
 *
 * The hand-authored dependency map (PACKAGE_META) is the source of
 * truth until the live extractor pipeline lands. Edges are
 * intentionally curated rather than scraped, so the picture matches
 * the architecture's intent rather than incidental imports.
 */

type PackageMeta = {
    /** 1-line plain-English description of what this package owns. */
    role: string;
    /** Packages this one imports from (by name). */
    importsFrom: string[];
    /** Packages that import from this one. Derived at runtime. */
    importedBy?: string[];
};

const PACKAGE_META: Record<string, PackageMeta> = {
    'console-shell': {
        role: 'React renderer for the Console app you are looking at right now.',
        importsFrom: ['packages/design-tokens'],
    },
    'console-electron': {
        role: 'Electron main process. Owns the window, IPC, and the project-intelligence engine.',
        importsFrom: ['console-shell'],
    },
    'packages/design-tokens': {
        role: 'Shared Tailwind v4 tokens, colour scales, typography.',
        importsFrom: [],
    },
    docs: {
        role: 'Markdown surface. Architecture notes, runbooks, guides.',
        importsFrom: [],
    },
    scripts: {
        role: 'Build, capture, and lint entry points.',
        importsFrom: [],
    },
};

function lookupMeta(name: string): PackageMeta {
    return PACKAGE_META[name] ?? { role: '', importsFrom: [] };
}

function buildEdgeMap(packages: RepoPackageEntry[]): Record<string, PackageMeta> {
    const names = new Set(packages.map((p) => p.name));
    const out: Record<string, PackageMeta> = {};
    for (const p of packages) {
        const meta = lookupMeta(p.name);
        out[p.name] = {
            role: meta.role,
            importsFrom: meta.importsFrom.filter((n) => names.has(n)),
            importedBy: [],
        };
    }
    for (const [name, meta] of Object.entries(out)) {
        for (const dep of meta.importsFrom) {
            if (out[dep]) {
                out[dep].importedBy = [...(out[dep].importedBy ?? []), name];
            }
        }
    }
    return out;
}

export function ArchPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <ArchitectureNewbie />;
    return <ArchSeasoned />;
}

function ArchSeasoned() {
    const repo = useRepoSummary();
    const { project, setProject } = useActiveProject();
    const projectRoot = project?.path ?? '';
    const [picking, setPicking] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const [listOpen, setListOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'code' | 'systems'>('code');

    const edgeMap = useMemo(
        () => (repo.data ? buildEdgeMap(repo.data.packages) : {}),
        [repo.data],
    );

    const sortedPackages = useMemo(() => {
        if (!repo.data) return [];
        return [...repo.data.packages].sort((a, b) => b.total_loc - a.total_loc);
    }, [repo.data]);

    async function pickFolder() {
        setPicking(true);
        try {
            const result = await bridge.project.pickFolder();
            if (!result.canceled && result.path) {
                setProject(result.path);
            }
        } finally {
            setPicking(false);
        }
    }

    const noProject = !projectRoot;
    const isLoading = repo.isLoading && !!projectRoot;
    const isError = repo.isError && !!projectRoot;

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="arch-panel">
            <PanelHeader
                icon={Workflow}
                title="Architecture"
                subtitle={viewMode === 'systems'
                    ? 'The AI systems map: named systems on real repository paths.'
                    : "How the project's packages relate. Hover to see what depends on what."}
                testid="arch-panel-header"
            >
                <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5" data-testid="arch-view-toggle">
                    {([['code', 'Code', Boxes], ['systems', 'Systems', Network]] as const).map(([mode, label, Icon]) => (
                        <button
                            key={mode}
                            onClick={() => setViewMode(mode)}
                            data-testid={`arch-view-${mode}`}
                            className={cn(
                                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-small transition-colors',
                                viewMode === mode ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <Icon className="size-3.5" />
                            {label}
                        </button>
                    ))}
                </div>
            </PanelHeader>

            <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
                {noProject && (
                    <NoProjectEmptyState picking={picking} onPick={pickFolder} />
                )}

                {!noProject && viewMode === 'systems' && (
                    <SystemsView root={projectRoot} />
                )}

                {viewMode === 'code' && isLoading && <LoadingSkeleton />}

                {viewMode === 'code' && isError && (
                    <Card
                        className="items-center gap-3 p-6 text-center"
                        data-testid="arch-error-state"
                    >
                        <div className="flex flex-col gap-1">
                            <p className="text-body text-foreground">
                                Could not read the repo summary.
                            </p>
                            <p className="text-small text-muted-foreground">
                                Check that the repo indexer has scanned this folder.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => repo.refetch()}
                        >
                            Retry
                        </Button>
                    </Card>
                )}

                {viewMode === 'code' && !noProject && !isLoading && !isError && repo.data && (
                    <section className="flex flex-col gap-6" data-testid="arch-package-list">
                        <div>
                            <div className="mb-3 flex items-baseline justify-between">
                                <SectionLabel>Dependency graph</SectionLabel>
                                <p className="text-small tabular-nums text-muted-foreground">
                                    {repo.data.total_packages.toLocaleString()} packages
                                    {' · '}
                                    {repo.data.total_files.toLocaleString()} files
                                    {' · '}
                                    {repo.data.total_loc.toLocaleString()} LOC
                                </p>
                            </div>
                            <ArchitectureGraph root={projectRoot} mode="operator" />
                            <p className="mt-3 text-small text-muted-foreground">
                                Edges are extracted live from imports. Toggle Edit layout to
                                drag nodes; per-node tier, notes, and hide/show save to
                                .refringence-console/architecture.json.
                            </p>
                        </div>

                        <div>
                            <button
                                onClick={() => setListOpen((v) => !v)}
                                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                                data-testid="arch-list-toggle"
                            >
                                <ChevronRight
                                    className={`h-4 w-4 transition-transform ${listOpen ? 'rotate-90' : ''}`}
                                />
                                <SectionLabel className="text-inherit">List view</SectionLabel>
                            </button>

                            {listOpen && (
                                <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                                    {sortedPackages.map((pkg) => {
                                        const meta = edgeMap[pkg.name];
                                        const isHighlighted =
                                            hovered !== null &&
                                            (hovered === pkg.name ||
                                                (edgeMap[hovered]?.importsFrom ?? []).includes(pkg.name) ||
                                                (edgeMap[hovered]?.importedBy ?? []).includes(pkg.name));
                                        const dimmed = hovered !== null && !isHighlighted;
                                        return (
                                            <PackageRow
                                                key={pkg.name}
                                                pkg={pkg}
                                                meta={meta}
                                                dimmed={dimmed}
                                                highlighted={isHighlighted && hovered !== pkg.name}
                                                active={hovered === pkg.name}
                                                onHover={(name) => setHovered(name)}
                                            />
                                        );
                                    })}
                                </ul>
                            )}
                            {listOpen && (
                                <p className="mt-3 text-small text-muted-foreground">
                                    The list view uses the hand-authored role map (PACKAGE_META)
                                    for plain-English package descriptions.
                                </p>
                            )}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

function PackageRow({
    pkg,
    meta,
    dimmed,
    highlighted,
    active,
    onHover,
}: {
    pkg: RepoPackageEntry;
    meta: PackageMeta | undefined;
    dimmed: boolean;
    highlighted: boolean;
    active: boolean;
    onHover: (name: string | null) => void;
}) {
    const imports = meta?.importsFrom ?? [];
    const importedBy = meta?.importedBy ?? [];

    return (
        <li
            className={[
                'group relative transition-opacity',
                dimmed ? 'opacity-40' : 'opacity-100',
                active ? 'bg-secondary/40' : highlighted ? 'bg-accent-subtle' : '',
            ].join(' ')}
            onMouseEnter={() => onHover(pkg.name)}
            onMouseLeave={() => onHover(null)}
            data-testid={`arch-pkg-${pkg.name}`}
        >
            {active && (
                <span className="absolute inset-y-0 left-0 w-[2px] bg-accent-solid" aria-hidden />
            )}
            <Link
                to="/repo"
                className="block px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <div className="flex items-baseline gap-3">
                    <span className="font-mono text-card-title text-foreground">
                        {pkg.name}
                    </span>
                    <span className="tabular-nums text-small text-muted-foreground">
                        {pkg.total_loc.toLocaleString()} LOC
                        {' · '}
                        {pkg.file_count.toLocaleString()} files
                    </span>
                </div>
                {meta?.role && (
                    <p className="mt-1 text-small leading-5 text-muted-foreground">
                        {meta.role}
                    </p>
                )}
                {(imports.length > 0 || importedBy.length > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        {imports.length > 0 && (
                            <EdgeRow label="Imports" packages={imports} />
                        )}
                        {importedBy.length > 0 && (
                            <EdgeRow label="Imported by" packages={importedBy} />
                        )}
                    </div>
                )}
            </Link>
        </li>
    );
}

function EdgeRow({ label, packages }: { label: string; packages: string[] }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <SectionLabel className="text-muted-foreground/80">
                {label}
            </SectionLabel>
            {packages.map((name) => (
                <span
                    key={name}
                    className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-label text-foreground/80"
                >
                    {shortName(name)}
                </span>
            ))}
        </div>
    );
}

function shortName(name: string): string {
    if (name.startsWith('bundled-tools/')) return name.slice('bundled-tools/'.length);
    if (name.startsWith('packages/')) return name.slice('packages/'.length);
    return name;
}

function LoadingSkeleton() {
    return (
        <div
            className="overflow-hidden rounded-xl border border-border bg-card"
            data-testid="arch-loading"
        >
            {Array.from({ length: 6 }).map((_, i) => (
                <div
                    key={i}
                    className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0"
                >
                    <div className="h-3 w-48 animate-pulse rounded bg-secondary/60" />
                    <div className="h-2.5 w-72 animate-pulse rounded bg-secondary/40" />
                    <div className="mt-1 h-2.5 w-56 animate-pulse rounded bg-secondary/40" />
                </div>
            ))}
        </div>
    );
}

function NoProjectEmptyState({
    picking,
    onPick,
}: {
    picking: boolean;
    onPick: () => void;
}) {
    return (
        <EmptyState
            icon={FolderOpen}
            title="Architecture is project-scoped."
            data-testid="arch-no-project"
            action={
                <Button
                    variant="default"
                    size="sm"
                    onClick={onPick}
                    disabled={picking}
                    data-testid="arch-pick-folder"
                >
                    {picking ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <FolderOpen className="h-3.5 w-3.5" />
                    )}
                    Pick a folder
                    <ArrowRight className="h-3.5 w-3.5 opacity-80" />
                </Button>
            }
        >
            Pick a folder in the TopBar to see how its packages depend on each other.
        </EmptyState>
    );
}
