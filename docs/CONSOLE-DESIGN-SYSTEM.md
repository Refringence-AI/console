# Console — Design System

Targets the Linear / Vercel / Raycast tier. Two modes (Guided = oriented
narrative, Operator = dense cockpit) share ONE token set and ONE component
library — mode changes density and copy, never the design language.

The design language rests on three rules: a single tight-tracked sans (no
editorial serif), exactly one disciplined cyan accent, and eight card
primitives in place of hand-rolled cards.

## A. Typography — drop the serif; Geist Sans everywhere, Geist Mono for numerals/code

Instrument Serif is an editorial display face that reads as "marketing." Linear/
Vercel/Raycast/shadcn run a single tight-tracked sans and earn "premium" from
spacing, weight, and restraint. Geist is already loaded and purpose-built for
this surface, so the move is subtractive.

Base body 13px. Headings carry negative tracking that scales with size; body
and below sit at 0; only the eyebrow goes positive. Global
`font-feature-settings: "cv01"`.

| Token | px | line-height | weight | tracking | Use |
|---|---|---|---|---|---|
| text-display | 32 | 40 | 600 | -0.04em | one big number/title; Guided hero; splash. Replaces serif heroes. |
| text-page-title | 22 | 28 | 600 | -0.022em | top of a route/panel. Guided next-step prose uses 500. |
| text-section | 16 | 22 | 600 | -0.012em | card group headers, settings sections. |
| text-card-title | 14 | 20 | 600 | -0.01em | title inside a card/row. |
| text-body | 13 | 20 | 400 | 0 | default everywhere. |
| text-body-strong | 13 | 20 | 500 | 0 | emphasis, active row, control text. |
| text-small | 12 | 16 | 400 | 0 | secondary/muted metadata, captions. |
| text-label | 11 | 16 | 500 | +0.04em uppercase | eyebrow over a section, micro-labels. |
| text-metric | 24 | 28 | 600 | -0.01em tabular-nums | KPI/stat readouts. |
| text-mono | 13 | 20 | 400 | 0 tabular-nums | code, paths, IDs, log lines — Geist Mono. |

Load Geist 400/500/600 only (drop 700, drop Instrument Serif). Never above 600
in chrome.

## B. Color — monochrome chrome + ONE restrained cyan brand accent

Pure-mono is anonymous; a rainbow chrome spends the color budget that makes
status read instantly. The disciplined middle (mono chrome + one cyan on
interactive/active/focus only) is Linear's playbook.

```css
:root { /* light */
  --accent:            oklch(0.68 0.145 215);
  --accent-foreground: oklch(0.985 0 0);
  --accent-solid:      oklch(0.58 0.13 210);
  --ring:              oklch(0.68 0.145 215);
  --accent-subtle:     oklch(0.68 0.145 215 / 0.10);
  --success: oklch(0.627 0.194 149.2); --success-fg: oklch(0.985 0 0); --success-text: oklch(0.520 0.150 150);
  --warning: oklch(0.769 0.188 70.08); --warning-fg: oklch(0.205 0 0);  --warning-text: oklch(0.560 0.130 65);
  --danger:  oklch(0.577 0.245 27.33); --danger-fg:  oklch(0.985 0 0); --danger-text:  oklch(0.540 0.220 27);
  --info:    oklch(0.546 0.245 262.9); --info-fg:    oklch(0.985 0 0); --info-text:    oklch(0.520 0.230 263);
}
.dark {
  --accent:            oklch(0.74 0.135 210);
  --accent-foreground: oklch(0.16 0 0);
  --accent-solid:      oklch(0.66 0.135 210);
  --ring:              oklch(0.74 0.135 210);
  --accent-subtle:     oklch(0.74 0.135 210 / 0.14);
  --success: oklch(0.723 0.190 149.6); --success-fg: oklch(0.205 0 0); --success-text: oklch(0.792 0.170 152);
  --warning: oklch(0.828 0.189 84.43); --warning-fg: oklch(0.205 0 0); --warning-text: oklch(0.860 0.150 88);
  --danger:  oklch(0.704 0.191 22.22); --danger-fg:  oklch(0.205 0 0); --danger-text:  oklch(0.730 0.180 22);
  --info:    oklch(0.707 0.165 254.6); --info-fg:    oklch(0.205 0 0); --info-text:    oklch(0.730 0.150 255);
}
```

Accent may appear ONLY on: active/selected nav (text + 2px indicator or
bg-accent-subtle); the focus ring; links/inline interactive text; the single
primary CTA per view; at most one "live/processing" affordance. Accent must NOT
appear on: status/health (use semantics), decorative borders/dividers/card
backgrounds, icons at rest, large fills, charts by default, or a second primary
action in one view.

