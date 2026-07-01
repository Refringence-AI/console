import { useMemo } from 'react';
import {
    ScanSearch, RefreshCw, FileCode2, GitBranch, Boxes, Plug,
    ScanText, ShieldCheck, FolderGit2, Layers, CheckCircle2,
    AlertTriangle, Info, XCircle, Cpu, Hammer, Database, Bot, Lightbulb,
    Activity, Terminal, Package, GitFork, Users, ListOrdered, Flame, Container, Wrench,
} from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { useProjectProfile, useReprofile, useEnrich } from '../../lib/queries/intel';
import {
    Card, Badge, Button, Stat, StatLabel, StatValue, StatHint,
    SectionLabel, EmptyState, Skeleton,
} from '@/components/ui';
import type {
    ProjectProfile, HealthSignal, DetectedService, LanguageStat,
    ProjectDetail, IntelPackageInfo, ProjectShape,
} from '../../lib/bridge';

function healthTone(score: number): { variant: 'success' | 'warning' | 'danger'; label: string } {
    if (score >= 80) return { variant: 'success', label: 'Healthy' };
    if (score >= 50) return { variant: 'warning', label: 'Needs work' };
    return { variant: 'danger', label: 'At risk' };
}

const SIGNAL_ICON = {
    good: CheckCircle2, info: Info, warn: AlertTriangle, risk: XCircle,
} as const;
const SIGNAL_VARIANT = {
    good: 'success', info: 'info', warn: 'warning', risk: 'danger',
} as const;

function HealthRing({ score }: { score: number }) {
    const tone = healthTone(score);
    const stroke = tone.variant === 'success' ? 'var(--color-success)'
        : tone.variant === 'warning' ? 'var(--color-warning)' : 'var(--color-danger)';
    const r = 26, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    return (
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
            <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
                <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
                <circle cx="32" cy="32" r={r} fill="none" stroke={stroke} strokeWidth="6"
                    strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
            </svg>
            <span className="absolute text-section tabular-nums text-foreground">{score}</span>
        </div>
    );
}

