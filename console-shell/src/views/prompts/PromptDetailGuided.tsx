import { useState } from 'react';
import { ClipboardCopy, Send, ArrowLeft, ArrowRight } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { Stepper, type StepDef } from '@/components/ui/stepper';
import type { PromptEntry } from '../../lib/bridge';
import { allFilled } from '../../lib/ai/interpolate';
import { PromptVariableForm } from './PromptVariableForm';

/**
 * Guided (newbie) detail surface. A calm, stepped flow instead of the dense
 * cockpit: confirm the pick, fill the blanks, then copy or send. No raw
 * template body and no {{var}} schema are shown to newcomers; each step says
 * plainly what to do next, and the action row is two plain buttons.
 */

const STEPS: StepDef[] = [
    { id: 'pick', label: 'Pick a prompt' },
    { id: 'fill', label: 'Fill the blanks' },
    { id: 'send', label: 'Copy or send' },
];

export function PromptDetailGuided({
    selected,
    values,
    onValues,
    onCopy,
    onSendToAi,
}: {
    selected: PromptEntry;
    values: Record<string, string>;
    onValues: (next: Record<string, string>) => void;
    onCopy: () => void;
    onSendToAi: () => void;
}) {
    // A prompt is already selected when this renders (the panel lands on the
    // first one), so the flow opens on the Fill step.
    const [step, setStep] = useState(1);
    const hasBlanks = selected.variables.length > 0;
    const ready = allFilled(selected.body, values);

    return (
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5 p-4" data-testid="prompt-detail">
            <p
                className="text-small leading-relaxed text-muted-foreground"
                data-testid="prompt-guided-helper"
            >
                Pick a prompt, fill in the blanks, then copy it or send it to your AI.
            </p>

            <Stepper steps={STEPS} current={step} onStepChange={setStep} />

            <div className="flex flex-col gap-1">
                <h2 className="text-section text-foreground">{selected.title}</h2>
                <span className="text-small text-muted-foreground">{selected.category}</span>
            </div>

            {step === 0 && (
                <Card className="gap-0 p-4">
                    <p className="text-body leading-relaxed text-foreground">
                        This is the prompt you picked. Choose a different one on the left at any
                        time, or move on to fill in its blanks.
                    </p>
                </Card>
            )}

            {step === 1 && (
                hasBlanks ? (
                    <PromptVariableForm
                        body={selected.body}
                        variables={selected.variables}
                        values={values}
                        onChange={onValues}
                    />
                ) : (
                    <Card className="gap-0 p-4">
                        <p className="text-body leading-relaxed text-foreground">
                            This prompt has no blanks to fill. Move on to copy it or send it to
                            your AI.
                        </p>
                    </Card>
                )
            )}

            {step === 2 && (
                <>
                    {/* Show the finished text so the newcomer sees what they will send. */}
                    <PromptVariableForm
                        body={selected.body}
                        variables={[]}
                        values={values}
                        onChange={onValues}
                    />
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
                            Send to your AI
                        </Button>
                    </div>
                </>
            )}

            {/* What to do next: one plain line plus Back / Next, so the flow never
                feels like it stops mid-way. */}
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-4">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0}
                    className="gap-1.5"
                    data-testid="prompt-guided-back"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                </Button>
                <span className="flex-1 text-center text-small text-muted-foreground">
                    {step === 0 && 'Next: fill in the blanks.'}
                    {step === 1 && (
                        hasBlanks
                            ? ready
                                ? 'All filled. Next: copy or send.'
                                : 'Fill each blank, then go to copy or send.'
                            : 'Next: copy or send.'
                    )}
                    {step === 2 && 'Copy it, or send it straight to your AI.'}
                </span>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                    disabled={step === STEPS.length - 1}
                    className="gap-1.5"
                    data-testid="prompt-guided-next"
                >
                    Next
                    <ArrowRight className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}
