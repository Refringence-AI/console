import { ArrowRight } from 'lucide-react';
import { useRepoSummary } from '../../lib/queries/repo';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { Card } from '../../components/ui';
import { ArchitectureGraph } from './ArchitectureGraph';

/**
 * Newbie-mode Architecture.
 *
 * Single column, plain-English. Drops the dependency graph and LOC
 * counts; groups packages into Shell, UI, and Data buckets with a
 * one-sentence role each.
 */

type RoleId = 'shell' | 'ui' | 'data' | 'tools' | 'workspace';

interface RoleEntry {
    pkgName: string;
    prettyName: string;
    role: RoleId;
    explainer: string;
}

const ROLE_RULES: Array<{ match: (name: string) => boolean; entry: Omit<RoleEntry, 'pkgName'> }> = [
    {
        match: (n) => n === 'console-electron' || /(^|[-/])(electron|desktop|tauri)([-/]|$)/.test(n),
        entry: { prettyName: '', role: 'shell', explainer: 'A desktop shell that hosts the app.' },
    },
    {
        match: (n) => n === 'console-shell' || n.endsWith('design-tokens') || /(^|[-/])(ui|web|shell|client|frontend|renderer)([-/]|$)/.test(n),
        entry: { prettyName: '', role: 'ui', explainer: 'Part of the user interface you see on screen.' },
    },
    {
        match: (n) => /(^|[-/])(api|server|backend|core|data|db|lib|worker|service)([-/]|$)/.test(n),
        entry: { prettyName: '', role: 'data', explainer: 'Backend or shared logic the UI reads from.' },
    },
];

function classify(pkgName: string): RoleEntry | null {
    for (const rule of ROLE_RULES) {
        if (rule.match(pkgName)) {
            const prettyName = rule.entry.prettyName || prettyDefault(pkgName);
            return { ...rule.entry, prettyName, pkgName };
        }
    }
    return null;
}

function prettyDefault(name: string): string {
    const short = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
    const spaced = short.replace(/[-_]/g, ' ').trim();
    if (!spaced) return name;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const ROLE_LABEL: Record<RoleId, string> = {
    shell: 'Shell',
    ui: 'UI',
    data: 'Data',
    tools: 'Tools',
    workspace: 'Workspace',
};

const ROLE_LEAD: Record<RoleId, string> = {
    shell: 'The desktop containers that run the app.',
    ui: 'The screens and design language you see.',
    data: 'The tools that feed information into the UI.',
    tools: 'How the assistant reaches the bundled tools.',
    workspace: 'The files that live alongside the code.',
};

const ROLE_ORDER: RoleId[] = ['shell', 'ui', 'data', 'tools', 'workspace'];

const STATIC_WORKSPACE: RoleEntry[] = [
    {
        pkgName: 'docs',
        prettyName: 'Docs',
        role: 'workspace',
        explainer: 'Project documentation and design notes.',
    },
    {
        pkgName: 'scripts',
        prettyName: 'Scripts',
        role: 'workspace',
        explainer: 'Build, capture, and lint helpers.',
    },
];

export function ArchitectureNewbie() {
    const repo = useRepoSummary();
    const { project } = useActiveProject();
    const projectRoot = project?.path ?? '';
    const { setPersona } = usePersonaMode();

    const grouped: Record<RoleId, RoleEntry[]> = {
        shell: [], ui: [], data: [], tools: [], workspace: [...STATIC_WORKSPACE],
    };
    for (const pkg of repo.data?.packages ?? []) {
        const entry = classify(pkg.name);
        if (entry) grouped[entry.role].push(entry);
    }

    return (
        <div className="flex h-full flex-col overflow-y-auto px-8 py-10" data-testid="arch-newbie">
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-10">

                <header className="flex flex-col gap-3">
                    <h1 className="text-page-title text-foreground">
                        Architecture
                    </h1>
                    <p className="text-body leading-6 text-muted-foreground">
                        How the pieces of Console fit together.
                    </p>
                </header>

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

                {projectRoot && (
                    <section className="flex flex-col gap-3" data-testid="arch-newbie-graph">
                        <h2 className="text-section text-foreground">The dependency map</h2>
                        <p className="text-body leading-6 text-muted-foreground">
                            Each card is a package. Click one to see what it depends on
                            and what depends on it.
                        </p>
                        <ArchitectureGraph root={projectRoot} mode="guided" />
                    </section>
                )}

                {ROLE_ORDER.map((role) => {
                    const entries = grouped[role];
                    if (entries.length === 0) return null;
                    return (
                        <section key={role} className="flex flex-col gap-4" data-testid={`arch-newbie-${role}`}>
                            <div className="flex flex-col gap-1">
                                <h2 className="text-section text-foreground">
                                    {ROLE_LABEL[role]}
                                </h2>
                                <p className="text-body leading-6 text-muted-foreground">
                                    {ROLE_LEAD[role]}
                                </p>
                            </div>
                            <ul className="flex flex-col gap-3">
                                {entries.map((entry) => (
                                    <li
                                        key={entry.pkgName}
                                        data-testid={`arch-newbie-pkg-${entry.pkgName}`}
                                    >
                                        <Card className="gap-1.5 p-5 shadow-none">
                                            <span className="text-card-title text-foreground">
                                                {entry.prettyName}
                                            </span>
                                            <p className="text-body leading-6 text-muted-foreground">
                                                {entry.explainer}
                                            </p>
                                        </Card>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    );
                })}

                <Card
                    data-testid="arch-newbie-full-map"
                    className="gap-4 p-5"
                >
                    <h2 className="text-section text-foreground">
                        Want the full map?
                    </h2>
                    <p className="text-body leading-6 text-muted-foreground">
                        Switch to the Operator view for the package graph, lines of code, and dependency arrows.
                    </p>
                    <button
                        type="button"
                        onClick={() => setPersona('seasoned')}
                        className="group inline-flex w-fit items-center gap-1.5 text-small font-medium text-foreground"
                    >
                        Open full architecture
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </button>
                </Card>

            </div>
        </div>
    );
}
