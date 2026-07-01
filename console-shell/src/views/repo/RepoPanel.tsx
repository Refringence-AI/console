import { FolderTree, FileCode, Play, Layers, Circle, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useRepoSummary } from '../../lib/queries/repo';
import { useProjectShape, useProjectCapabilities } from '../../lib/queries/project';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PanelHeader } from '../_shell/PanelHeader';
import { NewcomerGuide } from './NewcomerGuide';
import { RepoNewbie } from './RepoNewbie';
import { GuidelineSetup } from './GuidelineSetup';
import { DependencyHealth, SecretsCheck, HygieneCheck, EnvCheck, MigrationDriftCheck, StaleArtifactsCheck, RepoHealthSummary, UnusedDepsCheck, MigrationLiveDiff } from './DependencyHealth';
import { SectionLabel } from '../../components/ui';
import {
    shapeSubtitle, inferPackageRole, packageEntryLabel,
    ROLE_META, ROLE_ORDER, type PackageRole,
} from '../../lib/projectShape';
import { cleanCopy } from '../../lib/humanize';
import type { RepoPackageEntry, ProjectShape, ProjectCapabilities } from '../../lib/bridge';

/**
 * Repo panel: an orientation surface. The Operator view leads with what
 * the project is and how to run it, then a structural map of packages
 * grouped by role. The LOC-ranked file table is demoted behind a tab so
 * size never reads as the point.
 */
function sentenceCaseLang(lang: string): string {
    if (!lang) return '';
    const upper = new Set(['HTML', 'CSS', 'XML', 'JSON', 'YAML', 'TOML', 'SQL', 'TSX', 'JSX']);
    if (upper.has(lang.toUpperCase())) return lang.toUpperCase();
    return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
}

export function RepoPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <RepoNewbie />;
    return <RepoSeasoned />;
}

type RepoTab = 'structure' | 'files';

function RepoSeasoned() {
    const repo = useRepoSummary();
    const { project } = useActiveProject();
    const root = project?.path ?? repo.data?.repo_root ?? '';
    const shape = useProjectShape(root);
    const caps = useProjectCapabilities(root);

    const [tab, setTab] = useState<RepoTab>('structure');
    const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
    const activePkg = repo.data?.packages.find((p) => p.name === selectedPkg) ?? repo.data?.packages[0] ?? null;
    const activeRoot = repo.data?.repo_root ?? root;

    const subtitle = cleanCopy(
        shape.data
            ? shapeSubtitle(shape.data, repo.data?.total_loc)
            : (repo.data ? `${repo.data.total_packages} packages, ${repo.data.total_loc.toLocaleString()} LOC` : 'Computing repo summary'),
    );

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="repo-panel">
            <PanelHeader
                icon={FolderTree}
                title="Repo"
                subtitle={subtitle}
                testid="repo-panel-header"
            >
                {shape.data?.runnable && shape.data.startCommand && (
                    <span
                        data-testid="repo-run-hint"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-small text-foreground"
                    >
                        <Play className="h-3 w-3 text-muted-foreground" />
                        {shape.data.startCommand}
                    </span>
                )}
                <RunnableDot shape={shape.data} caps={caps.data} />
                <GuidelineSetup projectRoot={activeRoot} />
            </PanelHeader>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-4 pt-2">
                        <TabButton active={tab === 'structure'} onClick={() => setTab('structure')} testid="repo-tab-structure">
                            <Layers className="h-3.5 w-3.5" /> Structure
                        </TabButton>
                        <TabButton active={tab === 'files'} onClick={() => setTab('files')} testid="repo-tab-files">
                            <FileCode className="h-3.5 w-3.5" /> Files by size
                        </TabButton>
                    </div>

                    {tab === 'structure' ? (
                        <StructureView
                            packages={repo.data?.packages ?? []}
                            loading={repo.isLoading}
                            error={repo.isError ? String(repo.error) : null}
                            shape={shape.data}
                        />
                    ) : (
                        <FilesView
                            packages={repo.data?.packages ?? []}
                            activePkg={activePkg}
                            selectedPkg={selectedPkg}
                            onSelect={setSelectedPkg}
                            loading={repo.isLoading}
                            error={repo.isError ? String(repo.error) : null}
                        />
                    )}
                </main>

                <aside
                    className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-background xl:block xl:w-96"
                    data-testid="repo-newcomer-aside"
                >
                    <NewcomerGuide projectRoot={activeRoot} />
                </aside>
            </div>
        </div>
    );
}

/**
 * Copy-to-clipboard affordance for the start command. The orientation
 * surface cannot run a shell, so copy is what makes the command usable.
 */
