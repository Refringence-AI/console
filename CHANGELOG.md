# Changelog

All notable changes to Console are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Branded Windows installer: a prism welcome/finish sidebar, a header banner on the inner pages, and custom installer/uninstaller icons, plus an FSL-1.1-Apache-2.0 license-acceptance page the user must accept before install. The terminal install script runs the installer silently and skips the license page.
- **Deploy to Vercel from the Services panel.** Connect Vercel, then deploy the
  open project with one click - zero-config, including projects with nothing
  wired (no `vercel.json`). Console detects the framework (Vite, Next, SvelteKit,
  Astro, CRA, or static), uploads the source (never `node_modules`, build output,
  or secrets like `.env` / keys), creates the Vercel project on first deploy, and
  polls the build to the live URL. See [docs/VERCEL-DEPLOY.md](docs/VERCEL-DEPLOY.md).

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

[Unreleased]: https://github.com/Refringence-AI/console/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Refringence-AI/console/releases/tag/v0.1.0
