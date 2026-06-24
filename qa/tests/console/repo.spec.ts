import { test, expect } from './_fixture';

test.describe('Repo panel', () => {
    test('mounts and lists known packages', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/repo"]').click();
        await consoleWindow.waitForSelector('[data-testid="repo-panel"]');
        // Structure tab is the default orientation surface; the LOC tree
        // lives behind the "Files by size" tab.
        await consoleWindow.locator('[data-testid="repo-tab-files"]').click();
        await consoleWindow.waitForSelector('[data-testid="repo-tree"]');
        for (const pkg of ['console-electron', 'console-shell', 'qa', 'docs']) {
            await expect(consoleWindow.locator(`[data-testid="repo-pkg-${pkg}"]`)).toBeVisible();
        }
    });

    test('clicking a package shows files + languages', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/repo"]').click();
        await consoleWindow.locator('[data-testid="repo-tab-files"]').click();
        await consoleWindow.waitForSelector('[data-testid="repo-tree"]');
        await consoleWindow.locator('[data-testid="repo-pkg-console-shell"]').click();
        await consoleWindow.waitForSelector('[data-testid="repo-active-pkg"]');
        const active = await consoleWindow.locator('[data-testid="repo-active-pkg"]').textContent();
        expect(active).toBe('console-shell');
        await expect(consoleWindow.locator('[data-testid="repo-languages"]')).toBeVisible();
        await expect(consoleWindow.locator('[data-testid="repo-files"]')).toBeVisible();
        const fileCount = await consoleWindow.locator('[data-testid="repo-files"] li').count();
        expect(fileCount).toBeGreaterThan(3);
    });

    test('IPC repo.summary returns shape', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/repo"]').click();
        const summary = await consoleWindow.evaluate(() => window.refringenceConsole.repo.summary());
        const s = summary as { total_packages: number; total_files: number; total_loc: number; packages: unknown[] };
        expect(s.total_packages).toBeGreaterThan(5);
        expect(s.total_files).toBeGreaterThan(10);
        expect(s.total_loc).toBeGreaterThan(100);
        expect(Array.isArray(s.packages)).toBe(true);
    });
});
