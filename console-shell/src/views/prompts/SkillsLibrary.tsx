import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Check, Download, Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { bridge, type SkillTool, type SkillInput } from '../../lib/bridge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

/**
 * Agent-skills library: a curated catalogue of high-signal skills plus the
 * user's own authored skills, installed into the open project for Claude Code
 * (.claude/skills) or Codex (.codex/skills). Project-scoped: installing never
 * touches the user's global config. Custom skills persist in
 * .refringence-console/skills.json so they travel with the repo.
 */
export function SkillsButton({ root }: { root: string | null }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="prompts-skills-open">
                <Boxes className="h-3 w-3" />
                Skills
            </Button>
            {open && <SkillsDialog root={root} open={open} onOpenChange={setOpen} />}
        </>
    );
}

type Editing = { id: string | null; draft: SkillInput } | null;
const EMPTY_DRAFT: SkillInput = { name: '', description: '', body: '', tags: [] };

function SkillsDialog({ root, open, onOpenChange }: { root: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
    const qc = useQueryClient();
    const [tool, setTool] = useState<SkillTool>('claude');
    const [busy, setBusy] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing>(null);

    const list = useQuery({ queryKey: ['skills', 'list'], queryFn: () => bridge.skills.list(), staleTime: Infinity });
    const custom = useQuery({
        queryKey: ['skills', 'custom', root],
        queryFn: () => bridge.skills.listCustom(root ?? ''),
        enabled: !!root,
        staleTime: 30_000,
    });
    const installed = useQuery({
        queryKey: ['skills', 'installed', root, tool],
        queryFn: () => bridge.skills.installed(root ?? '', tool),
        enabled: !!root,
        staleTime: 30_000,
    });
    const installedSet = new Set(installed.data ?? []);

    async function install(id: string, name: string) {
        if (!root) { toast.error('Open a project first.'); return; }
        setBusy(id);
        try {
            const r = await bridge.skills.install(root, id, tool);
            if (r.ok) {
                toast.success(`Installed ${name} -> ${r.path}`);
                void qc.invalidateQueries({ queryKey: ['skills', 'installed'] });
            } else {
                toast.error(r.error ?? 'Could not install the skill');
            }
        } catch (err) {
            toast.error(`Install failed: ${String(err)}`);
        } finally {
            setBusy(null);
        }
    }

    async function saveSkill(input: SkillInput) {
        if (!root) { toast.error('Open a project first.'); return; }
        try {
            const r = editing?.id
                ? await bridge.skills.update(root, editing.id, input)
                : await bridge.skills.create(root, input);
            if (r.ok) {
                toast.success(editing?.id ? 'Skill updated' : 'Skill created');
                void qc.invalidateQueries({ queryKey: ['skills', 'custom'] });
                setEditing(null);
            } else {
                toast.error(r.error ?? 'Could not save the skill');
            }
        } catch (err) {
            toast.error(`Save failed: ${String(err)}`);
        }
    }

    async function removeSkill(id: string, name: string) {
        if (!root) return;
        try {
            const r = await bridge.skills.delete(root, id);
            if (r.ok) {
                toast.success(`Deleted ${name}`);
                void qc.invalidateQueries({ queryKey: ['skills', 'custom'] });
                void qc.invalidateQueries({ queryKey: ['skills', 'installed'] });
            } else {
                toast.error(r.error ?? 'Could not delete the skill');
            }
        } catch (err) {
            toast.error(String(err));
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent data-testid="skills-dialog" className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{editing ? (editing.id ? 'Edit skill' : 'Author a skill') : 'Agent skills'}</DialogTitle>
                    <DialogDescription>
                        {editing ? (
                            'A skill is a sharp instruction your coding agent loads each session. Keep the body short and specific.'
                        ) : (
                            <>
                                Install a skill into this project for your dev tool. It writes{' '}
                                <code className="font-mono text-label">{tool === 'codex' ? '.codex' : '.claude'}/skills/&lt;id&gt;/SKILL.md</code>{' '}
                                - nothing global is touched.
                            </>
                        )}
                    </DialogDescription>
                </DialogHeader>

                {editing ? (
                    <SkillEditorForm
                        initial={editing.draft}
                        onSave={saveSkill}
                        onCancel={() => setEditing(null)}
                    />
                ) : (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                                <span className="text-small text-muted-foreground">Install for</span>
                                {(['claude', 'codex'] as SkillTool[]).map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setTool(t)}
                                        data-testid={`skills-tool-${t}`}
                                        className={`rounded-md border px-2 py-0.5 text-small transition ${
                                            tool === t ? 'border-foreground/30 bg-secondary/50 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary/30'
                                        }`}
                                    >
                                        {t === 'claude' ? 'Claude Code' : 'Codex'}
                                    </button>
                                ))}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditing({ id: null, draft: EMPTY_DRAFT })}
                                data-testid="skill-author"
                            >
                                <Plus className="h-3 w-3" />
                                Author a skill
                            </Button>
                        </div>

                        <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
                            {(custom.data?.length ?? 0) > 0 && (
                                <p className="text-label uppercase tracking-wide text-muted-foreground">Your skills</p>
                            )}
                            {custom.data?.map((s) => {
                                const has = installedSet.has(s.id);
                                return (
                                    <div key={s.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition hover:border-foreground/20 hover:bg-secondary/30" data-testid={`skill-${s.id}`}>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-card-title text-foreground">{s.name}</p>
                                            <p className="text-small leading-relaxed text-muted-foreground">{s.description}</p>
                                            <div className="mt-1.5 flex flex-wrap gap-1">
                                                {s.tags.map((t) => <Badge key={t} variant="secondary" className="rounded-md">{t}</Badge>)}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <Button variant="ghost" size="sm" title="Edit" aria-label="Edit skill" onClick={() => setEditing({ id: s.id, draft: { name: s.name, description: s.description, body: s.body, tags: s.tags } })} data-testid={`skill-edit-${s.id}`}>
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                            <Button variant="ghost" size="sm" title="Delete" aria-label="Delete skill" onClick={() => removeSkill(s.id, s.name)} data-testid={`skill-delete-${s.id}`}>
                                                <Trash2 className="h-3 w-3 text-danger" />
                                            </Button>
                                            {has ? (
                                                <Badge variant="success" className="rounded-md"><Check className="h-2.5 w-2.5" />installed</Badge>
                                            ) : (
                                                <Button size="sm" disabled={busy === s.id} onClick={() => install(s.id, s.name)} data-testid={`skill-install-${s.id}`}>
                                                    {busy === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                                    Install
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                            <p className="mt-1 text-label uppercase tracking-wide text-muted-foreground">Curated</p>
                            {list.isLoading && (
                                [0, 1, 2].map((i) => (
                                    <div key={i} className="h-[4.5rem] animate-pulse rounded-lg border border-border bg-secondary/30" />
                                ))
                            )}
                            {list.isError && (
                                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-3">
                                    <span className="text-small text-muted-foreground">Could not load the skill catalogue.</span>
                                    <Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button>
                                </div>
                            )}
                            {list.data?.map((s) => {
                                const has = installedSet.has(s.id);
                                return (
                                    <div key={s.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition hover:border-foreground/20 hover:bg-secondary/30" data-testid={`skill-${s.id}`}>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-card-title text-foreground">{s.name}</p>
                                            <p className="text-small leading-relaxed text-muted-foreground">{s.description}</p>
                                            <div className="mt-1.5 flex flex-wrap gap-1">
                                                {s.tags.map((t) => <Badge key={t} variant="secondary" className="rounded-md">{t}</Badge>)}
                                            </div>
                                        </div>
                                        {has ? (
                                            <Badge variant="success" className="shrink-0 rounded-md"><Check className="h-2.5 w-2.5" />installed</Badge>
                                        ) : (
                                            <Button size="sm" className="shrink-0" disabled={busy === s.id} onClick={() => install(s.id, s.name)} data-testid={`skill-install-${s.id}`}>
                                                {busy === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                                Install
                                            </Button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function SkillEditorForm({ initial, onSave, onCancel }: {
    initial: SkillInput;
    onSave: (input: SkillInput) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(initial.name);
    const [description, setDescription] = useState(initial.description);
    const [body, setBody] = useState(initial.body);
    const [tags, setTags] = useState((initial.tags ?? []).join(', '));
    const canSave = name.trim().length > 0 && body.trim().length > 0;

    function save() {
        onSave({
            name: name.trim(),
            description: description.trim(),
            body,
            tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        });
    }

    return (
        <div className="flex flex-col gap-3" data-testid="skill-editor">
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-name" className="text-small">Name</Label>
                <Input id="skill-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fix lint before commit" data-testid="skill-name-input" />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-desc" className="text-small">Description</Label>
                <Input id="skill-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line on what this skill makes the agent do" />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-body" className="text-small">Body (markdown)</Label>
                <textarea
                    id="skill-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    placeholder={'A sharp instruction. For example:\n\nWhen asked to commit, first run the linter and fix every error before staging.'}
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-small leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
                    data-testid="skill-body-input"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-tags" className="text-small">Tags (comma-separated)</Label>
                <Input id="skill-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="quality, lint" />
            </div>
            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                <Button size="sm" disabled={!canSave} onClick={save} data-testid="skill-save">Save skill</Button>
            </div>
        </div>
    );
}
