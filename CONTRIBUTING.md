# Contributing

Console is licensed under the Functional Source License
(FSL-1.1-Apache-2.0); see LICENSE.md. Issues and PRs are welcome. By submitting a
PR you agree your contribution is licensed under the same terms.

Open an issue first describing the change. For UI work, attach current and
proposed screenshots of both the Guided and Operator persona where the change
is visible.

## Dev setup

Prerequisites: Node 22 or newer, and the GitHub `gh` CLI (authenticated) for the
Workboard panel. Each workspace has its own `package.json`.

```bash
git clone https://github.com/Refringence-AI/console
cd console
npm install --prefix console-shell
npm install --prefix console-electron
npm install --prefix qa
node qa/scripts/patch-playwright-node24.js   # re-run after every install --prefix qa
```

Run the dev build with Vite HMR (renderer in one shell, Electron in another), or
the built app:

```bash
npm --prefix console-shell run dev          # Vite on http://localhost:5174
npm --prefix console-electron run dev       # Electron against the dev server

npm --prefix console-electron run start     # build renderer + main, then launch
```

On Windows, `scripts/launch-console.ps1` wraps both (`-Dev` for HMR, `-Build` to
rebuild). It unsets `ELECTRON_RUN_AS_NODE`, which some dev shells inherit and
which breaks Electron boot.

## The four-file IPC rule

The renderer has no Node or filesystem access. It reaches main only through
`window.refringenceConsole`. Adding or changing an IPC channel touches four
files, and they must stay in lock-step in one commit:

1. `console-shell/src/lib/bridge.ts`: the typed contract. This is the source of
   truth for the surface.
2. `console-electron/src/preload/preload.ts`: the preload wrapper that exposes
   the channel to the renderer.
3. `console-electron/src/main/ipc/<panel>.ts`: the handler that does the work.
   Resolve the project root from app state, not hardcoded constants. Fail loudly when a
   required file is missing (throw a JSON object with `code` and `message`);
   never silently return empty data.
4. `console-electron/src/main/ipc/index.ts`: register the handler so it is wired
   up at startup.

`qa/tests/console/smoke-all-panels.spec.ts` checks that these stay aligned.

If you change any `.ts` or `.tsx`, run `npx tsc --noEmit` in the affected
package before committing.

## Writing conventions

These apply to code, comments, docs, and commit messages. CI enforces the
textual ones.

- No em-dashes (U+2014) anywhere. Use a comma, a colon, or two sentences.
- No banned marketing words: powerful, robust, comprehensive, seamless,
  leverage, gain insights into, actionable, AI-powered, next-generation.
- No emoji in doc headers, code, or commit messages.
- Comments explain why, not what. The code already says what.
- Be specific. Real numbers and concrete steps over generic phrasing.

## Commits

Conventional Commits: `type(area): subject`, imperative mood, subject 72
characters or fewer. Types are `feat`, `fix`, `chore`, `docs`, `refactor`,
`test`. The body explains the rationale and references issues by number. The
`auto(...)` prefix is reserved for automated commits; human commits do not use
it.

## Before you open a PR

1. `npx tsc --noEmit` clean in every package you touched.
2. Flip between the Guided and Operator personas and exercise the panel you
   changed in each. The split is a real feature difference, not a density
   toggle, so both paths need to hold up.
3. Run the e2e suite and keep it green; add coverage for any new IPC channel:

   ```bash
   cd qa
   npx playwright test --project=console --workers=1
   ```

See [CLAUDE.md](CLAUDE.md) for the full code and documentation standards.
