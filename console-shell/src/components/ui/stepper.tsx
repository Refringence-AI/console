import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Horizontal numbered stepper.
 *
 * Vendored locally because the shadcn.io registry that hosts
 * "stepper-horizontal-numbered" now gates downloads behind an account
 * token, so `npx shadcn add` cannot reach it. This keeps the same
 * contract a registry stepper would give: numbered circles, a labelled
 * caption per step, and three visual states. Colours come from the
 * Tailwind v4 @theme tokens, not hardcoded values.
 */

export type StepState = 'completed' | 'active' | 'upcoming';

export type StepDef = {
    id: string;
    label: string;
    /** Optional one-line caption under the label. */
    description?: string;
};

function stateFor(index: number, current: number): StepState {
    if (index < current) return 'completed';
    if (index === current) return 'active';
    return 'upcoming';
}

export function Stepper({
    steps,
    current,
    onStepChange,
    className,
}: {
    steps: StepDef[];
    current: number;
    /** Fired when a completed (or current) step circle is clicked. */
    onStepChange?: (index: number) => void;
    className?: string;
}) {
    return (
        <ol
            data-slot="stepper"
            className={cn('flex w-full items-start', className)}
            aria-label="Progress"
        >
            {steps.map((step, i) => {
                const state = stateFor(i, current);
                const isLast = i === steps.length - 1;
                // Only let a user jump back to a step they have reached.
                const clickable = !!onStepChange && i <= current;
                return (
                    <li
                        key={step.id}
                        data-step-state={state}
                        className={cn('flex min-w-0 flex-1 items-start', isLast && 'flex-none')}
                    >
                        <div className="flex min-w-0 flex-col items-center">
                            <button
                                type="button"
                                disabled={!clickable}
                                onClick={clickable ? () => onStepChange?.(i) : undefined}
                                aria-current={state === 'active' ? 'step' : undefined}
                                className={cn(
                                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-small font-medium transition-colors',
                                    state === 'completed' && 'border-accent bg-accent text-accent-foreground',
                                    state === 'active' && 'border-accent bg-accent-subtle text-accent',
                                    state === 'upcoming' && 'border-border bg-card text-muted-foreground',
                                    clickable && 'cursor-pointer',
                                )}
                            >
                                {state === 'completed' ? (
                                    <Check className="h-3.5 w-3.5" />
                                ) : (
                                    <span>{i + 1}</span>
                                )}
                            </button>
                            <div className="mt-1.5 flex max-w-[8rem] flex-col items-center text-center">
                                <span
                                    className={cn(
                                        'truncate text-small',
                                        state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                                    )}
                                >
                                    {step.label}
                                </span>
                                {step.description && (
                                    <span className="truncate text-label text-muted-foreground">
                                        {step.description}
                                    </span>
                                )}
                            </div>
                        </div>
                        {!isLast && (
                            <div
                                aria-hidden="true"
                                className={cn(
                                    'mt-3.5 h-px flex-1',
                                    i < current ? 'bg-accent' : 'bg-border',
                                )}
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
