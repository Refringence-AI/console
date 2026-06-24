// qa/tests/console/navigation.spec.ts
//
// Console navigation test. Rewritten for the rail sidebar (Console v2
// Phase P2). Verifies:
//   - The shell renders with the brand strip at the top of the sidebar.
//   - Each of the 13 panels is reachable via its rail-stable
//     `[data-testid="nav-<key>"]` and mounts its panel testid.
//   - No console errors across the walk.
//
// The sidebar collapses to an icon rail, so `nav a[href]` selectors no
// longer hold. Navigation goes through the nav testids, which survive
// the collapse. Header h1 text is NOT asserted because Guided and
// Operator personas show different headings for the same panel.
import { test, expect } from './_fixture';

// All 13 panels. `nav` is the rail testid suffix; `panel` is the
// data-testid the panel root declares. A few low-frequency panels are
// soft-hidden off the rail by default, so the walk seeds an explicit
// layout (all panels shown) before navigating.
const PANELS = [
    { nav: 'nav-overview',      panel: 'overview-panel' },
    { nav: 'nav-workboard',     panel: 'issues-panel' },
    { nav: 'nav-repo',          panel: 'repo-panel' },
    { nav: 'nav-architecture',  panel: 'arch-panel' },
    { nav: 'nav-pipeline',      panel: 'pipeline-panel' },
    { nav: 'nav-services',      panel: 'services-panel' },
    { nav: 'nav-library',       panel: 'library-panel' },
    { nav: 'nav-release',       panel: 'release-panel' },
    { nav: 'nav-observability', panel: 'observability-panel' },
    { nav: 'nav-activity',      panel: 'activity-panel' },
    { nav: 'nav-tutorials',     panel: 'tutorials-panel' },
    { nav: 'nav-docs',          panel: 'docs-panel' },
    { nav: 'nav-settings',      panel: 'settings-panel' },
];

// Land in the shell deterministically: seed a persona and an explicit
// sidebar layout (so the soft-hidden rows are present), then reload so
// the memory router boots past the welcome flow into /overview.
async function enterShell(win: import('@playwright/test').Page) {
    await win.evaluate(() => {
        localStorage.setItem('refringence-console-persona', 'seasoned');
        localStorage.setItem('refringence-console-onboarded', '1');
        // Explicit (non-empty) layout disables the soft-hidden default so
        // every nav row renders on the rail.
        localStorage.setItem(
            'refringence-console-sidebar-layout-v1',
            JSON.stringify({ hidden: [], order: [], collapsedGroups: [] }),
        );
        // Standard preset keeps the sidebar expanded.
        localStorage.setItem(
            'refringence-console-layout-v1',
            JSON.stringify({ railCollapsed: false, chatOpen: false }),
        );
    });
    await win.reload();
    await win.waitForSelector('[data-testid="console-shell"]', { timeout: 10_000 });
}

test.describe('Console navigation', () => {
    test('shell mounts with the brand strip', async ({ consoleWindow }) => {
        await enterShell(consoleWindow);
        const strip = consoleWindow.locator('[data-testid="brand-strip"]');
        await expect(strip).toBeVisible();
        const text = await strip.textContent();
        expect(text).toContain('Refringence');
        expect(text).toContain('Console');
    });

    test('every panel is reachable via its rail nav testid', async ({ consoleWindow }) => {
        await enterShell(consoleWindow);
        for (const { nav, panel } of PANELS) {
            await consoleWindow.locator(`[data-testid="${nav}"]`).click();
            await expect(consoleWindow.locator(`[data-testid="${panel}"]`)).toBeVisible({
                timeout: 5_000,
            });
        }
    });

    test('walking the panels logs no console errors', async ({ consoleWindow }) => {
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
        for (const { nav, panel } of PANELS) {
            await consoleWindow.locator(`[data-testid="${nav}"]`).click();
            await consoleWindow.waitForSelector(`[data-testid="${panel}"]`, { timeout: 5_000 });
        }

        expect(errors, `console errors across panel walk:\n${errors.join('\n')}`).toEqual([]);
    });

    test('the sidebar collapses to a rail and back', async ({ consoleWindow }) => {
        await enterShell(consoleWindow);
        const sidebar = consoleWindow.locator('[data-testid="sidebar"]');
        await expect(sidebar).toHaveAttribute('data-rail-collapsed', 'false');
        await consoleWindow.locator('[data-testid="sidebar-rail-toggle"]').click();
        await expect(sidebar).toHaveAttribute('data-rail-collapsed', 'true');
        // The nav testids survive the collapse, so a panel is still reachable.
        await consoleWindow.locator('[data-testid="nav-repo"]').click();
        await expect(consoleWindow.locator('[data-testid="repo-panel"]')).toBeVisible({
            timeout: 5_000,
        });
        await consoleWindow.locator('[data-testid="sidebar-rail-toggle"]').click();
        await expect(sidebar).toHaveAttribute('data-rail-collapsed', 'false');
    });
});
