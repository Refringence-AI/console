# CLAUDE.md

Agent onboarding for `Refringence-AI/console`.

## What this repo is

A desktop GUI (Electron 35 + React 19) for aggregating project dev-state
across panels: Overview, Workboard, Repo, Architecture, Pipeline,
Services, Library, Release, Observability, Activity, Tutorials, Docs,
Settings. Local-first, no backend, no telemetry.

## Hard rules

### Documentation standard

Comments explain WHY. The code already says WHAT. Skip JSDoc that
describes obvious parameters. Skip "phase / round" footers in source
files. Skip marketing words ("comprehensive", "robust",
"production-ready", "modern"). No emoji in code or docs.

Commit subjects: imperative mood, ≤72 chars. Body explains rationale
and references issues by number. Use plain conventional-commits prefixes
(`feat`, `fix`, `chore`, `docs`, `refactor`).

### Code minimalism (Ponytail)

When adding code, first check whether existing primitives in
`console-electron/src/main/ipc/` or `console-shell/src/lib/` already
cover the case. Reuse over reinvention. Three similar lines beat a
premature abstraction. Don't add error handling for cases that can't
happen.

### No host-project coupling

This repo is being made project-agnostic (v0.2 onward). New IPC
handlers should:

- Resolve the project root from app state, not from hardcoded
  project-path constants.
- Use the project's git remote URL for GitHub-shaped reads, not a
  hardcoded repo string.
- Fail loudly when a required file is missing (throw a `code` +
  `message` JSON object); never silently return empty data.

### Bridge contract is the source of truth

`console-shell/src/lib/bridge.ts` defines the TypeScript surface of
`window.refringenceConsole`. The preload at
`console-electron/src/preload/preload.ts` and the main handlers at
`console-electron/src/main/ipc/*.ts` must stay in lock-step. Adding a
channel requires changes in all three in one commit. Tests check this
via `qa/tests/console/smoke-all-panels.spec.ts`.

### Light theme is the default

`<html data-theme="light">` set by `index.html` before React mounts.
Theme preference persists in `localStorage` under
`refringence-console-theme`. Console is light by default and shares
`packages/design-tokens/` with its sibling apps.

### No gradients, no glassmorphism

The icon (`utilities-terminal.svg`) has a deliberate refraction-on-
glass effect inside the CRT. That is the ONE place subtle gradients
appear. Component surfaces are flat: solid `--surface-*` colors over
solid `--border-*` borders. Hover states change tone, not opacity.

### Tests are serial, not parallel

`qa/playwright.config.ts` sets `fullyParallel: false` and the launch
command pins `--workers=1` for the `console` project. Each test spawns
a full Electron process; four parallel spawns hit OS resource limits
and `firstWindow` times out at 30s.

## Build

```bash
npm install --prefix console-shell
npm install --prefix console-electron
npm install --prefix qa
node qa/scripts/patch-playwright-node24.js   # required: Playwright 1.61 + Node 24 loader fix
```

## Run

```powershell
pwsh scripts/launch-console.ps1            # built
pwsh scripts/launch-console.ps1 -Dev       # Vite HMR
pwsh scripts/launch-console.ps1 -Build     # rebuild + run
```

## Known traps

- `ELECTRON_RUN_AS_NODE=1` env var (inherited from some dev shells)
  puts Electron in Node mode and breaks boot with `app is undefined`.
  The launch script unsets it; Playwright fixture filters it from the
  spawn env.
- Playwright 1.61's ESM loader calls `.includes()` on
  `context.conditions` which Node 24 changed from `Array<string>` to
  `Set<string>`. Patched via `qa/scripts/patch-playwright-node24.js`.
  Re-run after every `npm install --prefix qa`.
- Console reads data from a project directory. Without one, panels
  show empty state.

## Roadmap

v1 shipped (open-sourced under FSL). The v2 direction: multi-provider
AI + chat, a prompt library + dev-tool prompt-router, Slack issue pull,
a guided onboarding + a fetched tutorial carousel, a de-crowded shell
(collapsible rail + command palette + layout presets), a paginated
Guided-mode step bar, and the architecture-tool fix. Strict rule: fetch
UI from registries (21st.dev / shadcn), do not hand-build component
shells.

## When you start work

A future v0.2 direction is to read project state over an HTTP API
contract instead of direct filesystem reads. Not implemented yet.

## What NOT to do

- Don't add host-project-specific dependencies to `console-electron` or
  `console-shell`. Console is a standalone app: it must not bundle or
  depend on any external project's packages or subsystems.
- Don't add emoji to UI components or to commit messages.
- Don't write commit messages or PR descriptions in passive voice or
  marketing tone.