function LanguageBar({ languages }: { languages: LanguageStat[] }) {
    const top = languages.slice(0, 6);
    // Muted, low-chroma categorical ramp (blue / sky / teal / amber / slate),
    // no purple or pink, so the bar stays calm against the neutral chrome.
    const palette = ['#60a5fa', '#38bdf8', '#2dd4bf', '#fbbf24', '#94a3b8', '#64748b'];
    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                {top.map((l, i) => (
                    <div key={l.language} style={{ width: `${Math.max(1, l.share * 100)}%`, background: palette[i % palette.length] }}
                        title={`${l.language} ${(l.share * 100).toFixed(1)}%`} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
                {top.map((l, i) => (
                    <span key={l.language} className="flex items-center gap-1.5 text-small text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: palette[i % palette.length] }} />
                        {l.language} {(l.share * 100).toFixed(0)}%
                    </span>
                ))}
            </div>
        </div>
    );
}

function BadgeList({ items, variant = 'secondary', empty }: { items: string[]; variant?: 'secondary' | 'outline'; empty?: string }) {
    if (items.length === 0) return <span className="text-small text-muted-foreground">{empty ?? 'None detected'}</span>;
    return (
        <div className="flex flex-wrap gap-1.5">
            {items.map((s) => <Badge key={s} variant={variant}>{s}</Badge>)}
        </div>
    );
}

function ServiceCard({ s }: { s: DetectedService }) {
    return (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="flex items-center gap-2">
                <span className="text-body font-medium text-foreground">{s.name}</span>
                <Badge variant={s.confidence === 'high' ? 'success' : 'warning'} className="ml-auto">
                    {s.confidence === 'high' ? 'in use' : 'maybe'}
                </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-label uppercase text-muted-foreground">{s.category}</span>
                {s.powers && <span className="text-small text-muted-foreground">· powers {s.powers}</span>}
            </div>
            <p className="truncate text-small text-muted-foreground" title={s.evidence.join('  ')}>
                {s.evidence.join('  ·  ')}
            </p>
        </div>
    );
}

const PRIORITY_VARIANT = { high: 'danger', medium: 'warning', low: 'info' } as const;
const PKG_KIND_VARIANT = { app: 'info', lib: 'secondary', test: 'warning', tooling: 'outline', docs: 'outline', unknown: 'outline' } as const;

// "How to run" - the #1 newcomer question, answered from the grouped scripts,
// with the AI's run guide when present.
function HowToRunCard({ detail, shape, dense, runGuide }: { detail: ProjectDetail; shape: ProjectShape; dense: boolean; runGuide?: string }) {
    if (detail.commands.length === 0 && !shape.startCommand) return null;
    const GROUPS = [['run', 'Run'], ['build', 'Build'], ['test', 'Test'], ['deploy', 'Deploy']] as const;
    return (
        <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
                <Terminal className="size-4 text-muted-foreground" />
                <SectionLabel>How to run</SectionLabel>
            </div>
            {runGuide
                ? <p className="text-body text-muted-foreground">{runGuide}</p>
                : shape.startCommand && (
                    <p className="text-body text-foreground">
                        Start with <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-small">{shape.startCommand}</code>.
                    </p>
                )}
            {dense && (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {GROUPS.map(([g, label]) => {
                        const all = detail.commands.filter((c) => c.group === g);
                        const cmds = all.slice(0, 3);
                        if (cmds.length === 0) return null;
                        return (
                            <div key={g} className="flex flex-col gap-1">
                                <span className="text-label uppercase text-muted-foreground">{label}</span>
                                {cmds.map((c, i) => (
                                    <code key={i} className="truncate rounded border border-border bg-card px-2 py-1 font-mono text-label text-foreground/85"
                                        title={`${c.pkg !== '.' ? c.pkg + ' › ' : ''}${c.cmd}`}>
                                        {c.pkg !== '.' && <span className="text-muted-foreground">{c.pkg} › </span>}{c.name}
                                    </code>
                                ))}
                                {all.length > 3 && <span className="text-label text-muted-foreground/70">+{all.length - 3} more</span>}
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// Packages list - replaces the implicit "everything is one blob" illegibility.
function PackagesCard({ packages, dense, notes }: { packages: IntelPackageInfo[]; dense: boolean; notes?: { path: string; oneLiner: string }[] }) {
    if (packages.length <= 1) return null;
    const top = packages.slice(0, dense ? 24 : 8);
    const noteFor = (p: string) => notes?.find((n) => n.path === p)?.oneLiner;
    return (
        <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
                <Package className="size-4 text-muted-foreground" />
                <SectionLabel>Packages</SectionLabel>
                <Badge variant="secondary" className="ml-auto">{packages.length}</Badge>
            </div>
            <div className="flex flex-col divide-y divide-border">
                {top.map((p) => (
                    <div key={p.relPath} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                        <Badge variant={PKG_KIND_VARIANT[p.kind]} className="mt-0.5 shrink-0">{p.kind}</Badge>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className="truncate font-mono text-small font-medium text-foreground">{p.name}</span>
                                {dense && p.loc > 0 && <span className="shrink-0 tabular-nums text-label text-muted-foreground">{p.loc.toLocaleString()} LOC</span>}
                            </div>
                            {noteFor(p.relPath)
                                ? <p className="truncate text-small text-muted-foreground" title={noteFor(p.relPath)}>{noteFor(p.relPath)}</p>
                                : p.description
                                    ? <p className="truncate text-small text-muted-foreground" title={p.description}>{p.description}</p>
                                    : <p className="text-small text-muted-foreground/70">{p.role}{p.frameworks.length ? ` · ${p.frameworks.join(', ')}` : ''}</p>}
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function AboutSection({ profile, onEnrich, enriching, enrichError }: {
    profile: ProjectProfile; onEnrich: () => void; enriching: boolean; enrichError: string | null;
}) {
    const ai = profile.ai;
    return (
        <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
                <ScanText className="size-4 text-muted-foreground" />
                <SectionLabel>What this is about</SectionLabel>
                {ai && <Badge variant="secondary" className="ml-auto">read by {ai.model}</Badge>}
            </div>
            {ai ? (
                <>
                    {ai.tagline && <p className="text-body font-medium text-foreground">{ai.tagline}</p>}
                    {ai.narrative && <p className="text-body text-muted-foreground">{ai.narrative}</p>}
                    {ai.changeFirst.length > 0 ? (
                        <div className="mt-1 flex flex-col gap-2">
                            <span className="flex items-center gap-1.5 text-label uppercase text-muted-foreground">
                                <Lightbulb className="size-3" /> What to fix first
                            </span>
                            {ai.changeFirst.map((c, i) => (
                                <div key={i} className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2">
                                    <div className="flex items-baseline gap-2">
                                        <p className="text-small font-medium text-foreground">{c.title}</p>
                                        {c.evidencePath && <span className="shrink-0 truncate font-mono text-label text-muted-foreground" title={c.evidencePath}>{c.evidencePath.split('/').pop()}</span>}
                                    </div>
                                    {c.rationale && <p className="text-small text-muted-foreground">{c.rationale}</p>}
                                </div>
                            ))}
                        </div>
                    ) : ai.suggestions.length > 0 && (
                        <div className="mt-1 flex flex-col gap-2">
                            <span className="flex items-center gap-1.5 text-label uppercase text-muted-foreground">
                                <Lightbulb className="size-3" /> Suggestions
                            </span>
                            {ai.suggestions.map((s, i) => (
                                <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
                                    <Badge variant={PRIORITY_VARIANT[s.priority]} className="mt-0.5 shrink-0">{s.priority}</Badge>
                                    <div className="min-w-0">
                                        <p className="text-small font-medium text-foreground">{s.title}</p>
                                        {s.detail && <p className="text-small text-muted-foreground">{s.detail}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div>
                        <Button variant="ghost" size="sm" onClick={onEnrich} disabled={enriching}>
                            <RefreshCw className={enriching ? 'size-3.5 animate-spin' : 'size-3.5'} />
                            {enriching ? 'Re-reading…' : 'Re-read with AI'}
                        </Button>
                    </div>
                </>
            ) : (
                // No AI yet: do NOT repeat the identity description (the card above
                // already shows it). Just offer the deeper read.
                <>
                    <p className="text-small text-muted-foreground">
                        The summary above comes from the project's own files. Connect an AI provider
                        for a deeper read of what it does, who it is for, a systems map, and suggestions.
                    </p>
                    {enrichError && (
                        <p className="text-small text-warning-text">{enrichError}</p>
                    )}
                    <div>
                        <Button variant="outline" size="sm" onClick={onEnrich} disabled={enriching}>
                            <ScanText className={enriching ? 'size-3.5 animate-pulse' : 'size-3.5'} />
                            {enriching ? 'Reading the project…' : 'Read deeper with AI'}
                        </Button>
                    </div>
                </>
            )}
        </Card>
    );
}

// "Start here" - a deterministic reading order (entry / most-depended / hottest /
// largest), with the AI per-package one-liner when present.
function StartHereCard({ profile }: { profile: ProjectProfile }) {
    const steps = profile.detail.readingOrder;
    if (steps.length === 0) return null;
    const noteFor = (p: string) => profile.ai?.packageNotes.find((n) => n.path === p)?.oneLiner;
    return (
        <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
                <ListOrdered className="size-4 text-muted-foreground" />
                <SectionLabel>Start here</SectionLabel>
            </div>
            <ol className="flex flex-col gap-2">
                {steps.map((s, i) => (
                    <li key={s.path} className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-label tabular-nums text-muted-foreground">{i + 1}</span>
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-2">
                                <span className="truncate font-mono text-small text-foreground">{s.path}</span>
                                <span className="shrink-0 text-label text-muted-foreground">{s.reason}</span>
                            </div>
                            {noteFor(s.path) && <p className="truncate text-small text-muted-foreground" title={noteFor(s.path)}>{noteFor(s.path)}</p>}
                        </div>
                    </li>
                ))}
            </ol>
        </Card>
    );
}

// Operator-only: the deeper build + risk signals in one compact card.
function InfraCard({ profile }: { profile: ProjectProfile }) {
    const { detail, cicd } = profile;
    const hasInfra = detail.hotspots.length > 0 || detail.workflows.length > 0
        || detail.containers.dockerfiles.length > 0 || detail.todoCount > 0;
    if (!hasInfra) return null;
    return (
        <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
                <Wrench className="size-4 text-muted-foreground" />
                <SectionLabel>Build + risk</SectionLabel>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {detail.hotspots.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1 text-label uppercase text-muted-foreground"><Flame className="size-3" />Risk hotspots</span>
                        {detail.hotspots.slice(0, 3).map((h) => (
                            <span key={h.path} className="truncate font-mono text-label text-muted-foreground" title={`${h.loc} LOC, churn ${h.churn}, depended-on ${h.dependedOnBy}`}>
                                {h.path}
                            </span>
                        ))}
                    </div>
                )}
                {cicd.hasCi && detail.workflows.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1 text-label uppercase text-muted-foreground"><GitFork className="size-3" />CI workflows</span>
                        {detail.workflows.slice(0, 3).map((w) => (
                            <span key={w.file} className="truncate text-label text-muted-foreground">
                                {w.file} <span className="text-muted-foreground/70">· {w.jobs.length} job{w.jobs.length === 1 ? '' : 's'}{w.deploys.length ? ` · deploys` : ''}</span>
                            </span>
                        ))}
                    </div>
                )}
                {detail.containers.dockerfiles.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1 text-label uppercase text-muted-foreground"><Container className="size-3" />Containers</span>
                        <BadgeList items={dedupeStr(detail.containers.dockerfiles.flatMap((d) => d.baseImages))} />
                    </div>
                )}
                <div className="flex flex-col gap-1.5">
                    <span className="text-label uppercase text-muted-foreground">Markers</span>
                    <span className="text-small text-muted-foreground">
                        {detail.todoCount} TODO/FIXME{detail.release.tagCount > 0 ? ` · ${detail.release.tagCount} tags` : ''}{detail.release.hasChangelog ? ' · CHANGELOG' : ''}
                    </span>
                </div>
            </div>
        </Card>
    );
}

const dedupeStr = (a: string[]): string[] => Array.from(new Set(a)).slice(0, 6);

function ReportBody({ profile, mode, onReprofile, reprofiling, onEnrich, enriching, enrichError }: {
    profile: ProjectProfile; mode: 'guided' | 'operator';
    onReprofile: () => void; reprofiling: boolean;
    onEnrich: () => void; enriching: boolean; enrichError: string | null;
}) {
    const { identity, stack, metrics, services, aiTooling, cicd, inventory, git, health, readme, packages, detail } = profile;
    const tone = healthTone(health.score);
    const dense = mode === 'operator';
    const aboutText = readme.description || identity.description;

    const statTiles = [
        { label: 'Files', icon: FileCode2, value: metrics.fileCount.toLocaleString(), hint: metrics.sizeLabel },
        { label: 'Lines of code', icon: Layers, value: metrics.totalLoc.toLocaleString(), hint: stack.primaryLanguage },
        { label: 'Packages', icon: Boxes, value: String(profile.shape.packageCount || packages.length || 1), hint: profile.shape.isMonorepo ? 'monorepo' : 'single package' },
        { label: 'Commits', icon: GitBranch, value: git.isRepo ? git.commitCount.toLocaleString() : 'n/a', hint: git.isRepo ? `${git.contributors} contributor${git.contributors === 1 ? '' : 's'}` : 'not a git repo' },
    ];

    // Guided helpers: one plain sentence for the stack + only the health signals
    // that actually need attention, so the Guided surface reads as one calm story
    // instead of the Operator cockpit.
    const builtWith = [...new Set([...stack.frontend, ...stack.backend, ...stack.buildTools])];
    const stackSentence = [
        `${stack.primaryLanguage}.`,
        builtWith.length ? `Built with ${builtWith.join(', ')}.` : '',
        stack.runtimes.length ? `Runs on ${stack.runtimes.join(' and ')}.` : '',
    ].filter(Boolean).join(' ');
    const healthIssues = health.signals.filter((s) => s.severity !== 'good');

    return (
        <div className="flex flex-col gap-5 p-6">
            {/* Identity + health */}
            <Card className="flex items-start gap-4 p-5">
                <HealthRing score={health.score} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-page-title text-foreground">{identity.title}</h2>
                        <Badge variant={tone.variant}>{tone.label}</Badge>
                        {profile.shape.projectType !== 'Unknown' && (
                            <Badge variant="outline">{profile.shape.projectType}</Badge>
                        )}
                    </div>
                    {aboutText && <p className="mt-1.5 text-body text-muted-foreground">{aboutText}</p>}
                    {stack.notableFrameworks.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {stack.notableFrameworks.slice(0, 6).map((f) => (
                                <Badge key={f.name} variant="secondary">{f.name} {f.version.split('.')[0]}</Badge>
                            ))}
                        </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small text-muted-foreground">
                        {identity.license && <span className="flex items-center gap-1"><ShieldCheck className="size-3.5" />{identity.license}</span>}
                        {git.branch && <span className="flex items-center gap-1"><GitBranch className="size-3.5" />{git.branch}</span>}
                        {git.isRepo && git.activity !== 'unknown' && (
                            <span className="flex items-center gap-1">
                                <Activity className="size-3.5" />{git.activity}{git.cadencePerWeek > 0 ? ` · ~${git.cadencePerWeek}/wk` : ''}
                            </span>
                        )}
                        <span className="flex items-center gap-1"><FolderGit2 className="size-3.5" />{metrics.sizeLabel}</span>
                    </div>
                </div>
            </Card>

            {/* What this is about (AI enrichment) */}
            <AboutSection profile={profile} onEnrich={onEnrich} enriching={enriching} enrichError={enrichError} />

            {/* How to run + Packages + Start here - both personas (newcomer's first questions). */}
            <HowToRunCard detail={profile.detail} shape={profile.shape} dense={dense} runGuide={profile.ai?.runGuide} />
            <PackagesCard packages={packages} dense={dense} notes={profile.ai?.packageNotes} />
            <StartHereCard profile={profile} />

            {dense ? (
                <>
                    {/* Operator: the dense cockpit. */}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {statTiles.map((t) => (
                            <Card key={t.label} className="p-4">
                                <Stat>
                                    <StatLabel icon={t.icon}>{t.label}</StatLabel>
                                    <StatValue>{t.value}</StatValue>
                                    <StatHint>{t.hint}</StatHint>
                                </Stat>
                            </Card>
                        ))}
                    </div>

                    <Card className="flex flex-col gap-4 p-5">
                        <SectionLabel>Tech stack</SectionLabel>
                        <LanguageBar languages={stack.languages} />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-label uppercase text-muted-foreground">Frontend</span>
                                <BadgeList items={stack.frontend} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="text-label uppercase text-muted-foreground">Backend</span>
                                <BadgeList items={stack.backend} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="flex items-center gap-1 text-label uppercase text-muted-foreground"><Cpu className="size-3" />Runtimes</span>
                                <BadgeList items={stack.runtimes} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="flex items-center gap-1 text-label uppercase text-muted-foreground"><Hammer className="size-3" />Build tools</span>
                                <BadgeList items={stack.buildTools} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="flex items-center gap-1 text-label uppercase text-muted-foreground"><Database className="size-3" />Package manager</span>
                                <BadgeList items={stack.packageManager ? [stack.packageManager] : []} />
                            </div>
                        </div>
                        {(detail.dataLayer.orm.length > 0 || detail.dataLayer.engines.length > 0 || detail.apiStyle.length > 0 || detail.testing.frameworks.length > 0) && (
                            <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
                                {(detail.dataLayer.orm.length > 0 || detail.dataLayer.engines.length > 0) && (
                                    <div className="flex flex-col gap-1.5">
                                        <span className="flex items-center gap-1 text-label uppercase text-muted-foreground"><Database className="size-3" />Data layer</span>
                                        <BadgeList items={[...detail.dataLayer.orm, ...detail.dataLayer.engines]} />
                                    </div>
                                )}
                                {detail.apiStyle.length > 0 && (
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-label uppercase text-muted-foreground">API style</span>
                                        <BadgeList items={detail.apiStyle} />
                                    </div>
                                )}
                                {detail.testing.frameworks.length > 0 && (
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-label uppercase text-muted-foreground">Testing + quality</span>
                                        <BadgeList items={[...detail.testing.frameworks, ...detail.testing.linters, ...detail.testing.formatters, ...detail.testing.typecheck]} />
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>

                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <Card className="flex flex-col gap-3 p-5">
                            <div className="flex items-center gap-2">
                                <Plug className="size-4 text-muted-foreground" />
                                <SectionLabel>Services wired</SectionLabel>
                                <Badge variant="secondary" className="ml-auto">{services.length}</Badge>
                            </div>
                            {services.length === 0 ? (
                                <p className="text-small text-muted-foreground">
                                    No external services detected. This looks like a services-light project.
                                </p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {services.map((s) => <ServiceCard key={s.id} s={s} />)}
                                </div>
                            )}
                        </Card>

                        <Card className="flex flex-col gap-3 p-5">
                            <div className="flex items-center gap-2">
                                <Bot className="size-4 text-muted-foreground" />
                                <SectionLabel>AI tooling</SectionLabel>
                            </div>
                            <div className="flex flex-col gap-2.5">
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-label uppercase text-muted-foreground">MCP servers</span>
                                    <BadgeList items={aiTooling.mcpServers} empty="No .mcp.json" />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-label uppercase text-muted-foreground">AI SDKs</span>
                                    <BadgeList items={aiTooling.aiSdks} empty="None" />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-label uppercase text-muted-foreground">Eval frameworks</span>
                                    <BadgeList items={aiTooling.evalFrameworks} empty="None" />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-label uppercase text-muted-foreground">Agent configs</span>
                                    <BadgeList items={aiTooling.agentConfigs} empty="None" />
                                </div>
                            </div>
                        </Card>
                    </div>

                    <Card className="flex flex-col gap-3 p-5">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="size-4 text-muted-foreground" />
                            <SectionLabel>Project health</SectionLabel>
                            <span className="ml-auto text-small text-muted-foreground">
                                {cicd.hasCi ? cicd.provider : 'no CI'} · {inventory.docsCount} docs · {readme.present ? `README (${readme.sections.length} sections)` : 'no README'}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {health.signals.map((sig: HealthSignal) => {
                                const Icon = SIGNAL_ICON[sig.severity];
                                return (
                                    <div key={sig.id} className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
                                        <Badge variant={SIGNAL_VARIANT[sig.severity]} className="mt-0.5 shrink-0">
                                            <Icon className="size-3" />
                                        </Badge>
                                        <div className="min-w-0">
                                            <p className="text-small font-medium text-foreground">{sig.label}</p>
                                            <p className="text-small text-muted-foreground">{sig.detail}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>

                    <InfraCard profile={profile} />
                </>
            ) : (
                <>
                    {/* Guided: one calm story, not a cockpit. A compact at-a-glance
                        strip, a plain "built with" sentence, services as a line, and
                        only the health checks that need attention. */}
                    <Card className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 sm:grid-cols-4">
                        {statTiles.map((t) => (
                            <div key={t.label} className="flex flex-col gap-0.5">
                                <span className="flex items-center gap-1.5 text-label uppercase text-muted-foreground">
                                    <t.icon className="size-3" />{t.label}
                                </span>
                                <span className="text-section tabular-nums text-foreground">{t.value}</span>
                                <span className="text-small text-muted-foreground">{t.hint}</span>
                            </div>
                        ))}
                    </Card>

                    <Card className="flex flex-col gap-3 p-5">
                        <SectionLabel>Built with</SectionLabel>
                        <p className="text-body text-foreground">{stackSentence}</p>
                        <LanguageBar languages={stack.languages} />
                    </Card>

                    <Card className="flex flex-col gap-2 p-5">
                        <div className="flex items-center gap-2">
                            <Plug className="size-4 text-muted-foreground" />
                            <SectionLabel>Services</SectionLabel>
                            <Badge variant="secondary" className="ml-auto">{services.length}</Badge>
                        </div>
                        <p className="text-body text-muted-foreground">
                            {services.length === 0
                                ? 'No external services detected yet. You can connect them from the Services panel.'
                                : services.map((s) => s.name).join(', ') + '.'}
                        </p>
                    </Card>

                    <Card className="flex flex-col gap-2 p-5">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="size-4 text-muted-foreground" />
                            <SectionLabel>Health</SectionLabel>
                            <Badge variant={tone.variant} className="ml-auto">{health.score}/100 · {tone.label}</Badge>
                        </div>
                        {healthIssues.length === 0 ? (
                            <p className="text-body text-muted-foreground">Every basic check passes. Nice.</p>
                        ) : (
                            <ul className="flex flex-col gap-1.5">
                                {healthIssues.map((sig) => (
                                    <li key={sig.id} className="flex items-start gap-2 text-body text-muted-foreground">
                                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
                                        <span>{sig.detail}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                </>
            )}

            <div className="flex items-center justify-between">
                <span className="text-small text-muted-foreground">
                    Read {profile.metrics.fileCount.toLocaleString()} files in {profile.durationMs} ms, all from the project itself.
                </span>
                <Button variant="outline" size="sm" onClick={onReprofile} disabled={reprofiling}>
                    <RefreshCw className={reprofiling ? 'size-3.5 animate-spin' : 'size-3.5'} />
                    Re-study
                </Button>
            </div>
        </div>
    );
}

export function ProjectReport() {
    const { project } = useActiveProject();
    const { isNewbie } = usePersonaMode();
    const projectRoot = project?.path ?? '';
    const profileQuery = useProjectProfile(projectRoot);
    const reprofile = useReprofile(projectRoot);
    const enrich = useEnrich(projectRoot);
    const enrichError = enrich.data && !enrich.data.ok ? (enrich.data.error ?? 'AI enrichment failed') : null;

    const subtitle = useMemo(() => {
        const p = profileQuery.data;
        if (!p) return 'A deep read of the project you have open';
        const svc = `${p.services.length} service${p.services.length === 1 ? '' : 's'}`;
        return `${p.stack.primaryLanguage} · ${p.metrics.totalLoc.toLocaleString()} LOC · ${svc}`;
    }, [profileQuery.data]);

    return (
        <div className="flex h-full flex-col">
            <PanelHeader icon={ScanSearch} title="Project report" subtitle={subtitle} testid="panel-report" />
            <div className="min-h-0 flex-1 overflow-y-auto">
                {!projectRoot ? (
                    <div className="p-6">
                        <EmptyState icon={FolderGit2} title="No project open">
                            Pick a project folder to study it. Console reads its languages, stack,
                            services, and health directly from the files.
                        </EmptyState>
                    </div>
                ) : profileQuery.isLoading ? (
                    <div className="flex flex-col gap-5 p-6">
                        <Skeleton className="h-28 w-full rounded-xl" />
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                        </div>
                        <Skeleton className="h-40 w-full rounded-xl" />
                        <p className="text-center text-small text-muted-foreground">Studying the project…</p>
                    </div>
                ) : !profileQuery.data ? (
                    <div className="p-6">
                        <EmptyState icon={ScanSearch} title="Could not study this project"
                            action={<Button variant="outline" size="sm" onClick={() => profileQuery.refetch()}>Try again</Button>}>
                            Console could not read this folder. Make sure it is a project directory.
                        </EmptyState>
                    </div>
                ) : (
                    <ReportBody
                        profile={profileQuery.data}
                        mode={isNewbie ? 'guided' : 'operator'}
                        onReprofile={() => reprofile.mutate()}
                        reprofiling={reprofile.isPending}
                        onEnrich={() => enrich.mutate()}
                        enriching={enrich.isPending}
                        enrichError={enrichError}
                    />
                )}
            </div>
        </div>
    );
}
