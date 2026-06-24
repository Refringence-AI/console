import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
    BookMarked,
    Plus,
    Star,
    Search,
    MousePointerClick,
} from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { Button, Badge, EmptyState } from '@/components/ui';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import {
    usePrompts,
    useCreatePrompt,
    useUpdatePrompt,
    useDeletePrompt,
    useToggleFavorite,
} from '../../lib/queries/prompts';
import { interpolate } from '../../lib/ai/interpolate';
import { setAiPrefill } from '../../lib/ai/prefill';
import type { PromptEntry, PromptVariable } from '../../lib/bridge';
import { PromptEditor } from './PromptEditor';
import { PromptDetailOperator } from './PromptDetailOperator';
import { PromptDetailGuided } from './PromptDetailGuided';
import { SkillsButton } from './SkillsLibrary';

/**
 * Prompt library. Left: searchable / filterable list (category, tag,
 * favorites). Right: fill the selected prompt's variables, preview the
 * result, then Copy / Send to AI / hand off to a dev tool.
 */
export function PromptLibraryPanel() {
    const { project } = useActiveProject();
    const root = project?.path ?? null;
    const navigate = useNavigate();
    const { isNewbie } = usePersonaMode();

    const prompts = usePrompts(root);
    const createMut = useCreatePrompt(root);
    const updateMut = useUpdatePrompt(root);
    const deleteMut = useDeletePrompt(root);
    const favMut = useToggleFavorite(root);

    const [query, setQuery] = useState('');
    const [category, setCategory] = useState<string | null>(null);
    const [tag, setTag] = useState<string | null>(null);
    const [favOnly, setFavOnly] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<PromptEntry | null>(null);
    const [values, setValues] = useState<Record<string, string>>({});

    const list = prompts.data ?? [];

    const categories = useMemo(
        () => Array.from(new Set(list.map((p) => p.category))).sort(),
        [list],
    );
    const tags = useMemo(
        () => Array.from(new Set(list.flatMap((p) => p.tags))).sort(),
        [list],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return list.filter((p) => {
            if (favOnly && !p.favorite) return false;
            if (category && p.category !== category) return false;
            if (tag && !p.tags.includes(tag)) return false;
            if (q) {
                const hay = `${p.title} ${p.body} ${p.tags.join(' ')} ${p.category}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [list, query, category, tag, favOnly]);

    const selected = useMemo(
        () => list.find((p) => p.id === selectedId) ?? null,
        [list, selectedId],
    );

    // Land on the first prompt so the right pane opens on the variable form and
    // live preview instead of the empty "Pick a prompt" state. Only fires once
    // prompts have loaded and nothing is selected yet; an empty library keeps
    // its genuine empty state.
    useEffect(() => {
        if (selectedId || list.length === 0) return;
        selectPrompt(list[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list, selectedId]);

    function selectPrompt(p: PromptEntry) {
        setSelectedId(p.id);
        // Seed defaults so the preview starts populated.
        const seed: Record<string, string> = {};
        for (const v of p.variables) if (v.default) seed[v.name] = v.default;
        setValues(seed);
    }

    const filled = selected ? interpolate(selected.body, values) : '';

    function openCreate() {
        setEditing(null);
        setEditorOpen(true);
    }
    function openEdit(p: PromptEntry) {
        setEditing(p);
        setEditorOpen(true);
    }

    async function saveEditor(input: {
        title: string; body: string; variables: PromptVariable[]; category: string; tags: string[];
    }) {
        try {
            if (editing) {
                await updateMut.mutateAsync({ id: editing.id, input });
                toast.success('Prompt updated');
            } else {
                const created = await createMut.mutateAsync(input);
                setSelectedId(created.id);
                toast.success('Prompt created');
            }
            setEditorOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the prompt');
        }
    }

    async function remove(p: PromptEntry) {
        try {
            await deleteMut.mutateAsync(p.id);
            if (selectedId === p.id) setSelectedId(null);
            toast.success('Prompt deleted');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not delete the prompt');
        }
    }

    async function copyFilled() {
        try {
            await navigator.clipboard.writeText(filled.trim());
            toast.success('Copied');
        } catch {
            toast.error('Could not copy to the clipboard');
        }
    }

    function sendToAi() {
        setAiPrefill(filled.trim());
        navigate('/ai');
    }

    if (!root) {
        return (
            <div className="flex h-full flex-col" data-testid="prompts-panel">
                <PanelHeader icon={BookMarked} title="Prompts" subtitle="Reusable prompt templates" />
                <div className="flex flex-1 items-center justify-center p-8">
                    <EmptyState icon={BookMarked} title="Pick a project first">
                        Prompts are stored per project under .refringence-console. Choose an active
                        project to see its library.
                    </EmptyState>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col" data-testid="prompts-panel">
            <PanelHeader icon={BookMarked} title="Prompts" subtitle="Reusable prompt templates and agent skills">
                <SkillsButton root={root} />
                <Button type="button" size="sm" onClick={openCreate} className="gap-1.5" data-testid="prompt-new">
                    <Plus className="h-3.5 w-3.5" />
                    New prompt
                </Button>
            </PanelHeader>

            <div className="flex min-h-0 flex-1">
                {/* List + filters */}
                <div className="flex w-[360px] shrink-0 flex-col border-r border-border">
                    <div className="flex flex-col gap-2 border-b border-border p-3">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search prompts"
                                className="pl-8"
                                data-testid="prompt-search"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <FilterChip
                                label="Favorites"
                                active={favOnly}
                                onClick={() => setFavOnly((v) => !v)}
                            />
                            {categories.map((c) => (
                                <FilterChip
                                    key={c}
                                    label={c}
                                    active={category === c}
                                    onClick={() => setCategory((cur) => (cur === c ? null : c))}
                                />
                            ))}
                        </div>
                        {tags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {tags.map((t) => (
                                    <FilterChip
                                        key={t}
                                        label={`#${t}`}
                                        active={tag === t}
                                        onClick={() => setTag((cur) => (cur === t ? null : t))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <ul className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="prompt-list">
                        {filtered.length === 0 ? (
                            <li className="px-3 py-8 text-center text-small text-muted-foreground">
                                {list.length === 0
                                    ? 'No prompts saved yet. Use New prompt to build your first template.'
                                    : 'Nothing matches these filters. Clear a filter or adjust your search.'}
                            </li>
                        ) : (
                            filtered.map((p) => (
                                <li key={p.id}>
                                    <button
                                        type="button"
                                        onClick={() => selectPrompt(p)}
                                        data-testid={`prompt-item-${p.id}`}
                                        // Operator tightens the row to a single dense line; Guided
                                        // keeps the calmer two-line card so newcomers read more.
                                        className={`flex w-full flex-col rounded-md px-3 text-left transition-colors ${
                                            isNewbie ? 'gap-1 py-2' : 'gap-0.5 py-1.5'
                                        } ${
                                            selectedId === p.id
                                                ? 'bg-accent-subtle'
                                                : 'hover:bg-secondary'
                                        }`}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <span className="flex-1 truncate text-body text-foreground">{p.title}</span>
                                            {p.favorite && (
                                                <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
                                            )}
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <Badge variant="outline" className="rounded-sm text-label text-muted-foreground">
                                                {p.category}
                                            </Badge>
                                            {p.tags.slice(0, 2).map((t) => (
                                                <span key={t} className="text-label text-muted-foreground">#{t}</span>
                                            ))}
                                        </span>
                                    </button>
                                </li>
                            ))
                        )}
                    </ul>
                </div>

                {/* Detail / fill. Two purpose-built surfaces: Guided is a calm
                    stepped flow; Operator is the dense cockpit with the template
                    source + schema inline and the dev-tool router. */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {!selected ? (
                        <div className="flex h-full items-center justify-center p-8">
                            <EmptyState icon={MousePointerClick} title="Pick a prompt">
                                {isNewbie
                                    ? 'Choose a prompt on the left. You fill in the blanks, then copy it or send it straight to your AI.'
                                    : 'Select a prompt to fill its variables, preview the result, and send it.'}
                            </EmptyState>
                        </div>
                    ) : isNewbie ? (
                        <PromptDetailGuided
                            key={selected.id}
                            selected={selected}
                            values={values}
                            onValues={setValues}
                            onCopy={copyFilled}
                            onSendToAi={sendToAi}
                        />
                    ) : (
                        <PromptDetailOperator
                            selected={selected}
                            values={values}
                            onValues={setValues}
                            filled={filled}
                            favorite={selected.favorite}
                            onFavorite={() => favMut.mutate(selected.id)}
                            onEdit={() => openEdit(selected)}
                            onDelete={() => remove(selected)}
                            onCopy={copyFilled}
                            onSendToAi={sendToAi}
                        />
                    )}
                </div>
            </div>

            <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
                <DialogContent className="sm:max-w-2xl" data-testid="prompt-editor">
                    <DialogHeader>
                        <DialogTitle>{editing ? 'Edit prompt' : 'New prompt'}</DialogTitle>
                        <DialogDescription>
                            Use {'{{name}}'} in the body to add a variable, then describe it below.
                        </DialogDescription>
                    </DialogHeader>
                    <PromptEditor
                        key={editing?.id ?? 'new'}
                        initial={editing}
                        onCancel={() => setEditorOpen(false)}
                        onSave={saveEditor}
                        saving={createMut.isPending || updateMut.isPending}
                    />
                    <DialogFooter className="hidden" />
                </DialogContent>
            </Dialog>
        </div>
    );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`rounded-full border px-2.5 py-0.5 text-label transition-colors ${
                active
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border text-muted-foreground hover:bg-secondary'
            }`}
        >
            {label}
        </button>
    );
}

export default PromptLibraryPanel;
