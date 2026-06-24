import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Check, Download, Loader2 } from 'lucide-react';
import { bridge, type SkillTool } from '../../lib/bridge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

/**
 * Agent-skills library: a curated catalogue of high-signal skills, installed into
 * the open project for Claude Code (.claude/skills) or Codex (.codex/skills).
 * Project-scoped: installing never touches the user's global config.
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

function SkillsDialog({ root, open, onOpenChange }: { root: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
    const qc = useQueryClient();
    const [tool, setTool] = useState<SkillTool>('claude');
    const [busy, setBusy] = useState<string | null>(null);

    const list = useQuery({ queryKey: ['skills', 'list'], queryFn: () => bridge.skills.list(), staleTime: Infinity });
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
                toast.success(`Installed ${name} → ${r.path}`);
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent data-testid="skills-dialog" className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Agent skills</DialogTitle>
                    <DialogDescription>
                        Install a skill into this project for your dev tool. It writes{' '}
                        <code className="font-mono text-label">{tool === 'codex' ? '.codex' : '.claude'}/skills/&lt;id&gt;/SKILL.md</code>{' '}
                        - nothing global is touched.
                    </DialogDescription>
                </DialogHeader>

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

                <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
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
                    {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 && (
                        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-small text-muted-foreground">No skills available yet.</div>
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
            </DialogContent>
        </Dialog>
    );
}
