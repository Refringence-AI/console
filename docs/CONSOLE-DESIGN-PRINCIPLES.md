# Console design principles

The discipline that makes Console feel like a tool a developer wants to open. Distilled from research into Linear, Stripe, Vercel, Sentry, and Cal.com. Apply these rules when adding any new panel, tile, copy block, or interaction.

## Visual

**Light-first, flat, no gradients in components.** Console defaults to light. The `tokens-light.css` palette is near-white. The CLAUDE.md rule "no gradients, no glassmorphism" applies to every surface except the icon and the single HeroTile background accent. Every new component should pass the test: does this look like it belongs in a Stripe docs page, or does it look like it belongs in a dark SaaS marketing site?

**One accent color per screen.** Linear uses purple exactly on the active nav item, the selected issue, and the primary button. Console uses cyan (`--accent`) on the active sidebar item, primary CTAs, and status indicators where cyan is the correct semantic tone. Everything else is neutral. The HeroTile's `from-accent/[0.04]` gradient is calibrated at the threshold of "noticeable but not decorative" and stays there.

**Density by default.** Linear's compact rows fit 30 issues in one screen. Console ships at this density rather than starting spacious and adding a compact toggle. The Workboard, Activity, Repo, and Workboard table views all use Linear-density rows: priority dot, title, label chips, no wasted whitespace.

**Hover reveals affordance.** Chevrons, drag handles, action menus appear on hover, not permanently. The current `Tile.tsx` does this with `group-hover:text-muted-foreground group-hover:translate-x-0.5`. Every navigable row follows this pattern.

**No modal hell.** Issue detail, eval run detail, and doc viewer all use right-panel slide-ins (Radix Sheet), not Dialog modals. Inline editing wherever possible.

**Status dots everywhere.** Datadog and Sentry train users to read status pills at a glance. Every Tile in Console should show a status dot, not just the hero Release tile.

## Information architecture

**Hierarchy matches developer mental models.** Vercel groups products as "Core Platform / AI Stack / Security" rather than alphabetically. Console groups its panels as "Build / Ship / Workbench". Sidebar order reflects this mental model.

**Progressive disclosure.** Stripe's customizable widget grid with most widgets off by default. Console's Overview ships with curated tiles in three Bands (Now, Build health, Codebase). The Settings panel has three tiers: Personal preferences, Project config, Per-panel settings.

**Restrained navigation.** Vercel labels nav items in one line. Console sidebar items are short. Resist growing past 12 panels without a grouping layer.

**Empty states are instructions, not apologies.** "No runs yet, Evals -> Promptfoo" beats "No data available". Every empty state tells the user exactly what to do next.

**Context to fix.** Sentry's Issue Detail page surfaces error, stack trace, release context, and breadcrumbs in one view. Console's Workboard detail Sheet surfaces issue title, body, linked commits, related PR all inline, no GitHub round-trip required.

## Copy

**Use real numbers, not status words.** "Coverage: 412 of 540 lines, 3 files untested" beats "Approaching coverage target". "Release gate: 2 checks failing, SBOM and eval-regression" beats "Release readiness needs attention".

**Name the thing, do not describe the category.** Linear says "Cycle 12 starts in 3 days", not "Sprint planning reminder". Console says "Campaign Q2-W3" not "current run". "Gate" not "release check". The name implies structure, the category implies bureaucracy.

**Explain acronyms inline at first encounter.** The OverviewPanel.tsx blurb pattern is correct: "SBOM = Software Bill of Materials (CycloneDX JSON of every npm and Python dep)". No glossary page.

**Banned phrases.**
- "gain insights into" -> just say what the insight is
- "powerful analytics" -> say what it does
- "actionable data" -> all data is actionable or it would not be here
- "robust" -> describe the behavior
- "comprehensive" -> describe the coverage
- "production-ready" -> say what it ships
- "I can help you" -> just show the result
- "Would you like me to" -> just do it
- "leverage" -> use
- "seamless" -> describe the experience
- "AI-powered" -> say what the AI does
- "next-generation" -> describe the generation

**Tone calibration.** Senior engineer talking to another senior engineer: direct, specific, no hedging, no upsell. Reference register: Linear's "Cycle 12 starts in 3 days". Notion's "Start with a template" CTA pattern. Stripe's "$0.00005 per event" pricing transparency.

## Onboarding

**The happy path requires zero configuration knowledge.** Cal.com's three-step first-run works for technical and non-technical users because the defaults are pre-populated. Console's first-run auto-detects the project directory and shows a sample-populated Overview, not an empty state.

