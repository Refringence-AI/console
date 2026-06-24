// qa/fixtures/consoleApp.ts
//
// Playwright fixture for launching Console under test.
// Modeled after fixtures/electronApp.ts but points at console-electron/
// and exposes window.refringenceConsole instead of window.refringence.
//
// Critical: ELECTRON_RUN_AS_NODE is explicitly stripped from the env
// before spawn so a parent shell that inherited it (Cursor /
// Antigravity / certain WSL bash setups) doesn't break electron's
// boot path. Same hardening as electronApp.ts.
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONSOLE_MAIN = path.join(REPO_ROOT, 'console-electron', 'dist', 'main', 'main.js');
const CONSOLE_BIN = path.join(
  REPO_ROOT,
  'console-electron',
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);
const CONSOLE_DIR = path.join(REPO_ROOT, 'console-electron');

export type ConsoleFixtures = {
  consoleApp: ElectronApplication;
  consoleWindow: Page;
  tempUserData: string;
  artifactsDir: string;
};

function makeTempUserData(testTitle: string): string {
  const safe = testTitle.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
  const dir = path.join(os.tmpdir(), 'refringence-console-qa', `${safe}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function artifactDir(testTitle: string): string {
  const runId = process.env.REFRINGENCE_RUN_ID || `local-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const safe = testTitle.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
  const dir = path.join(REPO_ROOT, '.refringence-qa', 'runs', runId, 'console-traces', safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const test = base.extend<ConsoleFixtures>({
  tempUserData: async ({}, use) => {
    const dir = makeTempUserData(`console-qa-${process.pid}`);
    await use(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  },

  artifactsDir: async ({}, use) => {
    const dir = artifactDir(`console-qa-${process.pid}`);
    await use(dir);
  },

  consoleApp: async ({ tempUserData, artifactsDir }, use) => {
    if (!fs.existsSync(CONSOLE_MAIN)) {
      throw new Error(
        `Console main not built. Expected: ${CONSOLE_MAIN}\n` +
        `Run \`cd console-electron && npm run build:main\` (and \`cd console-shell && npm run build\`) first.`
      );
    }
    // Filter ELECTRON_RUN_AS_NODE out of the spawn env so the child boots
    // as Electron, not Node (it leaks in from some terminals).
    const env: Record<string, string> = {
      REFRINGENCE_CONSOLE_QA_MODE: '1',
      REFRINGENCE_CONSOLE_USER_DATA: tempUserData,
      REFRINGENCE_CONSOLE_ARTIFACTS_DIR: artifactsDir,
    };
    for (const [k, v] of Object.entries(process.env)) {
      if (k === 'ELECTRON_RUN_AS_NODE') continue;
      if (v !== undefined) env[k] = v;
    }
    const app = await electron.launch({
      executablePath: fs.existsSync(CONSOLE_BIN) ? CONSOLE_BIN : undefined,
      args: [CONSOLE_DIR, '--qa-mode'],
      env,
      cwd: REPO_ROOT,
      timeout: 30_000,
    });
    await use(app);
    try { await app.close(); } catch { /* noop */ }
  },

  consoleWindow: async ({ consoleApp }, use) => {
    const win = await consoleApp.firstWindow({ timeout: 30_000 });
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },
});

export { expect } from '@playwright/test';
