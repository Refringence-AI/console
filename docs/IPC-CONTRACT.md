# IPC contract

The renderer (`console-shell`) and the Electron main process
(`console-electron`) share no memory. Every call between them crosses one
seam, made of three files that must stay in lock-step:

| Layer | File | Owns |
| --- | --- | --- |
| Renderer surface | `console-shell/src/lib/bridge.ts` | The typed `ConsoleBridge` interface and the `bridge` object the React code imports. |
| Bridge wiring | `console-electron/src/preload/preload.ts` | Maps each method to an `ipcRenderer.invoke(channel, ...args)` and exposes the object on `window.refringenceConsole` via `contextBridge`. |
| Handlers | `console-electron/src/main/ipc/<panel>.ts` | One `ipcMain.handle(channel, ...)` per channel. Registered in `ipc/index.ts`. |

There is no other cross-process path. The renderer never opens a socket,
never spawns a child process, never reads the filesystem. If the renderer
needs something main-side, it goes through this seam.

## Channel naming

Every channel is a string `console:<panel>.<action>`, namespaced so a
stray listener from another preload cannot collide with Console's own
channels. Examples:

```
console:getVersion
console:release.list
console:arch.overlay.write
console:runner.output          (main -> renderer event, not a handle)
```

Request/response channels use `ipcRenderer.invoke` + `ipcMain.handle`.
Push channels (the runner's streaming output, the window maximize-change
event) use `ipcRenderer.on` + `webContents.send`; the preload returns an
unsubscribe function so React effects can clean up.

## The contract: three edits per channel

`bridge.ts` is the source of truth for the shape. To add or change a
channel, edit all three layers in the same commit:

1. Add the typed method to the `ConsoleBridge` interface in `bridge.ts`,
   and add its stub to the fallback object at the bottom of the file
   (the stub used when `window.refringenceConsole` is absent, for example
   under Vitest or a browser preview).
2. Add the matching wrapper to `preload.ts`, calling
   `ipcRenderer.invoke('console:<panel>.<action>', ...args)`.
3. Add `ipcMain.handle('console:<panel>.<action>', ...)` in
   `console-electron/src/main/ipc/<panel>.ts` and register the module in
   `ipc/index.ts` if it is new.

Nothing enforces that the three layers agree at runtime; the typecheck in
`.github/workflows/quality.yml` catches a `bridge.ts` shape that the
renderer misuses, but it cannot see that a preload wrapper or a handler
drifted from it. Treat `bridge.ts` as the spec and diff the other two
against it when you touch this seam.

## Security posture

- `contextIsolation` stays on; the renderer only ever sees the frozen
  object `contextBridge` exposes, never `ipcRenderer` itself.
- Handlers validate their arguments. `console:openExternal` rejects any
  URL whose scheme is not `https`, `file`, or `mailto`. The runner
  refuses a raw shell string: the renderer picks a `kind`
  (`npm | gh | playwright | node`) that maps main-side to a resolved
  binary, so the renderer cannot ask main to execute arbitrary commands.
- Connection tokens (GitHub, Vercel, Sentry) never cross back to the
  renderer. The renderer receives metadata only (`connected`, `login`,
  `connectedAt`); the secrets stay in `electron-store` main-side.

## Deprecation note

This is the only seam, but it has two known drifts where `preload.ts`
accepts an argument the `bridge.ts` type does not yet declare. They are
backward compatible (the extra argument is optional) and slated to be
reconciled in `bridge.ts`:

- `issues.detail(num)` in `bridge.ts` versus `detail(num, repo?)` in
  `preload.ts`. The handler reads the optional `repo`; the type will gain
  it.
- `issues.relabel({ number, addLabels?, removeLabels? })` in `bridge.ts`
  versus the same plus `repo?` in `preload.ts`.

When reconciling, widen the `bridge.ts` type to match the preload rather
than narrowing the preload, so existing callers keep working. Do not
remove a channel without a renderer-side deprecation pass first: search
`console-shell/src` for the method, since a stale call compiles against
the stub fallback and fails only at runtime.
