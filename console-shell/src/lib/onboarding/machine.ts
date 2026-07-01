// console-shell/src/lib/onboarding/machine.ts
//
// The multi-stage onboarding state machine. ONE machine drives both personas;
// persona is a render-density hint, not a different flow. Stages after the
// persona hero are shown on a stepper. `study` auto-advances to `report` once
// the intel mount finishes, so it shares the "Project" milestone.

import type { Persona } from '../persona';

export type OnbStage =
    | 'persona' | 'tour' | 'signin' | 'tools' | 'ai' | 'connect' | 'permission' | 'study' | 'report' | 'intent' | 'services' | 'done';

export type Intent = 'understand' | 'ship' | 'test' | 'observe' | 'secure';

// How the user wants Console to use AI (asked on the AI step).
export type AiMode = 'cloud' | 'keys' | 'local';

export interface OnbState {
    stage: OnbStage;
    persona: Persona | null;
    aiMode: AiMode | null;
    projectRoot: string | null;
    intents: Intent[];
}

export const INTENTS: { id: Intent; title: string; body: string; needs: string }[] = [
    { id: 'understand', title: 'Understand this project', body: 'Read its structure, stack, services, and architecture.', needs: 'No setup - Console reads the repo' },
    { id: 'ship', title: 'Deploy to production', body: 'Connect a host and ship it from here.', needs: 'Vercel, Netlify, Railway, or Render' },
    { id: 'test', title: 'Set up testing', body: 'Add a test harness and run it from one place.', needs: 'Vitest, Playwright, or your CI' },
    { id: 'observe', title: 'Monitor after shipping', body: 'Wire errors and analytics so problems are visible.', needs: 'Sentry, PostHog, or Datadog' },
    { id: 'secure', title: 'Harden and audit', body: 'Find secrets, weak configs, and risky dependencies.', needs: 'Runs locally - no service needed' },
];

// Linear order for Back / Next, BY PERSONA. The flow is the same machine; the
// pace differs. Guided (newbie) gets the hand-held path - a feature tour and a
// standalone sign-in step before the work begins. Operator (seasoned) skips both
// and drops straight into wiring AI, so the felt step count is lower.
const GUIDED_ORDER: OnbStage[] = ['persona', 'tour', 'signin', 'tools', 'ai', 'connect', 'permission', 'study', 'report', 'intent', 'services', 'done'];
const OPERATOR_ORDER: OnbStage[] = ['persona', 'tools', 'ai', 'connect', 'permission', 'study', 'report', 'intent', 'services', 'done'];

export function stageOrder(persona: Persona | null): OnbStage[] {
    return persona === 'seasoned' ? OPERATOR_ORDER : GUIDED_ORDER;
}

// The stepper milestones (persona is the hero, not a step). connect/study/report
// fold into one "Project" milestone since study auto-advances. Operator has no
// sign-in, so it loses the "Account" milestone - a shorter, denser stepper.
const ALL_STEP_DEFS = [
    { id: 'account', label: 'Account' },
    { id: 'tools', label: 'Your tools' },
    { id: 'ai', label: 'AI' },
    { id: 'project', label: 'Your project' },
    { id: 'intent', label: 'Goals' },
    { id: 'services', label: 'Connect' },
] as const;

export type StepDef = { id: string; label: string };

export function stepDefs(persona: Persona | null): readonly StepDef[] {
    return persona === 'seasoned' ? ALL_STEP_DEFS.slice(1) : ALL_STEP_DEFS;
}

function milestoneId(stage: OnbStage): string | null {
    switch (stage) {
        case 'signin': return 'account';
        case 'tools': return 'tools';
        case 'ai': return 'ai';
        case 'connect': case 'permission': case 'study': case 'report': return 'project';
        case 'intent': return 'intent';
        case 'services': return 'services';
        default: return null;
    }
}

export function milestoneFor(stage: OnbStage, persona: Persona | null): number {
    const defs = stepDefs(persona);
    // The success screen shows every milestone complete (current past the last).
    if (stage === 'done') return defs.length;
    const idx = defs.findIndex((d) => d.id === milestoneId(stage));
    return idx < 0 ? 0 : idx;
}

export function nextStage(s: OnbStage, persona: Persona | null): OnbStage {
    const order = stageOrder(persona);
    const i = order.indexOf(s);
    return order[Math.min(i + 1, order.length - 1)];
}

export function prevStage(s: OnbStage, persona: Persona | null): OnbStage {
    const order = stageOrder(persona);
    const i = order.indexOf(s);
    return order[Math.max(i - 1, 0)];
}
