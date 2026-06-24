# Project Intelligence Engine

Console mounts and deeply understands any project it opens. The engine is two
layers: a deterministic profiler that does ~85% of the understanding with no AI,
and an optional AI enrichment that supplies the parts only a model can.

## Layer 1 - deterministic profiler (no AI)

`console-electron/src/main/intel/profiler.ts` runs ONE walk of the tree and
composes the existing introspection builders into a single `ProjectProfile`:

- **identity** - name, prettified title, description, license.
- **stack** - the full language histogram (LOC share across ~40 file types) plus
  frontend / backend / runtimes / build tools / package manager, detected across
  every `package.json` in the tree (monorepo-aware), not just the root.
- **shape** - project type, monorepo + package count, start command (reuses
  `repo-introspect.buildShape`).
- **metrics** - file count, bytes, LOC, size label.
- **readme** - title, first real prose line as a description, section list.
- **services** - `DetectedService[]` from a 4-source union (`.env`/`.env.example`
  key NAMES, dependency names, config files, `.mcp.json` servers) mapped against
  the curated catalog in `serviceCatalog.ts`. Each carries a confidence
  (config/dep/mcp = high, env-name-only = medium) and the evidence lines that
  fired. Env handling reads key names only, never values.
- **aiTooling** - MCP servers, AI SDKs, eval frameworks, agent config files.
- **cicd / inventory / git** - CI provider + workflows, tests/docs/lockfile/
  license/dockerfile flags, branch + commit count + contributors + hot files.
- **health** - a 0-100 DISCRIMINATOR (not a presence checklist): good practices
  add, real risks subtract (no tests, a thin test/source ratio, bus factor 1,
  dependency cycles, dormancy), so a thin-test repo cannot sit at 100.
- **depGraph** - the cached package dependency graph, now with manifest-declared
  + `file:`/`workspace:` edges (a workspace graph that was inert now has edges)
  and `apps/*` / `packages/*` / `bundled-tools/*` expanded into sub-packages.
- **detail** - the deeper signals a senior engineer wants: grouped run / build /
  test / deploy commands ("how do I run this"), the data layer (ORM + engine),
  API style, testing + lint/format/typecheck tooling, a **reading order** ("start
  here": entry point / most depended-upon / hottest / largest), **risk hotspots**
  (log(loc) x churn x in-degree), **containers** (Dockerfile base images + ports,
  compose services), the **CI job graph** (triggers + needs DAG + deploy steps),
  **env groups** (by prefix, client-exposed flagged), the **TODO/FIXME count**,
  and **release** info (git tags + CHANGELOG).
- plus framework VERSIONS (React 19, Electron 35), per-package kind + purpose +
  frameworks, license SPDX from the LICENSE body, repo slug + keywords, git age /
  activity / cadence / contributors / bus factor, and code/test/docs LOC ratios.

The shape (project type, monorepo, runnable, primary language) is corrected from
the real package list + deps so it never contradicts the rest of the profile
(an Electron monorepo reads as "Electron desktop app (multi-package)", not
"Node.js project / 1 package"). The README title reads an HTML `<h1>` and skips
code fences; the description is a full-sentence paragraph; hot files rank by
commit frequency and exclude lockfiles / SBOMs / images. The whole engine was
designed from a research + per-repo-evaluation pass.

The profile is cached at `<project>/.refringence-console/intel-profile.json`,
keyed by the same cheap directory-signature the arch graph uses, so a re-open is
instant and a real edit triggers a rebuild.

## Layer 2 - AI enrichment (optional)

`console-electron/src/main/intel/enrich.ts` takes the deterministic profile and
asks a connected model (any provider with a stored key, or local Ollama) for the
things only AI supplies, in one grounded call:

- a plain-English **narrative** of what the project is about (domain, audience,
  purpose) and a one-line **tagline**;
- prioritized **suggestions**;
- **packageNotes** - one plain-English line per real package;
- **changeFirst** - "what a senior would fix first", grounded in the deterministic
  hotspots and citing a real evidence file;
- a **runGuide** synthesized from the REAL run/build commands (never invented);
- a **semantic systems diagram** - named systems mapped onto REAL repository
  paths. The model may only place systems on a candidate path list we pass in,
  and every returned path is re-validated against that set main-side, so a
  clicked system always opens real code (no hallucinated paths).

Every path-bearing AI field is validated against the candidate-path set the same
way, so the AI layer never points at code that does not exist.

> Known limit: cross-package edges are recovered from manifest-declared deps
> (package.json / pyproject / Cargo). A monorepo whose packages compose only at
> runtime (e.g. editable Python installs that are deliberately not pinned to each
> other) declares no inter-package deps, so its dependency graph has no edges; the
> package list + the AI systems diagram carry its architecture instead.

The enrichment is persisted into the cached profile as `ai` and is carried
forward across deterministic rebuilds, so an unrelated signature bump never wipes
it; the user refreshes it on demand with "Re-read with AI". With no provider
connected, every AI surface degrades to a clear "connect a provider" prompt and
the deterministic report stays fully useful.

## IPC

`console-electron/src/main/ipc/intel.ts`:

- `console:intel.profile(root, { force? })` -> `ProjectProfile | null` (cached
  fast path).
- `console:intel.mount.start(root)` -> `{ mountId }`, then streams
  `console:intel.mount.step` / `.profile` / `.done` (the "mount + study" flow).
- `console:intel.enrich(root, { model? })` -> `{ ok, intel?, error? }`.

The renderer surfaces are the **Project Report** panel
(`console-shell/src/views/intel/ProjectReport.tsx`, route `/report`) and the
**Systems** tab in the Architecture panel
(`console-shell/src/views/arch/SystemsView.tsx`).

## Verification

The engine is dogfooded against real projects spanning the range it must handle:

- A **services-heavy Turborepo monorepo** - many detected services with
  evidence and `.mcp.json` servers, multiple packages,
  React/Tailwind/Fastify/Vite/Turborepo.
- A **services-light polyglot app** - honest-empty services, mixed runtimes
  (Node.js + Python).
- **Console itself** - the dogfood case.
