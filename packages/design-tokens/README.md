# @refringence/design-tokens

Shared design tokens across Refringence apps. Each app picks its default
theme (Console defaults to light); the token set is the same.

## Usage

In any renderer's `globals.css`:

```css
@import "@refringence/design-tokens";
@import "tailwindcss";

@theme {
  /* Map design-tokens vars to Tailwind v4 token names. */
  --color-background:           var(--surface-primary);
  --color-foreground:           var(--text-primary);
  --color-card:                 var(--surface-secondary);
  --color-card-foreground:      var(--text-primary);
  --color-popover:              var(--surface-elevated);
  --color-popover-foreground:   var(--text-primary);
  --color-primary:              var(--accent);
  --color-primary-foreground:   var(--accent-fg);
  --color-muted:                var(--border-secondary);
  --color-muted-foreground:     var(--text-secondary);
  --color-border:               var(--border-primary);
  --color-input:                var(--border-secondary);
  --color-ring:                 var(--accent);
}
```

Then set `data-theme` on `<html>`. Each app picks its own default and stays
user-toggleable via Settings → Appearance:

```ts
// dark-default app:
document.documentElement.dataset.theme = useThemeStore().theme ?? 'dark';

// Console (light-default):
document.documentElement.dataset.theme = useThemeStore().theme ?? 'light';
```

## Tokens

Every consumer references variables by **semantic name**, not by hex
literal. Adding a new surface? Add a new variable to `tokens-dark.css`
+ `tokens-light.css`, then reference it from the renderer.

### Surfaces

- `--surface-primary` — main chrome background
- `--surface-secondary` — cards on chrome
- `--surface-elevated` — popovers, dropdowns, dialogs
- `--surface-overlay` — side rails, hover states

### Text

- `--text-primary` — body, headings
- `--text-secondary` — captions, muted labels
- `--text-tertiary` — placeholders, disabled

### Borders

- `--border-primary` — subtle separators
- `--border-secondary` — defined card borders
- `--border-hover` — hover / focus bump

### Accent

- `--accent` — Refringence cyan; SAME hue across both themes
- `--accent-muted` — for highlights, focus rings
- `--accent-fg` — foreground on accent fills

### Status

- `--status-success` / `--status-warning` / `--status-danger` /
  `--status-info` / `--status-neutral`

### Chart accents

- `--chart-1` ... `--chart-5` — stable per-section accents (Project,
  Search, VCS, Tools, Firmware mappings)

### Scale

- `--radius-sm` / `-md` / `-lg` / `-xl`
- `--ease-out-soft` / `-in-out-fast`
- `--density-row-h` / `-card-pad` / `-shell-gap`
- `--z-base` / `-card` / `-popover` / `-modal` / `-toast` / `-tooltip`

## Hard rules

- NO gradients in `tokens-*.css` (or in any consumer component).
- NO arbitrary Tailwind colour literals in components — every colour
  via these CSS variables.
- NO emoji in token names or values.
- NO inline `style={{ color: '#abc' }}` props.
- Surface-elevation differences are discrete lightness steps; do not
  add intermediate values without consensus.

These rules are checked in CI on every commit touching a renderer's
`src/styles/` directory.

## Convergence plan

Where a renderer's `globals.css` still defines its own @theme block in
parallel with this package, the goal is to drop the duplicates and
`@import "@refringence/design-tokens"` instead.
