# Changelog

All notable changes to Console are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-07-01

Release candidate for 1.0. This build hardens the AI command runner and
permission gate, verifies database TLS by default, confines the PII scan to the
open project, and trims dead code, on top of the operator assistant, grounded
systems map, connector health and actions, release tooling, and the redesigned
onboarding.

### Added

- Branded Windows installer: a prism welcome/finish sidebar, a header banner on the inner pages, and custom installer/uninstaller icons, plus an FSL-1.1-Apache-2.0 license-acceptance page the user must accept before install. The terminal install script runs the installer silently and skips the license page.
- **Deploy to Vercel from the Services panel.** Connect Vercel, then deploy the
  open project with one click - zero-config, including projects with nothing
  wired (no `vercel.json`). Console detects the framework (Vite, Next, SvelteKit,
  Astro, CRA, or static), uploads the source (never `node_modules`, build output,
  or secrets like `.env` / keys), creates the Vercel project on first deploy, and
  polls the build to the live URL. See [docs/VERCEL-DEPLOY.md](docs/VERCEL-DEPLOY.md).
- **The assistant became a project operator.** With a project open, the assistant
  reads your real files (release checks, dependency licenses, migration drift,
  dead config) and, behind a diff-and-approve gate, can write a file, generate a
  deploy or CI config, write an SBOM, run a command to verify a change, or hand a
  scoped task to your IDE agent (Cursor / Claude Code) through AGENTS.md or
  .cursorrules. It can pause to ask you one clarifying question, and a read-only
  Plan mode lets it investigate and propose a plan without changing anything.
- **Assistant observability.** Per-model spend in the chat header, a context and
  token usage bar, and the conversation now survives a reload, per project.
- **Grounded systems map.** The AI architecture map is folded together with the
  real dependency graph: each link is marked detected (a real import crosses the
  two systems) or inferred (the model's guess), the real cross-system imports the
  model left out are backfilled, and a system with no real links reads as
  standalone.
- **Connector health and actions.** A connected service now reports an honest
  state (healthy, rate limited, auth failed, unreachable) instead of failing
  silently; Cloudflare cache purge and Render deploy run from the service card;
  and a connector can be linked with OAuth over a loopback redirect.
- **The Pipeline header shows the branch's pull request** and its state.
- **More on the Release panel.** Cut a release as an annotated git tag (and roll
  it back), generate a CycloneDX SBOM, run an eval-regression gate that blocks on
  a per-test drop against a captured baseline, and scaffold the readiness files a
  project is missing: LICENSE, .gitignore, .env.example (key names only, never the
  values), Dockerfile, docker-compose, and a CI workflow.
- **Database saturation in Observability:** Postgres connection-pool usage,
  idle-in-transaction, blocked queries, and the longest-running query, from a
  read-only connection string that is used once and never stored.
- **More task runners detected:** justfile (just) and Taskfile.yml (go-task)
  recipes now appear alongside npm scripts and Makefile targets.
- **Intelligent freshness.** The open project is watched, debounced, so cheap
  file-derived views refresh on real changes without a polling loop.

### Changed

- **Onboarding redesigned.** The left two-thirds is now the teaching panel (the
  ambient effect, the step indicator, and each step's title and description) and
  the right third holds only the inputs, vertically centered and clear of the
  window controls. The feature carousel uses a calm dot grid behind the screenshot.

### Fixed

- The chat composer no longer shows a stray focus rectangle when clicked.
- Icon-only buttons across the app now carry an accessible name for screen readers.

## [0.1.0] - 2026-06-22

First public release. Console packaged as installable desktop apps (Windows
NSIS, macOS dmg, Linux AppImage + deb) with auto-update from GitHub Releases,
an in-app "Restart to update" pill, and a `console .` launcher. Sanitized and
rebranded to "Console by Refringence" for open-source distribution under
FSL-1.1-Apache-2.0.

This release takes Console from a polished shell to a complete cockpit:
a live architecture graph, workflows you can run from inside the app, in-app
docs and tutorials, a rebuilt top bar, and a pass that strips the
AI-generated tells from the UI.

### Added

- Electron 35 main process (`console-electron`) and a React 19 + Vite 7 +
  Tailwind v4 + shadcn renderer (`console-shell`), connected by a typed IPC
  bridge with one handler module per panel.
- Architecture panel: a live dependency graph extracted from the project's
  actual imports (TS/JS), laid out with ELK and colored by tier, with cycle
  detection. An annotate layer lets you pin positions, override tiers, add
  notes, and save a curated overlay on top of the auto-graph.
- Observability panel: one-click runs for evals, e2e, smoke, and CI. Output
  streams into a live console; the runs table and Overview numbers refresh when
  a run finishes. Runs can be cancelled mid-flight.
- Pipeline panel: trigger a workflow run from the panel and watch its status.
- Repo panel: orientation that answers what the project is, how to run it, and
  how it is structured by role, replacing the file-size ranking as the headline.
- Universal any-repo detection: project type, start command, primary language,
  and capabilities are inferred from `package.json`, `pyproject.toml`,
  `Cargo.toml`, `go.mod`, `Dockerfile`, and workspace markers, so panels seed on
  any project, not just the one Console was built in.
- Tutorials panel: a stepped carousel of walkthroughs, each with a live
  miniature of the real component it teaches.
- Docs panel: sectioned, visual documentation whose examples are live,
  scaled-down Console components rather than screenshots.
- Library panel: an in-app reader for the repo's docs and config files; markdown
  is rendered in place instead of opening an external editor.
- Custom React window controls (minimize, maximize, close) with a draggable
  title region.
- Project-directory resolution from app state and recent-project history.
- Encrypted token storage for GitHub, Vercel, and Sentry connections via
  Electron `safeStorage`; non-secret metadata stays in plaintext, tokens never
  reach the renderer.
- Light-default theme with dark optional, sharing `packages/design-tokens` with
  its sibling apps.
- Playwright e2e suite running serially under the `console` project.

### Changed

- Overview now leads with a prose project summary (type, start command,
  language, package count, LOC) and a quiet, specific next-action line, in place
  of the templated status card.
- Top bar rebuilt around the IA: brand, project switcher, persona, Ctrl+K,
  theme, then the custom window controls.

### Removed

- Evals tab. Running evals and viewing results now live in Observability; the
  pass-rate number surfaces on Overview.
- Metrics tab. Its cards fold into Observability and Overview.

### Fixed

- Window controls no longer render an OS-drawn caption overlay; removing
  `titleBarOverlay` eliminates the dark and grey rectangles that the color sync
  produced around the controls.

[0.9.0]: https://github.com/Refringence-AI/console/compare/v0.1.0...v0.9.0
[0.1.0]: https://github.com/Refringence-AI/console/releases/tag/v0.1.0
