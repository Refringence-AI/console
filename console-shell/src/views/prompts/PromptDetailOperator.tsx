import { Star, Pencil, Trash2, ClipboardCopy, Send, CopyPlus } from 'lucide-react';
import { Button, Badge, Card, Kbd } from '@/components/ui';
import type { PromptEntry } from '../../lib/bridge';
import { PromptVariableForm } from './PromptVariableForm';
import { HandoffBar } from './HandoffBar';

/**
 * Operator (seasoned) detail surface. Denser than Guided: tight header with a
 * keyboard-hint row, the variable form + live preview, the raw template body
 * and {{var}} schema inline (so a power user reads the source, not just the
 * rendered form), then the full action row + the dev-tool router. This is the
 * dense cockpit; Guided is a separate stepped surface.
 */
export function PromptDetailOperator({
    selected,
    values,
    onValues,
    filled,
    favorite,
    readOnly,
    onFavorite,
    onEdit,
    onDelete,
    onClone,
    onCopy,
    onSendToAi,
}: {
    selected: PromptEntry;
    values: Record<string, string>;
    onValues: (next: Record<string, string>) => void;
    filled: string;
    favorite: boolean;
    readOnly: boolean;
    onFavorite: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onClone: () => void;
    onCopy: () => void;
    onSendToAi: () => void;
}) {
    return (
        <div className="flex flex-col gap-3 p-4" data-testid="prompt-detail">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 className="truncate text-section text-foreground">{selected.title}</h2>
                    <span className="flex items-center gap-1.5 text-small text-muted-foreground">
                        {selected.category}
                        {readOnly && (
                            <Badge variant="outline" className="rounded-sm text-label text-accent">Curated</Badge>
                        )}
                        {selected.tags.slice(0, 4).map((t) => (
                            <span key={t} className="text-label text-muted-foreground">#{t}</span>
                        ))}
                    </span>
                    {selected.whatWhen && (
                        <p className="mt-1 text-small leading-relaxed text-muted-foreground">{selected.whatWhen}</p>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onFavorite}
                        title={favorite ? 'Unfavorite' : 'Favorite'}
                        data-testid="prompt-favorite"
                    >
                        <Star className={`h-3.5 w-3.5 ${favorite ? 'fill-warning text-warning' : ''}`} />
                    </Button>
                    {readOnly ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onClone}
                            title="Clone to my library"
                            aria-label="Clone to my library"
                            data-testid="prompt-clone"
                        >
                            <CopyPlus className="h-3.5 w-3.5" />
                        </Button>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={onEdit}
                                title="Edit"
                                aria-label="Edit prompt"
                                data-testid="prompt-edit"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={onDelete}
                                title="Delete"
                                data-testid="prompt-delete"
                            >
                                <Trash2 className="h-3.5 w-3.5 text-danger" />
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Keyboard hints up front so the cockpit reads dense, not bare. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                    navigate
                </span>
                <span className="flex items-center gap-1.5">
                    <Kbd>⌘</Kbd>
                    <Kbd>C</Kbd>
                    copy filled
                </span>
            </div>

            <PromptVariableForm
                body={selected.body}
                variables={selected.variables}
                values={values}
                onChange={onValues}
            />

            {/* The template source + schema, inline. A power user wants to read the
                raw body and its {{vars}} at a glance; Guided never shows this. */}
            <div className="flex flex-col gap-1.5" data-testid="prompt-template-source">
                <span className="text-small text-muted-foreground">Template source</span>
                <Card className="gap-0 bg-secondary/40 p-3">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-small leading-relaxed text-foreground">
                        {selected.body}
                    </pre>
                </Card>
                {selected.variables.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="prompt-variable-schema">
                        {selected.variables.map((v) => (
                            <Badge
                                key={v.name}
                                variant="outline"
                                className="rounded-sm font-mono text-label text-muted-foreground"
                                title={v.label || v.name}
                            >
                                {`{{${v.name}}}`}
                                <span className="ml-1 text-muted-foreground/70">{v.type}</span>
                            </Badge>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        size="sm"
                        onClick={onCopy}
                        className="gap-1.5"
                        data-testid="prompt-copy"
                    >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                        Copy
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onSendToAi}
                        className="gap-1.5"
                        data-testid="prompt-send-ai"
                    >
                        <Send className="h-3.5 w-3.5" />
                        Send to AI
                    </Button>
                </div>
                <HandoffBar filled={filled} />
            </div>
        </div>
    );
}
