import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { AiModelOption, AiProviderId } from '../../../lib/bridge';
import { groupModelsByProvider } from '../../../lib/queries/ai';

const PROVIDER_LABEL: Record<AiProviderId, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    ollama: 'Ollama',
    kimi: 'Kimi',
};

export function ModelPicker({
    models,
    value,
    onChange,
    subtle,
}: {
    models: AiModelOption[];
    value: string;
    onChange: (id: string) => void;
    // Borderless variant for docking inside the composer card (a bordered
    // button inside the bordered composer reads heavy).
    subtle?: boolean;
}) {
    const groups = groupModelsByProvider(models);
    const current = models.find((m) => m.id === value);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    data-testid="ai-model-picker"
                    disabled={models.length === 0}
                    className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-small text-foreground transition-colors disabled:opacity-50',
                        subtle
                            ? 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                            : 'border border-border bg-card hover:bg-secondary',
                    )}
                >
                    <span className="max-w-[180px] truncate">
                        {current?.label ?? (models.length ? 'Pick a model' : 'No models')}
                    </span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
                {groups.map((group, gi) => (
                    <div key={group.provider}>
                        {gi > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className="text-muted-foreground">
                            {PROVIDER_LABEL[group.provider] ?? group.provider}
                        </DropdownMenuLabel>
                        {group.models.map((m) => (
                            <DropdownMenuItem
                                key={m.id}
                                onSelect={() => onChange(m.id)}
                                // Stack the name + a short capability note so the
                                // user picks on substance, not just a model id.
                                className="flex flex-col items-start gap-0.5 py-1.5"
                            >
                                <div className="flex w-full items-center justify-between gap-3">
                                    <span className="truncate text-foreground">{m.label}</span>
                                    {m.context ? (
                                        <span className="shrink-0 text-label text-muted-foreground">
                                            {Math.round(m.context / 1000)}k
                                        </span>
                                    ) : null}
                                </div>
                                {m.description ? (
                                    <span className="text-label leading-snug text-muted-foreground">
                                        {m.description}
                                    </span>
                                ) : null}
                            </DropdownMenuItem>
                        ))}
                    </div>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
