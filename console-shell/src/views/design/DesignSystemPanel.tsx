import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Palette, RefreshCw, Save, Trash2, GitCompareArrows } from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { Badge, Card, EmptyState, Button } from '@/components/ui';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { bridge, type DesignSystem, type DesignProfile, type ProfileDiff, type TypeStep } from '../../lib/bridge';

/**
 * Design-system panel. Reads (deterministically) the project's Tailwind / shadcn
 * / CSS-token design language and renders it: palette swatches (drawn from the
 * authored colour values, so oklch renders natively), the type scale, spacing +
 * radii, and the component libraries. The current design can be saved as a
 * cross-project profile and two saved profiles compared.
 */
export function DesignSystemPanel() {
    const { project } = useActiveProject();
    const root = project?.path ?? null;
    const projectName = project?.path ? project.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'project' : 'project';
    const { isNewbie } = usePersonaMode();
    const qc = useQueryClient();

    const q = useQuery({
        queryKey: ['design-system', root],
        queryFn: () => bridge.designSystem.scan(root ?? ''),
        enabled: !!root,
        staleTime: 60_000,
    });
    const profiles = useQuery({ queryKey: ['design-profiles'], queryFn: () => bridge.designSystem.listProfiles(), staleTime: 30_000 });

    async function saveProfile() {
        if (!root) return;
        try {
            const r = await bridge.designSystem.saveProfile(root, projectName);
            if (r.ok) {
                toast.success(`Saved profile "${r.profile?.label}"`);
                void qc.invalidateQueries({ queryKey: ['design-profiles'] });
            } else {
                toast.error(r.error ?? 'Could not save the profile');
            }
        } catch (e) {
            toast.error(String(e));
        }
    }

    if (!root) {
        return (
            <div className="flex h-full flex-col" data-testid="design-system-panel">
                <PanelHeader icon={Palette} title="Design system" subtitle="Your palette, type, and tokens" />
                <div className="flex flex-1 items-center justify-center p-8">
                    <EmptyState icon={Palette} title="Pick a project first">
                        Choose an active project to read its design system.
                    </EmptyState>
                </div>
            </div>
        );
    }

    const ds = q.data;

    return (
        <div className="flex h-full flex-col" data-testid="design-system-panel">
            <PanelHeader
                icon={Palette}
                title="Design system"
                subtitle={ds?.tailwind ? `Tailwind v${ds.tailwind.version}${ds.shadcn ? ` · shadcn ${ds.shadcn.style}` : ''}` : 'Your palette, type, and tokens'}
            >
                <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()} className="gap-1.5" data-testid="design-rescan">
                    <RefreshCw className="h-3.5 w-3.5" /> Rescan
                </Button>
                <Button type="button" size="sm" onClick={saveProfile} className="gap-1.5" data-testid="design-save-profile">
                    <Save className="h-3.5 w-3.5" /> Save profile
                </Button>
            </PanelHeader>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                    {isNewbie && (
                        <Card className="gap-0 bg-secondary/30 p-3.5">
                            <p className="text-small leading-relaxed text-muted-foreground">
                                This reads the colours, fonts, and spacing your project is built from and
                                shows them together, so you can see your design at a glance. You can save it
                                as a profile and compare it with another project later.
                            </p>
                        </Card>
                    )}

                    {q.isLoading && [0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-secondary/30" />)}

                    {ds && ds.tokens.colors.length === 0 && !q.isLoading && (
                        <EmptyState icon={Palette} title="No design tokens found">
                            Console looked for a Tailwind config, a shadcn components.json, and CSS token
                            blocks but did not find a design system to read in this project.
                        </EmptyState>
                    )}

                    {ds && ds.tokens.colors.length > 0 && (
                        <>
                            <Section title="Palette" count={ds.tokens.colors.length}>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                    {ds.tokens.colors.slice(0, 64).map((c, i) => (
                                        <div key={`${c.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2" title={c.value}>
                                            <span className="h-7 w-7 shrink-0 rounded-md border border-border" style={{ background: c.resolved === false ? 'transparent' : c.value }} />
                                            <span className="flex min-w-0 flex-col">
                                                <span className="truncate text-label text-foreground">{c.name}</span>
                                                <span className="truncate font-mono text-label text-muted-foreground">{c.value}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </Section>

                            {ds.tokens.fonts.length > 0 && (
                                <Section title="Fonts" count={ds.tokens.fonts.length}>
                                    <div className="flex flex-col gap-1.5">
                                        {ds.tokens.fonts.map((f) => (
                                            <div key={f.name} className="flex items-baseline gap-3 rounded-lg border border-border bg-card px-3 py-2">
                                                <span className="w-16 shrink-0 text-label text-muted-foreground">{f.name}</span>
                                                <span className="truncate text-body text-foreground" style={{ fontFamily: f.value }}>{f.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {ds.tokens.typeScale.length > 0 && (
                                <Section title="Type scale" count={ds.tokens.typeScale.length}>
                                    <div className="flex flex-col gap-1">
                                        {ds.tokens.typeScale.map((t) => <TypeRow key={t.name} step={t} />)}
                                    </div>
                                </Section>
                            )}

                            {(ds.tokens.spacing.length > 0 || ds.tokens.radii.length > 0) && (
                                <Section title="Spacing + radii" count={ds.tokens.spacing.length + ds.tokens.radii.length}>
                                    <div className="flex flex-col gap-3">
                                        {ds.tokens.radii.length > 0 && (
                                            <div className="flex flex-wrap items-end gap-3">
                                                {ds.tokens.radii.map((r) => (
                                                    <div key={r.name} className="flex flex-col items-center gap-1">
                                                        <span className="h-10 w-10 border border-accent bg-accent-subtle" style={{ borderRadius: r.value }} />
                                                        <span className="text-label text-muted-foreground">{r.name}</span>
                                                        <span className="font-mono text-label text-muted-foreground">{r.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {ds.tokens.spacing.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {ds.tokens.spacing.map((s) => (
                                                    <Badge key={s.name} variant="outline" className="rounded-sm font-mono text-label text-muted-foreground">{s.name}: {s.value}</Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </Section>
                            )}

                            <Section title="Libraries" count={ds.libraryDetails.length}>
                                <div className="flex flex-wrap gap-1.5">
                                    {ds.libraryDetails.map((l) => (
                                        <Badge key={l.id} variant="secondary" className="rounded-md">
                                            {l.label}{l.version ? <span className="ml-1 text-muted-foreground/70">{l.version}</span> : null}
                                        </Badge>
                                    ))}
                                </div>
                            </Section>

                            <Section title="Detected from" count={ds.sources.length}>
                                <div className="flex flex-col gap-0.5">
                                    {ds.sources.map((s) => <code key={s} className="font-mono text-label text-muted-foreground">{s}</code>)}
                                </div>
                            </Section>
                        </>
                    )}

                    {(profiles.data?.length ?? 0) >= 2 && <CompareSection profiles={profiles.data ?? []} />}

                    {(profiles.data?.length ?? 0) > 0 && (
                        <Section title="Saved profiles" count={profiles.data?.length ?? 0}>
                            <div className="flex flex-col gap-1.5">
                                {profiles.data?.map((p) => (
                                    <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-small text-foreground">{p.label}</span>
                                            <span className="truncate text-label text-muted-foreground">{p.summary.colorCount} colors · {p.summary.typeStepCount} type steps · {p.libraries.length} libs</span>
                                        </span>
                                        <Button type="button" variant="ghost" size="sm" title="Delete profile" aria-label="Delete design profile" onClick={async () => {
                                            await bridge.designSystem.deleteProfile(p.id);
                                            void qc.invalidateQueries({ queryKey: ['design-profiles'] });
                                        }}>
                                            <Trash2 className="h-3 w-3 text-danger" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}
                </div>
            </div>
        </div>
    );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-card-title text-foreground">
                {title}
                {count != null && <span className="text-small text-muted-foreground">({count})</span>}
            </span>
            {children}
        </div>
    );
}

function TypeRow({ step }: { step: TypeStep }) {
    return (
        <div className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
            <span
                className="truncate text-foreground"
                style={{ fontSize: step.fontSize, lineHeight: step.lineHeight, letterSpacing: step.letterSpacing, fontWeight: step.fontWeight as React.CSSProperties['fontWeight'] }}
            >
                {step.name}
            </span>
            <span className="shrink-0 font-mono text-label text-muted-foreground">
                {step.fontSize}{step.lineHeight ? ` / ${step.lineHeight}` : ''}{step.fontWeight ? ` · ${step.fontWeight}` : ''}
            </span>
        </div>
    );
}

function CompareSection({ profiles }: { profiles: DesignProfile[] }) {
    const [a, setA] = useState(profiles[0]?.id ?? '');
    const [b, setB] = useState(profiles[1]?.id ?? '');
    const diff = useQuery({
        queryKey: ['design-compare', a, b],
        queryFn: () => bridge.designSystem.compareProfiles(a, b),
        enabled: !!a && !!b && a !== b,
        staleTime: 30_000,
    });
    return (
        <Section title="Compare profiles">
            <div className="flex flex-wrap items-center gap-2">
                <ProfileSelect value={a} onChange={setA} profiles={profiles} />
                <GitCompareArrows className="h-3.5 w-3.5 text-muted-foreground" />
                <ProfileSelect value={b} onChange={setB} profiles={profiles} />
            </div>
            {a === b && <p className="text-small text-muted-foreground">Pick two different profiles to compare.</p>}
            {diff.data && <DiffView diff={diff.data} />}
        </Section>
    );
}

function ProfileSelect({ value, onChange, profiles }: { value: string; onChange: (v: string) => void; profiles: DesignProfile[] }) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Profile" /></SelectTrigger>
            <SelectContent>
                {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
        </Select>
    );
}

function DiffView({ diff }: { diff: ProfileDiff }) {
    const changedColors = diff.colors.filter((c) => c.status !== 'same');
    const changedType = diff.typeScale.filter((t) => t.status !== 'same');
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-small">
            <DiffLine label="Colors" same={diff.colors.length - changedColors.length} changed={changedColors.length} />
            <DiffLine label="Type steps" same={diff.typeScale.length - changedType.length} changed={changedType.length} />
            {(diff.libraries.added.length > 0 || diff.libraries.removed.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground">Libraries:</span>
                    {diff.libraries.added.map((l) => <Badge key={`a-${l}`} variant="outline" className="rounded-sm text-success">+{l}</Badge>)}
                    {diff.libraries.removed.map((l) => <Badge key={`r-${l}`} variant="outline" className="rounded-sm text-danger">-{l}</Badge>)}
                </div>
            )}
            {changedColors.slice(0, 8).map((c) => (
                <div key={c.name} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-muted-foreground">{c.name}</span>
                    {c.a && <span className="h-4 w-4 rounded border border-border" style={{ background: c.a }} title={c.a} />}
                    <span className="text-muted-foreground">{c.status === 'changed' ? 'to' : c.status === 'onlyA' ? 'removed' : 'added'}</span>
                    {c.b && <span className="h-4 w-4 rounded border border-border" style={{ background: c.b }} title={c.b} />}
                </div>
            ))}
        </div>
    );
}

function DiffLine({ label, same, changed }: { label: string; same: number; changed: number }) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
            <Badge variant="outline" className="rounded-sm text-muted-foreground">{same} same</Badge>
            {changed > 0 && <Badge variant="outline" className="rounded-sm text-warning">{changed} changed</Badge>}
        </div>
    );
}

export default DesignSystemPanel;
