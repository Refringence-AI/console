# Console QA

A repeatable end-to-end smoke for Console. It boots the built Electron app
against a real project and asserts the app holds together:

- it lands on the app, not the onboarding wizard, when a project is set;
- every main panel renders without an error boundary or an empty body;
- the golden path grounds an error to a real file in the repo;
- the renderer logs **zero** console errors across the whole walk.

## Run

```bash
# build the app first
npm --prefix ../console-shell run build
npm --prefix ../console-electron run build:main

# then, once per checkout
npm install --prefix . --no-save   # installs playwright (uses Electron's bundled Chromium)

# run the smoke (uses REFRINGENCE_QA_PROJECT, or the flocast default)
REFRINGENCE_QA_PROJECT=/path/to/any/repo npm run smoke
```

Exit code is `0` when every check passes, `1` on a failed assertion, `2` when the
app or test project can't be found. State is isolated per run via
`REFRINGENCE_CONSOLE_USER_DATA`, so it never touches your real Console state.

## Next

This is the Phase Q "Q0" smoke floor. A self-contained fixture project (so the
smoke doesn't depend on an external repo path) and per-panel Playwright specs
with trace/screenshot artifacts are the natural follow-ups.
