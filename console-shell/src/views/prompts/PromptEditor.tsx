import { useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { PromptEntry, PromptVariable, PromptVariableType } from '../../lib/bridge';
import { extractVariableNames } from '../../lib/ai/interpolate';

/**
 * Create / edit a prompt. The body's {{name}} references drive which
 * variables exist; this form lets the user set each variable's type, label,
 * select options, and default. Variables no longer referenced are dropped
 * on save so the form never carries stale fields.
 */
export function PromptEditor({
    initial,
    onCancel,
    onSave,
    saving,
}: {
    initial: PromptEntry | null;
    onCancel: () => void;
    onSave: (input: {
        title: string; body: string; variables: PromptVariable[]; category: string; tags: string[];
    }) => void;
    saving: boolean;
}) {
    const [title, setTitle] = useState(initial?.title ?? '');
    const [body, setBody] = useState(initial?.body ?? '');
    const [category, setCategory] = useState(initial?.category ?? 'General');
    const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '));
    // Variable metadata keyed by name; we keep edits even if a name briefly
    // disappears from the body while the user is mid-edit.
    const [meta, setMeta] = useState<Record<string, PromptVariable>>(() => {
        const m: Record<string, PromptVariable> = {};
        for (const v of initial?.variables ?? []) m[v.name] = v;
        return m;
    });

    const names = useMemo(() => extractVariableNames(body), [body]);

    function metaFor(name: string): PromptVariable {
        return meta[name] ?? { name, type: 'text', label: name };
    }
    function setMetaField(name: string, patch: Partial<PromptVariable>) {
        setMeta((prev) => ({ ...prev, [name]: { ...metaFor(name), ...patch, name } }));
    }

    function submit() {
        const variables = names.map((n) => {
            const v = metaFor(n);
            const out: PromptVariable = { name: n, type: v.type, label: v.label || n };
            if (v.type === 'select' && v.options && v.options.length > 0) out.options = v.options;
            if (v.default) out.default = v.default;
            return out;
        });
        const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
        onSave({
            title: title.trim(),
            body,
            variables,
            category: category.trim() || 'General',
            tags,
        });
    }

    const canSave = title.trim().length > 0 && body.trim().length > 0 && !saving;

    return (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="prompt-title">Title</Label>
                <Input
                    id="prompt-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Explain this error"
                    data-testid="prompt-title-input"
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="prompt-category">Category</Label>
                    <Input
                        id="prompt-category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="Debugging"
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="prompt-tags">Tags</Label>
                    <Input
                        id="prompt-tags"
                        value={tagsText}
                        onChange={(e) => setTagsText(e.target.value)}
                        placeholder="error, explain"
                    />
                </div>
            </div>

            <div className="flex flex-col gap-1.5">
                <Label htmlFor="prompt-body">Body</Label>
                <textarea
                    id="prompt-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={7}
                    placeholder="Explain this error in plain words: {{error}}"
                    data-testid="prompt-body-input"
                    className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-small leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
                />
            </div>

            {names.length > 0 && (
                <div className="flex flex-col gap-2">
                    <Label>Variables</Label>
                    <div className="flex flex-col gap-2">
                        {names.map((n) => {
                            const v = metaFor(n);
                            return (
                                <div key={n} className="flex flex-col gap-2 rounded-md border border-border p-2.5">
                                    <div className="flex items-center gap-2">
                                        <code className="rounded-sm bg-secondary px-1.5 py-0.5 text-label text-foreground">
                                            {`{{${n}}}`}
                                        </code>
                                        <Select
                                            value={v.type}
                                            onValueChange={(t) => setMetaField(n, { type: t as PromptVariableType })}
                                        >
                                            <SelectTrigger size="sm" className="w-[130px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="text">Text</SelectItem>
                                                <SelectItem value="multiline">Multiline</SelectItem>
                                                <SelectItem value="select">Select</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Input
                                        value={v.label ?? ''}
                                        onChange={(e) => setMetaField(n, { label: e.target.value })}
                                        placeholder="Label shown on the form"
                                        className="h-8"
                                    />
                                    {v.type === 'select' && (
                                        <Input
                                            value={(v.options ?? []).join(', ')}
                                            onChange={(e) =>
                                                setMetaField(n, {
                                                    options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                                                })
                                            }
                                            placeholder="Comma-separated options"
                                            className="h-8"
                                        />
                                    )}
                                    <Input
                                        value={v.default ?? ''}
                                        onChange={(e) => setMetaField(n, { default: e.target.value })}
                                        placeholder="Default value (optional)"
                                        className="h-8"
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={submit}
                    disabled={!canSave}
                    data-testid="prompt-save"
                >
                    {saving ? 'Saving...' : initial ? 'Save changes' : 'Create prompt'}
                </Button>
            </div>
        </div>
    );
}
