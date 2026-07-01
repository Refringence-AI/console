# console-shell — package conventions

Console's React renderer. Read the root [../CLAUDE.md](../CLAUDE.md)
first; it owns the cross-package hard rules. This file covers only what is
specific to the renderer.

## Shape

- Entry: `src/main.tsx` — StrictMode + `QueryClientProvider` + `RouterProvider`.
- Routing: `src/router.tsx` — `createMemoryRouter` (Electron has no URLs).
- Shell: `src/views/_shell/` — `ConsoleShell` lays out `TopBar` + `Sidebar`
  + the routed panel. `WindowControls` draws the frameless caption buttons.
- Panels: one directory per panel under `src/views/<panel>/` (overview,
  issues, docs, repo, arch, observability, release, …). The panel's entry
  component is `<Name>Panel.tsx`.
- IPC seam: `src/lib/bridge.ts` types `window.refringenceConsole`; the
  query hooks in `src/lib/queries/<panel>.ts` wrap each call in react-query.

## Build

- `npm run dev` — Vite on port 5174.
- `npm run build` — `tsc -b && vite build` to `dist/`.
- `npm run typecheck` — `tsc --noEmit`. Run after any `.ts`/`.tsx` change.

## Persona dispatcher

Two personas drive UX defaults: Guided (newcomers) and Operator (senior
engineers). Internally they are the enum values `newbie` / `seasoned`
(`src/lib/persona.ts`) so persisted state and test selectors don't churn;
the UI only ever shows the labels Guided / Operator via `PERSONA_LABEL`.

A panel reads the persona through `usePersonaMode()` and forks at the top:

```tsx
export function DocsPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <DocsNewbie />;
    return <DocsSeasoned />;
}
```

The Guided variant lives in `<Name>Newbie.tsx` alongside the panel. The
hook persists to `localStorage` under `refringence-console-persona` and
broadcasts a `console-persona-change` window event, so flipping the
persona in one mounted view updates every other view without a reload.
Default when nothing is stored is `seasoned`.

## The bridge + queries seam

`bridge.ts` is the renderer's view of the typed IPC surface and the source
of truth for its TypeScript shape. It MUST stay in lock-step with
`../console-electron/src/preload/preload.ts` and the main handlers. Adding
a channel touches three files in one commit: the method on `ConsoleBridge`
here, the preload wrapper, and the main handler.

Never call `bridge.*` directly from a component. Route every read through a
hook in `src/lib/queries/<panel>.ts` so caching, `staleTime`, and `enabled`
gates live in one place:

```ts
export function useDocsList() {
    return useQuery({
        queryKey: ['docs', 'list'],
        queryFn: () => bridge.docs.list(),
        staleTime: 60_000,
    });
}
```

When the bridge is absent (Vite dev without Electron), `bridge.ts` falls
back to a stub that throws on call, so a missing preload fails loudly
rather than silently returning `undefined`.

## Design system

- Type face: Geist (sans) + Geist Mono. Weights 400/500/600 only. Loaded
  via the Google Fonts `<link>` in `index.html` so the first paint has
  them. The serif is retired — `--font-serif` aliases `--font-sans`.
- Type scale: the `@theme` block in `src/styles/globals.css` defines
  `text-display` through `text-metric` (each carries size + line-height +
  tracking + weight). Use those utilities; don't hand-set `text-[..px]`.
- One accent: `--accent` (cyan) is for interactive / active / focus only.
  It is NEVER a status color.
- Status is semantic, not literal: `success` / `warning` / `danger` /
  `info`, each with a `-foreground` (text on the solid fill) and a `-text`
  (colored text/icon on the page). Read status from these tokens.
- Primitives: shadcn components under `src/components/ui/` (button, badge,
  card, table, dialog, …). Compose these before reaching for raw markup.

### Hard rules

- NO gradients and NO glassmorphism in components. Surface elevation is
  discrete lightness steps; if you need a new one, add a token, don't fake
  it with opacity. (The animated feature-card ring in `globals.css` is the
  single sanctioned spectrum hint.)
- NO arbitrary Tailwind color literals. Every color resolves through a CSS
  var bridged in the `@theme inline` block.
- NO emoji in UI strings.
- NO banned marketing words in copy: powerful, robust, comprehensive,
  seamless, leverage, gain insights into, actionable, AI-powered,
  next-generation. NO em-dashes (U+2014).

### Theme

Light is the default. The pre-paint script in
`index.html` adds `.dark` to `<html>` if `localStorage` holds `dark` under
`refringence-console-theme`, avoiding a flash of the wrong theme. Tokens
come from `globals.css`; the dark variant is the `.dark` class block.

## State libraries

| Need | Library |
|------|---------|
| Server state (IPC reads) | `@tanstack/react-query` v5 — all reads via `lib/queries/` |
| Tables | `@tanstack/react-table` v8 |
| Graph canvas | `@xyflow/react` v12, custom nodes keyed by `data.kind` |
| Routing | `react-router` 7 memory router |
| Charts | `recharts` plus inline-SVG sparklines for single-line cases |

## Testing UI behaviour

Type checking proves the code compiles, not that the feature works. When
you change a panel:

1. Build the renderer and run the Playwright specs in
   `../qa/tests/console/` (`npm test` from the repo root).
2. Exercise both personas. The persona fork is the most common regression:
   a change to the Operator view that silently breaks the Guided variant
   passes `tsc` but fails the user. Flip persona and walk the panel.
3. New panels must expose a stable `data-testid` (e.g. `docs-panel`) and an
   `<h1>` matching the panel name — `smoke-all-panels.spec.ts` asserts both
   for every panel and gates CI.