Amber fill always takes dark text (text-warning-fg), never white. `--destructive`
aliases `--danger`. The old grey `--accent` hover role moves to `--accent-subtle`
/ `bg-muted` — audit `bg-accent` hovers and repoint to `bg-muted`.

One-accent-per-screen: at most one brand-cyan primary action + one ambient brand
moment per view. Status colors are exempt (they carry data).

## C. Spacing, radius, elevation

`--radius: 0.625rem` (10px) with the multiplier chain: sm = *0.6 (6px), md = *0.8
(8px), lg = var (10px), xl = *1.4 (14px).

| Element | Radius | Class |
|---|---|---|
| cards, panels, dialogs, popovers | 14px | rounded-xl |
| buttons, inputs, selects, badges, kbd | 8px | rounded-md |
| inner chips, version tags, nested, row hover | 6px | rounded-sm |
| avatars, status dots, toggles | full | rounded-full |

`rounded-2xl` is banned (the over-soft "vibe-coded" tell). Card padding: p-5
comfortable (Guided), p-4 standard (default/Operator), p-3 compact (dense rows).
One card = one padding value. Page section gap-6; card inner gap-4 (Guided) /
gap-3 (Operator).

Elevation: level-0 flat (border only, no shadow) = resting card; level-1
shadow-xs = interactive/hover; level-2 shadow-sm = popovers/dropdowns/palette;
level-3 shadow-md = modals over a scrim. Resting cards do NOT grow a shadow on
hover; interactive cards brighten the border to --border-hover and/or go
shadow-xs. In dark mode lean on border-brightening, not shadows.

## D. Eight primitives — console-shell/src/components/ui/

cva + cn(), each sets data-slot, tokens only.

- Card: `flex flex-col gap-3 rounded-xl border border-border bg-card text-card-foreground` + variant (elevated/interactive/feature) + padding (comfortable p-5 | standard p-4 | compact p-3). CardHeader/Title(text-card-title)/Description(text-small muted)/Content(gap-3)/Footer.
- Button (cva): primary (bg-accent-solid text-accent-foreground), default (bg-primary), secondary, outline, ghost, destructive (bg-danger text-danger-fg), link (text-accent). Sizes sm/default/lg/icon. focus-visible ring-[3px] ring-ring/50.
- Badge (cva): neutral/outline/success/warning/danger/info; square (rounded-md) | round (rounded-full); text-label; optional mono/mixed-case.
- Stat: Card interactive standard; StatLabel (text-label muted + icon), StatValue (text-metric tabular), StatHint (text-small muted), StatDelta (success/danger-text).
- SectionLabel: `text-label text-muted-foreground`.
- IconButton: Button size=icon, ghost default / outline when it needs a resting border.
- Separator: Radix Separator, bg-border, h-px/w-px by orientation.
- Kbd: `h-5 min-w-5 rounded-sm border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground`.
- EmptyState: dashed border-border rounded-xl p-10 center; icon size-8 muted, title text-section, body text-body muted, optional action Button.

## E. Delight (hand-built, prefers-reduced-motion gated)

CountUp on live metrics (framer useSpring stiffness 200 damping 30, tabular-nums);
gradient-border feature card (::before conic cyan->teal, mask-composite exclude;
static at rest, animate only the one "processing" node); shimmer skeleton
(replace animate-pulse; moving linear-gradient over --muted); optional cursor
spotlight on interactive cards; shiny status text for transient words only
("Building…"); optional inline sparkline in Stat. Every animation wraps in
`@media (prefers-reduced-motion: reduce) { animation: none }`.

## F. Conventions when adding UI

- Compose from the 8 primitives rather than hand-rolling a card.
- Sans only: no `fontFamily: var(--font-serif)` or `font-serif`; use
  text-display / text-page-title for headings.
- Cards use `rounded-xl` and one padding token; `rounded-2xl` is banned.
- Color via semantic tokens, never literals: `bg-success` not
  `bg-emerald-500`, `text-danger-text` not `text-rose-600`,
  `border-l-warning` not `border-l-amber-500`, `bg-muted-foreground` not
  `bg-slate-400`.
- Eyebrows use SectionLabel, key hints use Kbd, TopBar buttons use
  IconButton, metric tiles use Stat. `bg-accent` hovers repoint to
  `bg-muted`.

globals.css carries no `--font-serif`; `--radius` is `0.625rem` with the
multiplier chain; the accent + semantic token blocks, the `@theme inline`
`--color-*` bridges, and the type-scale tokens live here, with body
`font-feature-settings "cv01"`. index.html loads Geist 400;500;600 + Geist
Mono 400;500;600 only.
