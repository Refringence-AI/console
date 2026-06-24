import { useState } from 'react';
import { Check, ChevronDown, Code2, Copy, Play } from 'lucide-react';
import { useRepoSummary } from '../../lib/queries/repo';
import { useActiveProject } from '../../lib/activeProject';
import { useProjectSummary } from '../../lib/queries/repoIntrospect';
import { useProjectShape } from '../../lib/queries/project';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { Card, SectionLabel } from '../../components/ui';
import {
    describeShape, inferPackageRole, prettyPackageLabel,
    ROLE_META, ROLE_ORDER, type PackageRole,
} from '../../lib/projectShape';
import type { RepoPackageEntry } from '../../lib/bridge';

/**
 * Newbie-mode Repo.
 *
 * A calm "here's how this project is laid out and how to run it"
 * narrative driven by the real inferred shape: a plain-English lede, the
 * start command up front, packages grouped by their inferred role (no
 * hardcoded explainers), and the raw dev scripts tucked behind a
 * disclosure. Honest empty state when no project is open.
 */
export function RepoNewbie() {
    const repo = useRepoSummary();
    const { project } = useActiveProject();
    const { setPersona } = usePersonaMode();
    const projectRoot = project?.path ?? repo.data?.repo_root ?? '';
    const summary = useProjectSummary(projectRoot);
    const shape = useProjectShape(projectRoot);
    const [showCommands, setShowCommands] = useState(false);

    const packages = repo.data?.packages ?? [];
    const groups = groupByRole(packages);
    const runCommands = summary.data?.runCommands ?? [];

    const lede = shape.data
        ? describeShape(shape.data, repo.data?.total_loc)
        : 'Reading the project.';

    const noProject = !projectRoot;

    return (
        <div className="flex h-full flex-col overflow-y-auto px-8 py-10" data-testid="repo-newbie">
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-10">

                <header className="flex flex-col gap-3">
                    <h1 className="text-display text-foreground">
                        Repo
                    </h1>
                    <p className="text-body leading-6 text-muted-foreground">
                        {noProject
                            ? 'No project open yet. Pick a folder from the top bar and this fills in: what the project is, how to run it, and how it is laid out.'
                            : lede}
                    </p>
                </header>

                {!noProject && shape.data?.runnable && shape.data.startCommand && (
                    <section className="flex flex-col gap-2" data-testid="repo-newbie-run">
                        <SectionLabel>How to run it</SectionLabel>
                        <Card className="flex-row items-center gap-3 p-5">
                            <Play className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            <code className="font-mono text-small text-foreground">{shape.data.startCommand}</code>
                            <span className="ml-auto text-small text-muted-foreground">
                                run this from the project folder
                            </span>
                            <CopyCommandButton command={shape.data.startCommand} testid="repo-newbie-run-copy" />
                        </Card>
                    </section>
                )}

                <section className="flex flex-col gap-4" data-testid="repo-newbie-packages">
                    <div className="flex flex-col gap-1">
                        <SectionLabel>How it is laid out</SectionLabel>
                        <p className="text-body leading-6 text-muted-foreground">
                            The pieces of the project, grouped by what each one does.
                        </p>
                    </div>

                    {repo.isLoading && (
                        <Card className="gap-4 p-5 text-body text-muted-foreground">
                            Looking through the project.
                        </Card>
                    )}

                    {repo.isError && (
                        <Card className="gap-4 p-5 text-body text-foreground">
                            Could not read the project. Try picking the folder again from the top bar.
                        </Card>
                    )}

                    {!repo.isLoading && !repo.isError && groups.length === 0 && (
                        <Card className="gap-4 p-5 text-body text-muted-foreground">
                            No packages detected yet. Pick a folder from the top bar to start.
                        </Card>
                    )}

                    <div className="flex flex-col gap-5">
                        {groups.map((group) => (
                            <div key={group.role} className="flex flex-col gap-2" data-testid={`repo-newbie-role-${group.role}`}>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-card-title text-foreground">{ROLE_META[group.role].label}</span>
                                    <span className="text-small text-muted-foreground">{ROLE_META[group.role].blurb}</span>
                                </div>
                                <Card className="gap-0 p-0">
                                    <ul className="divide-y divide-border/60">
                                        {group.packages.map((pkg) => (
                                            <li
                                                key={pkg.name}
                                                data-testid={`repo-newbie-pkg-${pkg.name}`}
                                                className="flex items-center gap-3 px-5 py-3"
                                            >
                                                <span className="min-w-0 flex-1 truncate text-body text-foreground" title={pkg.path}>
                                                    {prettyPackageLabel(pkg.name)}
                                                </span>
                                                <span className="shrink-0 truncate font-mono text-label text-muted-foreground" title={pkg.name}>
                                                    {pkg.name}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </Card>
                            </div>
                        ))}
                    </div>
                </section>

                {!noProject && (
                    <section data-testid="repo-newbie-next" className="flex flex-col gap-3">
                        <button
                            type="button"
                            data-testid="repo-newbie-see-full"
                            onClick={() => setPersona('seasoned')}
                            className="group inline-flex w-fit items-center gap-1.5 text-small font-medium text-foreground"
                        >
                            See the full code map
                        </button>
                    </section>
                )}

                <Card
                    data-testid="repo-newbie-dev-disclosure"
                    className="gap-0 p-0"
                >
                    <button
                        type="button"
                        onClick={() => setShowCommands((v) => !v)}
                        aria-expanded={showCommands}
                        data-testid="repo-newbie-dev-toggle"
                        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                    >
                        <span className="flex items-center gap-2.5">
                            <Code2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                            <span className="text-card-title text-foreground">
                                Show developer commands
                            </span>
                        </span>
                        <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showCommands ? 'rotate-180' : ''}`}
                            aria-hidden
                        />
                    </button>
                    {showCommands && (
                        <div className="border-t border-border px-5 py-4" data-testid="repo-newbie-dev-body">
                            <p className="mb-3 text-small leading-6 text-muted-foreground">
                                These are the scripts the maintainers run from a terminal in the project root.
                            </p>
                            {summary.isLoading && (
                                <div className="text-small text-muted-foreground">Reading project metadata.</div>
                            )}
                            {summary.isError && (
                                <div className="text-small text-muted-foreground">
                                    Could not find package.json, pyproject.toml, or Cargo.toml.
                                </div>
                            )}
                            {summary.data && runCommands.length === 0 && (
                                <div className="text-small text-muted-foreground">
                                    No run commands declared in this project.
                                </div>
                            )}
                            {runCommands.length > 0 && (
                                <ul className="flex flex-col gap-1.5" data-testid="repo-newbie-dev-commands">
                                    {runCommands.map((cmd) => (
                                        <li key={cmd} className="flex items-center gap-2">
                                            <code className="block min-w-0 flex-1 truncate rounded-md bg-secondary px-2.5 py-1.5 font-mono text-small text-foreground">
                                                {cmd}
                                            </code>
                                            <CopyCommandButton command={cmd} testid={`repo-newbie-dev-copy-${cmd}`} />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </Card>

            </div>
        </div>
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

/**
 * Copy-to-clipboard affordance for a single command. The orientation
 * surface shows commands but cannot run a shell, so copy is the action
 * that makes them usable. Shows a brief check on success.
 */
function CopyCommandButton({ command, testid }: { command: string; testid: string }) {
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
            {copied
                ? <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
    );
}
