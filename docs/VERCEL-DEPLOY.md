# Deploy to Vercel

Console can deploy the open project to Vercel from the **Services** panel - with
nothing wired beforehand (no `vercel.json`, no project on Vercel yet).

## Using it

1. Open a project in Console.
2. **Services -> Vercel -> Connect**, and paste a Vercel access token
   ([vercel.com/account/tokens](https://vercel.com/account/tokens)). The token is
   encrypted with your OS keychain (safeStorage) and never leaves the main
   process - it is never returned to the UI or logged.
3. Click **Deploy**. Console shows the detected framework + a project name, then
   deploys and polls the build to the live URL.

## How it works

A single flow handles "create project + deploy":

1. **Detect** (`detectDeploy`) - reads `package.json` to infer the framework
   (Vite, Next, SvelteKit, Nuxt, Astro, Angular, Gatsby, CRA) and output
   directory. No build script -> deploy as a **static** site.
2. **Walk + hash** - collects the project's source files, SHA-1 each. Excluded:
   `node_modules`, build output (`dist`, `build`, `.next`, `out`, ...), VCS
   metadata, and **anything secret** (`.env*`, `*.pem`/`*.key`/`*.p12`,
   `id_rsa*`/`id_ed25519*`, `.npmrc`).
3. **Upload** - each file to `POST /v2/files` (deduplicated by SHA).
4. **Deploy** - `POST /v13/deployments` with the file manifest + `projectSettings`.
   The `name` field creates the Vercel project on the first deploy.
5. **Poll** (`deployState`) - until the deployment is `READY` (or `ERROR`).

## Surface

- Main: [console-electron/src/main/ipc/vercelDeploy.ts](../console-electron/src/main/ipc/vercelDeploy.ts)
  (the deploy engine) + the `console:connections.vercel.detectDeploy` /
  `.deploy` / `.deployState` IPC handlers in
  [ipc/connections.ts](../console-electron/src/main/ipc/connections.ts).
- Renderer: the Vercel card in
  [ServicesPanel.tsx](../console-shell/src/views/services/ServicesPanel.tsx).
- Typed surface: `vercel.detectDeploy` / `deploy` / `deployState` in
  [bridge.ts](../console-shell/src/lib/bridge.ts).

## Notes / limits

- Console uploads the **source** and lets Vercel build it (so the build runs in
  Vercel's environment, same as a Git deploy). A project with no build script is
  served static.
- This is a direct (non-Git) deploy: it does not set up auto-deploy-on-push. For
  that, link the repo in the Vercel dashboard. Console's existing
  `projects` / `deployments` / `redeploy` cover ongoing redeploys.
- `.gitignore` is not yet honored beyond the built-in exclude list; that is a
  reasonable future improvement.
