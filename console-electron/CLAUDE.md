# console-electron — package conventions

Console's Electron main process (TypeScript, `tsc`-compiled to
CommonJS). Read the root [../CLAUDE.md](../CLAUDE.md) first; it owns the
cross-package hard rules. This file covers only the main process.

## Shape

- Entry: `src/main/main.ts` — owns `app`, the single `BrowserWindow`,
  lifecycle, and the EPIPE swallow.
- Preload: `src/preload/preload.ts` — `contextBridge` exposes
  `window.refringenceConsole`.
- IPC handlers: one file per panel under `src/main/ipc/<name>.ts`, each
  exporting a `register<Name>Handlers()`. `ipc/index.ts` imports and calls
  every one from `registerAllConsoleIpc()`, invoked from `main.ts` after
  `app.whenReady()`.

## Build

- `npm run build:main` — `tsc -p tsconfig.json` to `dist/main/`.
- `npm run dev` — launches Electron with `REFRINGENCE_CONSOLE_DEV=1`
  pointing at the console-shell Vite dev server on port 5174.

## The four-file IPC pattern

A channel is real only when these four edits land in one commit. Skipping
any one leaves the renderer typed against a channel that does not answer.

1. Handler: add `ipcMain.handle('console:<thing>', …)` inside a
   `register<Name>Handlers()` in `src/main/ipc/<name>.ts`.
2. Registration: import and call it in `src/main/ipc/index.ts`.
3. Preload wrapper: add the matching `ipcRenderer.invoke('console:<thing>', …)`
   to `src/preload/preload.ts` under the same namespace.
4. Typed surface + stub: add the method to `ConsoleBridge` and its stub
   fallback in `../console-shell/src/lib/bridge.ts`.

Run `npm run build:main` (and console-shell `typecheck`) after.

## Never throw across IPC

A handler that throws rejects the renderer's `invoke()` and usually shows
up as an unhandled rejection, not a useful error. Handlers return a result
shape instead. Two patterns are in use here:

- A `{ ok: boolean; error?: string }` (or richer) object for actions, e.g.
  `console:openPath` returns `{ ok: false, error }` rather than throwing.
- A `try { … } catch { return <safe default> }` wrapper for reads, e.g.
  `console:runner.start` returns `{ runId: '' }` on bad input instead of
  raising.

When a required file is genuinely missing, fail loudly by returning a
`{ code, message }` object the renderer can render — never silently return
empty data that the UI cannot distinguish from "no results."

## The runner

`ipc/runner.ts` is the streaming process substrate. The renderer never
sends a shell string: it picks a `RunnerKind` (`npm | gh | playwright |
node`) that `resolveCommand()` maps to a resolved binary, and the child is
spawned with `shell: false` and `windowsHide: true`. `cwd` is traversal-
guarded (rejects `..`) and defaults to the project root. Lifecycle mirrors
the other spawning handlers: SIGTERM then SIGKILL after a grace period, a
default timeout, and a single `exit` resolution. Output streams to the
renderer over `console:runner.output` / `console:runner.complete` and to a
best-effort `run.log`.

## Process safety

`main.ts` swallows EPIPE in its `uncaughtException` handler (a closed stdout
pipe must not crash the app) and logs everything else. `webPreferences`
keeps `contextIsolation: true` and `nodeIntegration: false`; the renderer
reaches main only through the preload bridge.

## Frameless window

The `BrowserWindow` is constructed with `frame: false`. There is no
OS-drawn caption and no `titleBarOverlay`. The renderer draws the minimize /
maximize / close buttons (`WindowControls.tsx`) and drives them through the
`console:window.*` handlers in `ipc/window.ts`. `toggleMaximize` returns the
resulting maximized state so the renderer can swap its icon without a
round-trip. Do not reintroduce an OS overlay — it produces a color seam
around the buttons that the frameless approach exists to avoid.

## Standalone-app boundary

Console is a self-contained Electron app. NEVER import from another
project's packages or reuse its IPC channels. Console writes only to its
own `<userData>/Console/`; any paths it reads from an opened project are
read-only.