**Persona pick comes first, drives everything else.** Newbie persona enables explainer hovers, default-expanded sidebar, roomy density, plain-English Ctrl+K placeholder, NewcomerBanner visibility. Seasoned persona disables all of those. Persona is changeable from Settings: Display.

**Skip is always available.** No required step beyond folder selection. The Stripe principle: KYC is required, everything else is opt-in.

**Pre-populated examples beat empty fields.** Cal.com shows "Mon 8:30am to 5pm" as a default, not an empty field. Console first-run shows a sample project structure when no folder is set, not a blank panel.

## Interaction

**Cmd-K is the universal entry point.** Every action reachable via the command palette. Console uses the existing cmdk dependency, upgraded with the 21st.dev Omni Command Palette for grouped result rendering. Tier 0 AI (Transformers.js BGE-small) provides semantic ranking, no chat surface.

**Keyboard-first.** Single-letter keys for the most-used actions. `E` to edit, `F` to filter, `P` to set priority. Multi-key chords only for IDE-level operations. The `?` modal lists all keybindings.

**No notifications outside the app.** Console is a local desktop app. Notifications are in-app banners, not Discord, Slack, or email pushes. Coolify's notification-heavy pattern is explicitly avoided.

## AI surface

**No chatbot widget. Ever.** Mixpanel, Notion, Linear, Plane all have AI query boxes. Console has none. AI shows up as cached suggestions on Overview, inline hover explainers in newbie mode, semantic Ctrl+K ranking, auto-categorize labels on Workboard. The conversational AI agent lives elsewhere. Console's role is to show state that AI produced or that helps with shipping. Never to take typing input into a thread.

**On-device first, cloud opt-in.** Default tier (Transformers.js) requires zero setup and zero API key. Ollama detection is automatic. Cloud Claude only activates when the user pastes a key in Settings. Privacy is the differentiator.

**Guided clarification before AI output.** Replit pattern: when an AI action fires, ask 1-2 narrowing questions ("Which part concerns you?", "What outcome do you need?") before generating. Reduces blank-canvas paralysis for non-developers.

**Point-and-explain.** Lovable.dev pattern: click any metric, chart, or repo file, get an inline AI explanation as a tooltip or right panel. No prompt required. The user interacts with the visual output, not a text box.

## What Console must do differently from every competitor

1. **No outward-facing data.** Posthog, Mixpanel, Datadog all watch end-users. Console watches the local development loop only. Zero telemetry, zero remote pulls.
2. **No AI typing surface in the UI layer.** Mixpanel's natural-language query box, Notion's AI thread, Linear's AI agents as workspace members. Console has none of these.
3. **Light-first, flat, no decoration.** Every named competitor defaults to dark. Console defaults to light. Reads as a Stripe docs page, not a SaaS dashboard.
4. **Single user, single project, local-first.** Plane scales to teams, Linear scales to organizations, Backstage scales to hundreds of services. Console scales to one developer and one project, with multi-project as a v0.4 stretch.
5. **Onboarding for the project, not the tool.** The NewcomerBanner explains the user's project, not Console. This is the inverse of every other competitor's first-run flow, which explains the tool.

## Reference patterns to study, in priority order

| Source | Pattern | Apply to |
|---|---|---|
| Linear | Cmd-K, density, named objects copy, hover-reveal | Workboard, Issues panel, copy across all surfaces |
| Stripe Dashboard | Three-tier settings, ? shortcut help, customizable widgets, pricing-transparent copy | Settings panel, Overview bento, keyboard help modal |
| Vercel | One-line nav descriptors, restraint, Integrations marketplace grammar | Sidebar labels, Services panel |
| Sentry | Issue Detail context-to-fix, Trace Waterfall | Workboard detail Sheet, Observability run viewer |
| Cal.com | Three-step first-run, pre-populated examples | Welcome flow, all empty states |
| Notion | Template gallery categorization, blank-page solution | Project archetype templates (v0.2) |
| OpenSauced | Repo health metrics (PR velocity, contributor activity) | Repo panel future v0.3 |
| Bolt.new | Zero-setup live preview | Docs DemoStage exhibits |
| Lovable.dev | Point-and-explain visual editing | Inline AI explainer tooltips |
| Replit | Guided clarification | AI action confirmation flow |
| Aider | tree-sitter + PageRank repo-map | NewcomerBanner Show-me-around output |