function CopyCommandButton({ command, className, testid }: { command: string; className?: string; testid: string }) {
    const [copied, setCopied] = useState(false);
    async function copy() {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable; leave state unchanged */
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            data-testid={testid}
            aria-label={copied ? 'Copied' : `Copy ${command}`}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className ?? ''}`}
        >
            {copied
                ? <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
    );
}

function RunnableDot({ shape, caps }: { shape?: ProjectShape; caps?: ProjectCapabilities }) {
    // Green when the project declares a way to run; amber when we found a
    // codebase but no start command; muted while we are still reading it.
    const tone = !shape
        ? { dot: 'bg-muted', label: 'reading' }
        : shape.runnable
            ? { dot: 'bg-success', label: 'runnable' }
            : { dot: 'bg-warning', label: 'no start command' };
    const ci = caps?.hasCiWorkflows ? ' · CI' : '';
    return (
        <span data-testid="repo-health-dot" className="inline-flex items-center gap-1.5 text-small text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
            {tone.label}{ci}
        </span>
    );
}

function TabButton({
    active, onClick, children, testid,
}: React.PropsWithChildren<{ active: boolean; onClick: () => void; testid: string }>) {
    return (
        <button
            type="button"
            data-testid={testid}
            onClick={onClick}
            className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 text-small transition-colors ${
                active
                    ? 'border-accent text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
        >
            {children}
        </button>
    );
}

interface RoleGroup {
    role: PackageRole;
    packages: RepoPackageEntry[];
}

function groupByRole(packages: RepoPackageEntry[]): RoleGroup[] {
    const buckets = new Map<PackageRole, RepoPackageEntry[]>();
    for (const pkg of packages) {
        const role = inferPackageRole(pkg.name);
        const list = buckets.get(role) ?? [];
        list.push(pkg);
        buckets.set(role, list);
    }
    return ROLE_ORDER
        .filter((role) => buckets.has(role))
        .map((role) => ({
            role,
            packages: (buckets.get(role) ?? []).sort((a, b) => b.total_loc - a.total_loc),
        }));
}

function StructureView({
    packages, loading, error, shape,
}: { packages: RepoPackageEntry[]; loading: boolean; error: string | null; shape?: ProjectShape }) {
    if (loading) return <div className="p-6 text-sm text-muted-foreground" data-testid="repo-structure">Scanning packages.</div>;
    if (error) return <div className="p-6 text-sm text-danger-text" data-testid="repo-structure">Failed to read repo summary: {error}</div>;
    if (packages.length === 0) {
        return (
            <div className="p-6 text-sm text-muted-foreground" data-testid="repo-structure">
                No packages detected. Pick a project folder from the top bar.
            </div>
        );
    }

    const groups = groupByRole(packages);

    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid="repo-structure">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
                {shape?.runnable && shape.startCommand && (
                    <section className="flex flex-col gap-1.5" data-testid="repo-how-to-run">
                        <SectionLabel>How to run it</SectionLabel>
                        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-4">
                            <Play className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <code className="min-w-0 truncate font-mono text-small text-foreground">{shape.startCommand}</code>
                            {shape.entryPoint && (
                                <span className="ml-auto truncate font-mono text-small text-muted-foreground" title={shape.entryPoint}>
                                    {shape.entryPoint}
                                </span>
                            )}
                            <CopyCommandButton
                                command={shape.startCommand}
                                className={shape.entryPoint ? '' : 'ml-auto'}
                                testid="repo-how-to-run-copy"
                            />
                        </div>
                    </section>
                )}

                <RepoHealthSummary />
                <HygieneCheck />
                <EnvCheck />
                <MigrationDriftCheck />
                <MigrationLiveDiff />
                <StaleArtifactsCheck />
                <DependencyHealth />
                <UnusedDepsCheck />
                <SecretsCheck />

                <section className="flex flex-col gap-4">
                    <SectionLabel>Structure</SectionLabel>
                    <div className="flex flex-col gap-6">
                        {groups.map((group) => (
                            <div key={group.role} className="flex flex-col gap-2.5" data-testid={`repo-role-${group.role}`}>
                                <div className="flex items-baseline gap-2">
                                    <h3 className="text-card-title text-foreground">{ROLE_META[group.role].label}</h3>
                                    <span className="text-small text-muted-foreground">{ROLE_META[group.role].blurb}</span>
                                </div>
                                <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border bg-card">
                                    {group.packages.map((pkg) => (
                                        <li
                                            key={pkg.name}
                                            data-testid={`repo-struct-pkg-${pkg.name}`}
                                            className="flex items-center gap-3 px-4 py-2.5"
                                        >
                                            <Circle className="h-1.5 w-1.5 shrink-0 fill-muted-foreground/60 text-muted-foreground/60" />
                                            <span className="min-w-0 truncate font-mono text-small text-foreground" title={pkg.path}>
                                                {pkg.name}
                                            </span>
                                            <span className="shrink-0 text-small text-muted-foreground">
                                                {packageEntryLabel(group.role)}
                                            </span>
                                            <span className="ml-auto shrink-0 text-small tabular-nums text-muted-foreground/70">
                                                {pkg.total_loc.toLocaleString()} loc
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

// The original LOC-ranked file dump, kept intact but demoted to a tab.
function FilesView({
    packages, activePkg, selectedPkg, onSelect, loading, error,
}: {
    packages: RepoPackageEntry[];
    activePkg: RepoPackageEntry | null;
    selectedPkg: string | null;
    onSelect: (name: string) => void;
    loading: boolean;
    error: string | null;
}) {
    return (
        <div className="flex min-h-0 flex-1 overflow-hidden">
            <nav
                className="w-52 shrink-0 overflow-y-auto border-r border-border bg-card text-sm lg:w-64"
                data-testid="repo-tree"
            >
                {loading && <div className="p-4 text-muted-foreground">Scanning packages.</div>}
                {error && <div className="p-4 text-destructive">Failed to read repo summary: {error}</div>}
                {packages.map((pkg) => {
                    const isActive = (activePkg?.name ?? selectedPkg) === pkg.name;
                    return (
                        <button
                            key={pkg.name}
                            type="button"
                            data-testid={`repo-pkg-${pkg.name}`}
                            onClick={() => onSelect(pkg.name)}
                            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-small ${
                                isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                            }`}
                        >
                            <span className="truncate font-medium">{pkg.name}</span>
                            <span className="text-label text-muted-foreground">
                                {pkg.file_count.toLocaleString()} files, {pkg.total_loc.toLocaleString()} loc
                            </span>
                        </button>
                    );
                })}
            </nav>

            <article className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {activePkg ? (
                    <>
                        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 text-sm">
                            <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate font-mono" data-testid="repo-active-pkg" title={activePkg.path}>{activePkg.path}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                {Math.round(activePkg.total_bytes / 1024).toLocaleString()} KB
                            </span>
                        </header>

                        <section className="border-b border-border bg-card px-4 py-2.5 text-xs">
                            <SectionLabel className="mb-1.5">Languages</SectionLabel>
                            <div className="flex flex-wrap gap-2" data-testid="repo-languages">
                                {Object.entries(activePkg.languages)
                                    .sort((a, b) => b[1] - a[1])
                                    .slice(0, 12)
                                    .map(([lang, loc]) => (
                                        <span key={lang} className="rounded-md border border-border bg-secondary px-2 py-0.5 text-label text-foreground">
                                            {sentenceCaseLang(lang)} <span className="tabular-nums text-muted-foreground">{loc.toLocaleString()}</span>
                                        </span>
                                    ))}
                            </div>
                        </section>

                        <section className="flex min-h-0 flex-1 flex-col">
                            <SectionLabel className="bg-card px-4 pb-1 pt-2">Top files by line count</SectionLabel>
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-b border-border bg-card px-4 py-1.5 text-label text-muted-foreground">
                                <span>File</span>
                                <span className="text-right">Language</span>
                                <span className="text-right">Lines</span>
                                <span className="text-right">Size</span>
                            </div>
                            <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto text-xs" data-testid="repo-files">
                                {activePkg.sample_files.length === 0 ? (
                                    <li className="px-4 py-4 text-muted-foreground">
                                        No source files indexed yet. Run a scan to populate.
                                    </li>
                                ) : activePkg.sample_files.slice(0, 30).map((f) => (
                                    <li key={f.path} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-4 py-1.5 hover:bg-secondary/40 transition-colors">
                                        <span className="min-w-0 truncate font-mono text-foreground" title={f.path}>{f.path}</span>
                                        <span className="shrink-0 text-muted-foreground">{sentenceCaseLang(f.language)}</span>
                                        <span className="shrink-0 text-right tabular-nums text-muted-foreground">{f.loc.toLocaleString()}</span>
                                        <span className="shrink-0 text-right tabular-nums text-muted-foreground">{Math.round(f.sizeBytes / 1024)} KB</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </>
                ) : (
                    <div className="p-6 text-sm text-muted-foreground">Pick a package from the list to see its files, languages and top sources.</div>
                )}
            </article>
        </div>
    );
}
