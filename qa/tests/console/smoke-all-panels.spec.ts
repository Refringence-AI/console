// qa/tests/console/smoke-all-panels.spec.ts
//
// Cross-cutting Console smoke. Rewritten for the rail sidebar (Console
// v2 Phase P2). Walks every current panel from a fresh boot and verifies:
//   - Each panel mounts (its data-testid is visible) within 5s.
//   - No console.error / pageerror anywhere across the walk.
//
// Navigation goes through the rail-stable `[data-testid="nav-<key>"]`
// selectors rather than `nav a[href]`, which breaks when the sidebar
// collapses to icons. Header h1 text is not asserted because Guided and
// Operator personas render different headings for the same panel.
//
// This is the smoke gate: if ANY panel logs an
// error or fails to mount, the loop won't commit.
import { test, expect } from './_fixture';

const PANELS = [
    { nav: 'nav-overview',      testid: 'overview-panel' },
    { nav: 'nav-workboard',     testid: 'issues-panel' },
    { nav: 'nav-repo',          testid: 'repo-panel' },
    { nav: 'nav-architecture',  testid: 'arch-panel' },
    { nav: 'nav-pipeline',      testid: 'pipeline-panel' },
    { nav: 'nav-services',      testid: 'services-panel' },
    { nav: 'nav-library',       testid: 'library-panel' },
    { nav: 'nav-release',       testid: 'release-panel' },
    { nav: 'nav-observability', testid: 'observability-panel' },
    { nav: 'nav-activity',      testid: 'activity-panel' },
    { nav: 'nav-tutorials',     testid: 'tutorials-panel' },
    { nav: 'nav-docs',          testid: 'docs-panel' },
    { nav: 'nav-settings',      testid: 'settings-panel' },
];

// Land in the shell deterministically, with an explicit layout so the
// soft-hidden rows are present on the rail.
async function enterShell(win: import('@playwright/test').Page) {
    await win.evaluate(() => {
        localStorage.setItem('refringence-console-persona', 'seasoned');
        localStorage.setItem('refringence-console-onboarded', '1');
        localStorage.setItem(
            'refringence-console-sidebar-layout-v1',
            JSON.stringify({ hidden: [], order: [], collapsedGroups: [] }),
        );
        localStorage.setItem(
            'refringence-console-layout-v1',
            JSON.stringify({ railCollapsed: false, chatOpen: false }),
        );
    });
    await win.reload();
    await win.waitForSelector('[data-testid="console-shell"]', { timeout: 10_000 });
}

test('smoke: walk all 13 panels with zero console errors', async ({ consoleWindow }) => {
    const errors: string[] = [];
    consoleWindow.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    consoleWindow.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (text.includes('Electron Security Warning')) return;
        if (text.includes('Insecure Content-Security-Policy')) return;
        errors.push(`console.error: ${text}`);
    });

    await enterShell(consoleWindow);

    // The brand strip lives at the top of the sidebar and must survive.
    await expect(consoleWindow.locator('[data-testid="brand-strip"]')).toBeVisible();

    for (const panel of PANELS) {
        await consoleWindow.locator(`[data-testid="${panel.nav}"]`).click();
        await expect(consoleWindow.locator(`[data-testid="${panel.testid}"]`)).toBeVisible({
            timeout: 5_000,
        });
    }

    expect(errors, `console errors across panel walk:\n${errors.join('\n')}`).toEqual([]);
});

test('smoke: forward + backward nav has no console errors', async ({ consoleWindow }) => {
    const errors: string[] = [];
    consoleWindow.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    consoleWindow.on('console', (msg) => {
        if (msg.type() === 'error' && !msg.text().includes('Electron Security Warning')) {
            errors.push(`console.error: ${msg.text()}`);
        }
    });

    await enterShell(consoleWindow);

    for (const p of PANELS) {
        await consoleWindow.locator(`[data-testid="${p.nav}"]`).click();
        await consoleWindow.waitForSelector(`[data-testid="${p.testid}"]`, { timeout: 5_000 });
    }
    for (let i = PANELS.length - 1; i >= 0; i--) {
        const p = PANELS[i];
        await consoleWindow.locator(`[data-testid="${p.nav}"]`).click();
        await consoleWindow.waitForSelector(`[data-testid="${p.testid}"]`, { timeout: 5_000 });
    }

    expect(errors).toEqual([]);
});

test('every panel mounts within 5s', async ({ consoleWindow }) => {
    await enterShell(consoleWindow);
    for (const panel of PANELS) {
        const before = performance.now();
        await consoleWindow.locator(`[data-testid="${panel.nav}"]`).click();
        await consoleWindow.waitForSelector(`[data-testid="${panel.testid}"]`, { timeout: 5_000 });
        const after = performance.now();
        const elapsed = after - before;
        expect(elapsed, `${panel.nav} took ${elapsed}ms > 5000`).toBeLessThan(5_000);
    }
});
