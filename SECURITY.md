# Security Policy

## Supported versions

Console is pre-1.0. Security fixes land on the latest release and on `main`;
older pre-releases are not patched. Run the most recent version.

| Version | Supported |
|---|---|
| `main` / latest pre-release | yes |
| earlier pre-releases | no |

## Reporting a vulnerability

Do not open a public issue for a vulnerability.

Use GitHub's private advisory form at
`https://github.com/Refringence-AI/console/security/advisories/new`,
or email security@refringence.ai. Include the affected version, repro steps, and
the impact you observed.

We aim to acknowledge a report within three business days and to agree on a
disclosure timeline with you before any details become public.

## What to look at

Console is local-first: no backend, no telemetry, no account. The interesting
surfaces for a reporter are:

- The IPC boundary. The renderer has no Node or filesystem access; it calls
  typed methods on `window.refringenceConsole` that the preload forwards to main
  handlers under `console-electron/src/main/ipc/`. Inputs crossing that boundary
  are the place to probe.
- Provider tokens. GitHub, Vercel, and Sentry tokens are encrypted with
  Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on
  Linux) and written one file per provider under
  `<userData>/connections/<provider>.token`. Tokens are never written to the
  plaintext `connections.json`, never logged, and never returned to the
  renderer; only the data fetched with a token is. If `safeStorage` reports
  encryption is unavailable, a connection is aborted rather than stored in
  plaintext.
- Process execution. Runnable panels spawn `npm`, `gh`, and Playwright against
  the open project. Reports about argument handling or command construction in
  `console-electron/src/main/ipc/runner.ts` are in scope.

## Out of scope

- Vulnerabilities in the project repo Console is pointed at, rather than in
  Console itself.
- Findings that require an attacker who already has write access to the user's
  filesystem or a malicious project checkout the user chose to open.
