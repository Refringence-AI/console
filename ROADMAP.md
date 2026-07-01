# Roadmap

Console is local-first and shippable today. This is the direction of travel, not a
set of promises. Dates are intentionally omitted; priorities shift with feedback.

## Now (v1) - shipped

- Reads any repository locally: stack, structure, architecture graph, and health.
- 15 panels (Overview, Report, Workboard, Repo, Architecture, Pipeline, Services,
  Release, Observability, Prompts, Activity, Docs, Library, Tutorials, Settings) in
  a Guided or Operator view.
- Multi-provider AI advisor (OpenAI, Anthropic, Google, Ollama, and any
  OpenAI-compatible endpoint) using your own keys, fully offline-capable.
- Service connectors: GitHub, Vercel, Sentry, Slack, with `.env` auto-detection.
  Tokens are stored in the OS keychain and never leave the main process.
- Dependency / secret / hygiene checks, with one-click "fix it" prompts you can
  hand to Cursor or Claude Code.

## Next (v1.1) - the connector platform

- More providers: OpenRouter and ElevenLabs (AI), Render / Railway / Modal (deploy),
  Supabase / Neon (databases), Google Analytics / PostHog (analytics).
- Per-service usage dashboards: money spent, tokens, requests, and quota, pulled
  from each provider's billing/usage API.
- Guided setup, not just connect: scaffold a deploy, provision a database, wire
  auth or payments, or generate a Dockerfile - via each provider's API/CLI.
- An MCP-host option for action-capable providers (deploy / provision / manage).

## Later (v1.2 / v1.3)

- A refreshed dark theme and a tighter visual system.
- Package-manager installs (winget, Scoop, Homebrew) and signed builds.
- Multi-language architecture extraction (Python, Rust, Go, Java) and graph fixes.

## Beyond (v2) - cloud (optional, opt-in)

- Accounts, a hosted AI advisor proxy (use it without bringing your own key), and
  cross-machine sync of your preferences and prompt/skill library. Tokens and `.env`
  values are never synced. Local-first stays the default; cloud is opt-in.

Have a request? Open an issue or a discussion.
