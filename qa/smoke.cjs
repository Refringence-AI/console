// qa/smoke.cjs
//
// Repeatable end-to-end smoke for Console. Boots the built Electron app against a
// real project, walks every panel, and asserts: it lands on the app (not the
// onboarding wizard), each panel renders without an error boundary, the golden
// path grounds an error to a real file, and the renderer logs ZERO console
// errors across the whole walk. Exits non-zero on any failure.
//
// Usage:  node qa/smoke.cjs            (uses REFRINGENCE_QA_PROJECT or the default)
//         REFRINGENCE_QA_PROJECT=/path/to/repo node qa/smoke.cjs
//
// Prereqs: the renderer + main are built (npm --prefix console-shell run build &&
// npm --prefix console-electron run build:main), and `npm install` has run here.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const consoleDir = path.join(repoRoot, 'console-electron');
const electronBin = path.join(consoleDir, 'node_modules', 'electron', 'dist', 'electron.exe');
// Default to this repo (Console self-dogfoods); override with REFRINGENCE_QA_PROJECT.
const PROJECT = process.env.REFRINGENCE_QA_PROJECT || repoRoot;

// [label, route] - locate nav by the stable route href, not the accessible
// name (a status badge's aria-label folds into the name, and a "Repo" substring
// would also match "Report").
const MAIN_PANELS = [
    ['Overview', '/overview'], ['Report', '/report'], ['Prompts', '/prompts'],
    ['Tool config', '/devtools'], ['Design system', '/design'], ['Workboard', '/issues'],
    ['Repo', '/repo'], ['Architecture', '/arch'], ['Pipeline', '/pipeline'],
    ['Services', '/services'], ['Release', '/release'], ['Observability', '/observability'],
];

const results = [];
const pass = (name) => { results.push({ name, ok: true }); console.log(`  PASS  ${name}`); };
const fail = (name, detail) => { results.push({ name, ok: false, detail }); console.log(`  FAIL  ${name} :: ${detail}`); };

(async () => {
    if (!fs.existsSync(electronBin)) { console.error('Electron binary not found - run the build first.'); process.exit(2); }
    if (!fs.existsSync(PROJECT)) { console.error(`Test project not found: ${PROJECT}. Set REFRINGENCE_QA_PROJECT.`); process.exit(2); }

    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'console-qa-'));
    const env = {};
    for (const [k, v] of Object.entries(process.env)) { if (k === 'ELECTRON_RUN_AS_NODE') continue; if (v !== undefined) env[k] = v; }
    env.REFRINGENCE_CONSOLE_USER_DATA = userData;

    const app = await electron.launch({ executablePath: electronBin, args: [consoleDir, PROJECT], env, timeout: 30000 });
    const w = await app.firstWindow({ timeout: 30000 });
    const consoleErrors = [];
    w.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    w.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + (e.message || String(e)).slice(0, 200)));

    await w.waitForLoadState('domcontentloaded');
    await w.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    await w.waitForTimeout(1500);
    const wid = await w.evaluate(() => new URLSearchParams(location.search).get('wid') || '0');
    await w.evaluate(({ wid, p }) => {
        localStorage.setItem('refringence-console-onboarded', 'true');
        localStorage.setItem(`refringence-console-onboarded:${wid}`, 'true');
        localStorage.setItem('refringence-console-onboarded-projects', JSON.stringify([p])); // per-project setup flag
        localStorage.setItem('refringence-console-persona', 'seasoned');
        localStorage.setItem('refringence-console-theme', 'dark');
        localStorage.setItem(`refringence-console-active-project:${wid}`, p);
        localStorage.setItem(`refringence-console-active-project-pickedAt:${wid}`, String(Date.now()));
    }, { wid, p: PROJECT });
    await w.reload();
    await w.waitForLoadState('domcontentloaded');
    // Let the first render + initial data fetches settle before driving the nav;
    // the first expensive panel (Report) otherwise races the tail of boot.
    await w.waitForSelector('nav a[href$="/overview"]', { timeout: 8000 }).catch(() => {});
    await w.waitForTimeout(4000);

    // 1. Lands on the app, not onboarding.
    const onWelcome = await w.evaluate(() => document.body.innerText.includes('Guide me through it') || !!document.querySelector('[data-testid="onboarding-wizard"]'));
    onWelcome ? fail('boot: lands on app (not onboarding)', 'stuck on onboarding') : pass('boot: lands on app (not onboarding)');

    // 2. Every main panel renders without an error boundary.
    // A heavy panel's transient loading overlay can briefly intercept the next
    // nav click; retry once after it clears rather than stretching fixed waits.
    const clickNav = async (route) => {
        const link = w.locator(`nav a[href$="${route}"]`).first();
        try { await link.click({ timeout: 5000 }); }
        catch { await w.waitForTimeout(1500); await link.click({ timeout: 5000 }); }
    };
    for (const [label, route] of MAIN_PANELS) {
        try {
            await clickNav(route);
            await w.waitForTimeout(1800);
            const broke = await w.evaluate(() => /Something went wrong|Application error|Cannot read prop/i.test(document.body.innerText));
            const hasContent = await w.evaluate(() => (document.querySelector('main') || document.body).innerText.trim().length > 40);
            if (broke) fail(`panel renders: ${label}`, 'error boundary text present');
            else if (!hasContent) fail(`panel renders: ${label}`, 'panel is empty');
            else pass(`panel renders: ${label}`);
        } catch (e) { fail(`panel renders: ${label}`, e.message.slice(0, 80)); }
    }

    // 3. Golden path: ground an error to a real file.
    try {
        await w.getByRole('link', { name: 'Workboard', exact: true }).first().click({ timeout: 4000 });
        await w.waitForTimeout(1000);
        await w.getByTestId('issues-ground-toggle').click({ timeout: 4000 });
        await w.waitForTimeout(300);
        await w.getByTestId('issues-ground-input').fill('TypeError at apps/web/src/auth/AuthDialog.tsx:20:5');
        await w.getByTestId('issues-ground-run').click({ timeout: 4000 });
        await w.waitForTimeout(1500);
        const grounded = await w.evaluate(() => document.body.innerText.includes('Files found in this repo') || document.body.innerText.includes('search from the error'));
        grounded ? pass('golden path: ground error -> fix prompt') : fail('golden path: ground error -> fix prompt', 'no grounded result rendered');
    } catch (e) { fail('golden path: ground error -> fix prompt', e.message.slice(0, 80)); }

    // 4. Zero renderer console errors across the whole walk.
    const uniqErr = [...new Set(consoleErrors)];
    uniqErr.length === 0 ? pass('renderer: 0 console errors') : fail('renderer: 0 console errors', `${uniqErr.length} distinct: ${uniqErr.slice(0, 3).join(' | ')}`);

    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error('SMOKE CRASHED:', e.message); process.exit(2); });
