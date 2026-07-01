# qa — Playwright e2e for Console

End-to-end coverage that launches the real Electron app and drives the real
renderer. Read the root [../CLAUDE.md](../CLAUDE.md) first.

## Layout

- `tests/console/` — the specs. One file per concern (`boot`, `theme`,
  `navigation`, `repo`, `docs`, `issues`, `observability`, `release`,
  `minimal`) plus the cross-cutting `smoke-all-panels.spec.ts`.
- `tests/console/_fixture.ts` — the launch fixture every spec imports.
- `scripts/patch-playwright-node24.js` — a required loader patch (below).

## Running

From the repo root:

```
npm test          # npm --prefix qa test -- --project=console --workers=1
```

`--workers=1` is mandatory, not an optimization. Each test spawns a full
Electron process; parallel spawns hit OS resource limits and `firstWindow`
times out at 30s.

The build must exist first — the fixture throws a clear error pointing at
`console-electron/dist/main/main.js` if you forgot to run `npm run build`.

## The fixture

`_fixture.ts` extends Playwright's base `test` with four fixtures:

- `consoleApp` — the launched `ElectronApplication`.
- `consoleWindow` — its first `Page`, after `domcontentloaded`.
- `tempUserData` — a throwaway `userData` dir, removed after the test, so
  no spec pollutes another's persisted state (theme, persona, views).
- `artifactsDir` — a per-test dir under
  `.refringence-qa/runs/<runId>/console-traces/<test>/` for traces and any
  captures. `runId` comes from `REFRINGENCE_RUN_ID` or a local timestamp,
  so a run's artifacts are grouped and re-runnable.

Launch hardening worth knowing:

- `ELECTRON_RUN_AS_NODE` is stripped from the spawn env. A parent shell
  (Cursor, Antigravity, some WSL setups) that inherited it puts Electron in
  Node mode and breaks boot with `app is undefined`.
- The app is launched with `--qa-mode` and `REFRINGENCE_CONSOLE_QA_MODE=1`,
  pointed at the temp `userData` via `REFRINGENCE_CONSOLE_USER_DATA`.

## Conventions

- Drive the UI through stable `data-testid` selectors and the `nav
  a[href="/<panel>"]` links, plus `main h1` for the panel title. Avoid
  text-content selectors that churn with copy edits, except where the test
  is specifically asserting copy (e.g. the brand strip).
- Assert no `console.error` / `pageerror` across the flow. Filter only the
  informational Electron warnings (`Electron Security Warning`, `Insecure
  Content-Security-Policy`) — see `smoke-all-panels.spec.ts` for the
  pattern. A new real renderer error must fail the spec.
- For IPC-shape checks, call the bridge directly inside
  `consoleWindow.evaluate(() => window.refringenceConsole.<ns>.<m>())` and
  assert the returned shape, as `repo.spec.ts` does.
- Artifacts (traces, screenshots) go under the fixture's `artifactsDir`,
  never committed loose into `qa/`.

## The persona-flip regression

The renderer forks every panel on persona (Guided vs Operator; see
`../console-shell/CLAUDE.md`). The persona is `localStorage` state under
`refringence-console-persona`, so the `tempUserData` fixture starts each
spec from the default (`seasoned` / Operator). To exercise the Guided
variant, set the key before reload, e.g.:

```ts
await consoleWindow.evaluate(() =>
    localStorage.setItem('refringence-console-persona', 'newbie'));
await consoleWindow.reload();
```

then assert the `<Name>Newbie` surface. This is the most common regression:
a change to the Operator view that silently breaks the Guided fork passes
`tsc` but fails the user.

## Adding a spec

1. Create `tests/console/<concern>.spec.ts` importing `test` and `expect`
   from `./_fixture`.
2. Navigate via the sidebar link, wait for the panel's `data-testid`, then
   assert behaviour through testids.
3. New panels must declare a `data-testid` and an `<h1>` matching the panel
   name — `smoke-all-panels.spec.ts` asserts both for every panel and gates
   CI, so a panel that forgets either turns the smoke red.

## Known trap

Playwright 1.61's ESM loader calls `.includes()` on `context.conditions`,
which Node 24 changed from `Array<string>` to `Set<string>`. Run
`node qa/scripts/patch-playwright-node24.js` (idempotent) after every
`npm install` in `qa/`. Without it, every spec fails at import with
`context.conditions?.includes is not a function`.
