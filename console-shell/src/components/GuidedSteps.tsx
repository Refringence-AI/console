// console-shell/src/components/GuidedSteps.tsx
//
// Reusable shell for Guided-mode complex panels: a labelled horizontal
// step bar on top, paginated content in the middle, and Back / Next
// controls at the bottom. Real panels wire into this in later phases
// (P3 onboarding, P4 AI wizard); here it is the shell plus a demo route.
import { type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Stepper, type StepDef } from '@/components/ui/stepper';
import { Button } from '@/components/ui';

export type GuidedStep = StepDef;

export function GuidedSteps({
    steps,
    current,
    onStepChange,
    onComplete,
    nextLabel = 'Next',
    backLabel = 'Back',
    nextDisabled = false,
    children,
    className,
}: {
    steps: GuidedStep[];
    current: number;
    onStepChange: (index: number) => void;
    /** Fired when Next is pressed on the last step. */
    onComplete?: () => void;
    nextLabel?: string;
    backLabel?: string;
    nextDisabled?: boolean;
    children: ReactNode;
    className?: string;
}) {
    const atFirst = current <= 0;
    const atLast = current >= steps.length - 1;

    function back() {
        if (!atFirst) onStepChange(current - 1);
    }
    function next() {
        if (atLast) onComplete?.();
        else onStepChange(current + 1);
    }

    return (
        <div data-testid="guided-steps" className={`flex h-full min-h-0 flex-col ${className ?? ''}`}>
            <div className="shrink-0 px-2 pb-4 pt-2">
                <Stepper steps={steps} current={current} onStepChange={onStepChange} />
            </div>

            <div data-testid="guided-steps-content" className="min-h-0 flex-1 overflow-y-auto px-1">
                {children}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-border px-2 pb-1 pt-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={back}
                    disabled={atFirst}
                    data-testid="guided-steps-back"
                    className="gap-1.5"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {backLabel}
                </Button>
                <Button
                    variant="default"
                    size="sm"
                    onClick={next}
                    disabled={nextDisabled}
                    data-testid="guided-steps-next"
                    className="gap-1.5"
                >
                    {atLast ? 'Done' : nextLabel}
                    {!atLast && <ChevronRight className="h-3.5 w-3.5" />}
                </Button>
            </div>
        </div>
    );
}
