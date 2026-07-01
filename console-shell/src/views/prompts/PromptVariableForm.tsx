import { useLayoutEffect, useRef } from 'react';
import { Card } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { PromptVariable } from '../../lib/bridge';
import { interpolate } from '../../lib/ai/interpolate';

// A free-text variable (an error/stack-trace dump) can be empty or a page long.
// A fixed rows={4} block reserved giant dead space for short values; this grows
// from two rows up to a cap, then scrolls, so the pane never trails off.
const MULTILINE_MIN_PX = 56;
const MULTILINE_MAX_PX = 180;

function AutoTextarea({
    id,
    value,
    placeholder,
    onChange,
}: {
    id: string;
    value: string;
    placeholder?: string;
    onChange: (next: string) => void;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, MULTILINE_MAX_PX)}px`;
    }, [value]);
    return (
        <textarea
            ref={ref}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{ minHeight: MULTILINE_MIN_PX, maxHeight: MULTILINE_MAX_PX }}
            className="w-full resize-none overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-body leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
        />
    );
}

/**
 * Renders one typed input per prompt variable and a live interpolated
 * preview of the filled body. Controlled: the parent owns `values` so the
 * same map feeds Copy / Send-to-AI / the dev-tool router.
 */
export function PromptVariableForm({
    body,
    variables,
    values,
    onChange,
}: {
    body: string;
    variables: PromptVariable[];
    values: Record<string, string>;
    onChange: (next: Record<string, string>) => void;
}) {
    function set(name: string, value: string) {
        onChange({ ...values, [name]: value });
    }

    const preview = interpolate(body, values);

    return (
        <div className="flex flex-col gap-4" data-testid="prompt-variable-form">
            {variables.length > 0 && (
                <div className="flex flex-col gap-3">
                    {variables.map((v) => (
                        <div key={v.name} className="flex flex-col gap-1.5">
                            <Label htmlFor={`var-${v.name}`} className="text-small">
                                {v.label || v.name}
                            </Label>
                            {v.type === 'multiline' ? (
                                <AutoTextarea
                                    id={`var-${v.name}`}
                                    value={values[v.name] ?? ''}
                                    onChange={(val) => set(v.name, val)}
                                    placeholder={v.placeholder ?? v.default}
                                />
                            ) : v.type === 'select' ? (
                                <Select
                                    value={values[v.name] ?? v.default ?? ''}
                                    onValueChange={(val) => set(v.name, val)}
                                >
                                    <SelectTrigger id={`var-${v.name}`} className="w-full">
                                        <SelectValue placeholder="Choose one" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(v.options ?? []).map((opt) => (
                                            <SelectItem key={opt} value={opt}>
                                                {opt}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    id={`var-${v.name}`}
                                    value={values[v.name] ?? ''}
                                    onChange={(e) => set(v.name, e.target.value)}
                                    placeholder={v.placeholder ?? v.default}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <Label className="text-small text-muted-foreground">Preview</Label>
                <Card className="gap-0 p-3" data-testid="prompt-preview">
                    <div className="whitespace-pre-wrap break-words text-small leading-relaxed text-foreground">
                        {preview.trim() || (
                            <span className="text-muted-foreground">Nothing to preview yet.</span>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    );
}
