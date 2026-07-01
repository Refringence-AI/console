// console-shell/src/views/_shell/GuidedStepsDemo.tsx
//
// Tiny demo route that exercises the GuidedSteps shell. Real Guided-mode
// panels reuse <GuidedSteps> in later phases; this just proves the shell
// paginates and the step bar tracks state.
import { useState } from 'react';
import { GuidedSteps } from '@/components/GuidedSteps';

const STEPS = [
    { id: 'connect', label: 'Connect' },
    { id: 'describe', label: 'Describe' },
    { id: 'review', label: 'Review' },
    { id: 'send', label: 'Send' },
];

const BODY: Record<string, { title: string; blurb: string }> = {
    connect: { title: 'Connect a source', blurb: 'Pick the project this flow runs against.' },
    describe: { title: 'Describe the task', blurb: 'Say what you want done in one line.' },
    review: { title: 'Review the plan', blurb: 'Check the filled-in details before you commit.' },
    send: { title: 'Send it', blurb: 'Hand the ready step to the right tool.' },
};

export function GuidedStepsDemo() {
    const [current, setCurrent] = useState(0);
    const step = STEPS[current];
    const body = BODY[step.id];

    return (
        <div className="flex h-full min-h-0 flex-col p-6" data-testid="guided-demo-panel">
            <h1 className="mb-4 text-page-title text-foreground">Guided steps</h1>
            <div className="min-h-0 flex-1 rounded-lg border border-border bg-card p-4">
                <GuidedSteps steps={STEPS} current={current} onStepChange={setCurrent}>
                    <div className="flex flex-col gap-2 p-4">
                        <h2 className="text-body-strong text-foreground">{body.title}</h2>
                        <p className="text-body text-muted-foreground">{body.blurb}</p>
                    </div>
                </GuidedSteps>
            </div>
        </div>
    );
}
