import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquare, ListChecks, ChevronLeft } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button, EmptyState } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { bridge, type DevSession, type DevTurn, type DevPlan, type PromptVariable } from '../../lib/bridge';
import { useCreatePrompt } from '../../lib/queries/prompts';

/**
 * Import a prompt or plan from the user's own local Claude Code sessions for this
 * project, and clean it into a reusable library template. Read-only + local; the
 * cleaner (in main) strips secrets and parameterizes paths before anything is saved.
 */

// IDE-injected scaffolding (opened-file notices, hook output) is not a real prompt.
const isScaffold = (t: string): boolean =>
    /^\s*<(ide_|system-reminder|command-|local-command|user-prompt-submit|persisted|session-start)/.test(t)
    || t.trimStart().startsWith('Caveat:');

const TOOL_LABEL: Record<DevSession['tool'], string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
};

type Draft = { title: string; body: string; variables: PromptVariable[] };

export function ImportPromptDialog({ root, open, onOpenChange, onImported }: {
    root: string | null;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onImported: (id: string) => void;
}) {
    const [sessions, setSessions] = useState<DevSession[] | null>(null);
    const [active, setActive] = useState<DevSession | null>(null);
    const [content, setContent] = useState<{ prompts: DevTurn[]; plans: DevPlan[] } | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const createMut = useCreatePrompt(root);

    useEffect(() => {
        if (!open || !root) return;
        setActive(null); setContent(null); setDraft(null); setSessions(null);
        bridge.devsessions.list(root).then(setSessions).catch(() => setSessions([]));
    }, [open, root]);

    async function pickSession(s: DevSession) {
        setActive(s); setContent(null);
        const { turns, plans } = await bridge.devsessions.read(s.path);
        const prompts = turns.filter((t) => t.role === 'user' && !isScaffold(t.text) && t.text.trim().length > 8);
        setContent({ prompts, plans });
    }

    async function pickText(text: string, title: string) {
        const cleaned = await bridge.devsessions.clean(text, root ?? undefined);
        setDraft({ title: title.replace(/\s+/g, ' ').slice(0, 60), body: cleaned.body, variables: cleaned.variables });
    }

    async function save() {
        if (!draft) return;
        setBusy(true);
        try {
            const entry = await createMut.mutateAsync({
                title: draft.title || 'Imported prompt', body: draft.body,
                variables: draft.variables, category: 'Imported', tags: ['imported'],
            });
            toast.success('Prompt imported');
            onImported(entry.id);
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the prompt');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl" data-testid="prompt-import">
                <DialogHeader>
                    <DialogTitle>Import a prompt</DialogTitle>
                    <DialogDescription>
                        Reuse a prompt or plan from your AI coding-tool sessions (Claude Code, Codex, Copilot, Cursor) on this project. Read-only and local; secrets and machine paths are stripped before saving.
                    </DialogDescription>
                </DialogHeader>

                {draft ? (
                    <div className="flex flex-col gap-3" data-testid="import-edit">
                        <BackButton onClick={() => setDraft(null)}>Back</BackButton>
                        <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Prompt title" data-testid="import-title" />
                        <textarea
                            value={draft.body}
                            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                            className="min-h-[220px] w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-small text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-testid="import-body"
                        />
                        {draft.variables.length > 0 && (
                            <p className="text-small text-muted-foreground">
                                Variables: {draft.variables.map((v) => `{{${v.name}}}`).join(', ')}. Add more with {'{{name}}'}.
                            </p>
                        )}
                    </div>
                ) : active ? (
                    <div className="flex flex-col gap-2">
                        <BackButton onClick={() => { setActive(null); setContent(null); }}>Sessions</BackButton>
                        {!content ? <Loading /> : (
                            <div className="flex max-h-[340px] flex-col gap-3 overflow-y-auto">
                                {content.plans.length > 0 && (
                                    <div className="flex flex-col gap-1.5">
                                        <SectionTitle icon={ListChecks}>Plans ({content.plans.length})</SectionTitle>
                                        {content.plans.map((p, i) => (
                                            <PickRow key={`plan-${i}`} text={p.title} sub="plan" onClick={() => pickText(p.body, p.title)} />
                                        ))}
                                    </div>
                                )}
                                <div className="flex flex-col gap-1.5">
                                    <SectionTitle icon={MessageSquare}>Your prompts ({content.prompts.length})</SectionTitle>
                                    {content.prompts.length === 0 && <p className="text-small text-muted-foreground">No reusable prompts found in this session.</p>}
                                    {content.prompts.map((t, i) => (
                                        <PickRow key={`p-${i}`} text={t.text} onClick={() => pickText(t.text, t.text)} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : sessions === null ? (
                    <Loading />
                ) : sessions.length === 0 ? (
                    <EmptyState icon={MessageSquare} title="No AI coding-tool sessions for this project.">
                        Open this project in Claude Code, Codex, Copilot, or Cursor and chat with it; your prompts then show up here to reuse.
                    </EmptyState>
                ) : (
                    <div className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto" data-testid="import-sessions">
                        {sessions.map((s) => (
                            <button key={s.id} onClick={() => pickSession(s)} className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-secondary/40">
                                <span className="truncate text-card-title text-foreground">{s.title}</span>
                                <span className="tabular-nums text-label text-muted-foreground">{TOOL_LABEL[s.tool]} · {s.turns.toLocaleString()} turns · {s.lastAt ? new Date(s.lastAt).toLocaleDateString() : ''}</span>
                            </button>
                        ))}
                    </div>
                )}

                <DialogFooter>
                    {draft && (
                        <Button onClick={save} loading={busy} data-testid="import-save">
                            Save to library
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Loading() {
    return <div className="flex items-center gap-2 py-8 text-small text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Reading your local sessions…</div>;
}

function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button onClick={onClick} className="flex w-fit items-center gap-1 text-small text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3.5" /> {children}
        </button>
    );
}

function SectionTitle({ icon: Icon, children }: { icon: ComponentType<{ className?: string }>; children: ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 text-label uppercase tracking-wide text-muted-foreground">
            <Icon className="size-3.5" />{children}
        </div>
    );
}

function PickRow({ text, sub, onClick }: { text: string; sub?: string; onClick: () => void }) {
    return (
        <button onClick={onClick} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-secondary/40">
            <span className="truncate text-small text-foreground">{text.replace(/\s+/g, ' ').slice(0, 90)}</span>
            {sub && <span className="shrink-0 text-label text-muted-foreground">{sub}</span>}
        </button>
    );
}
