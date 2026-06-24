# Onboarding (first-run wizard)

The multi-stage first-run flow that takes a new user from "I opened Console" to
"Console understands my project and my services are within reach". One state
machine drives both personas; persona is a render-density hint, not a separate
flow.

## Flow

```
persona  ->  signin  ->  ai  ->  connect  ->  study  ->  report  ->  intent  ->  services  ->  done
(hero)       Account     AI       Your project (live read)  ...        Goals      Connect
```

- **persona** - the calm landing hero (split: copy left, a live `ProjectPreview`
  of the user's own project on the right). Picking "Get started" (Operator) or
  "Guide me through it" (Guided) writes the persona and enters the stepped flow.
- **signin** - optional. Continue with GitHub (real `gh` login), an email field
  for the coming Console-cloud account, or skip and stay local.
- **ai** - "How should Console use AI?" A Vercel-style selectable option-card
  picker: **Console cloud** (`soon`), **your own API key** (provider dropdown +
  key input that validates and shows a connected success row), or **local model**
  (Ollama detect). The chosen mode is remembered.
- **connect** - point Console at a project folder. Pre-filled if a project is
  already active for the window; shows a confirmed-folder card.
- **study** - the live intel mount: a streamed checklist (detect languages,
  count LOC, map deps, read docs, find services, inspect CI, score health) over
  the `console:intel.mount.*` events. Auto-advances to `report` when the
  deterministic read finishes.
- **report** - what Console learned: health ring, title, AI narrative,
  framework chips, and four stat tiles. This is the user's home base.
- **intent** - "What do you want to do?" Multi-select goals (understand / deploy
  / test / monitor / secure) that later steer suggestions and service priority.
- **services** - GitHub first (powers the workboard, pipeline, releases), then
  the services Console detected in the repo, ready to connect from the Services
  panel.
- **done** - success screen; every milestone shows complete; opens the Overview.

The stepper collapses these into five milestones: **Account · AI · Your project ·
Goals · Connect** (`connect/study/report` share "Your project" because `study`
auto-advances).

## Layout

The stepped flow is a single bounded panel (`rounded-2xl border bg-card shadow`)
centred on the dot-grid `HeroBackground`. The backdrop makes the surround read as
intentional atmosphere at any step height, so a short step (sign in) and a tall
step (AI with the keys panel open) both look composed rather than floating in
dead space. It is the Vercel card-on-backdrop pattern. Step content stays
neutral-inverted CTAs, hairline borders, one restrained accent.

## Code

| Concern | File |
|---|---|
| State machine (stages, AI mode, milestones, INTENTS) | [console-shell/src/lib/onboarding/machine.ts](../console-shell/src/lib/onboarding/machine.ts) |
| Streamed study read (mount events -> checklist + profile) | [console-shell/src/lib/onboarding/useMount.ts](../console-shell/src/lib/onboarding/useMount.ts) |
| Wizard shell (persona hero + stepped panel + footer) | [console-shell/src/views/welcome/OnboardingWizard.tsx](../console-shell/src/views/welcome/OnboardingWizard.tsx) |
| Step components (sign in, AI picker, study, report, intent, services, done) | [console-shell/src/views/welcome/onboardingSteps.tsx](../console-shell/src/views/welcome/onboardingSteps.tsx) |

Components come from the shadcn family (`Select`, `Input` + `Label`, `Badge`,
`Button`, `radio-group`); no hand-rolled component shells. Add a fetched
component with `npx shadcn@latest add <name>`.

State persists per window: persona (`writePersona`), active project
(`writeActiveProject`), and the onboarded flags (`writeOnboarded` +
`writeOnboardedForWindow`). The router gate sends a window to `/welcome` until it
has a persona and either an active project or the onboarded flag.
