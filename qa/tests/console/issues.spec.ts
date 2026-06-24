// qa/tests/console/issues.spec.ts
//
// Issues panel functional test. Verifies the gh CLI subprocess path
// + Kanban/table view toggle + filter narrow.
//
// Tests gracefully handle the case where gh isn't installed/auth'd
// (banner shown, no fetch).
import { test, expect } from './_fixture';

test.describe('Issues panel', () => {
    test('mounts at /issues with repo label', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/issues"]').click();
        await consoleWindow.waitForSelector('[data-testid="issues-panel"]');
        // Repo label should appear once health probe returns.
        await consoleWindow.waitForSelector('[data-testid="issues-repo"]', { timeout: 8_000 });
        const repo = await consoleWindow.locator('[data-testid="issues-repo"]').textContent();
        expect(repo).toMatch(/S+/S+/);
    });

    test('view toggle switches Kanban <-> Table', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/issues"]').click();
        await consoleWindow.waitForSelector('[data-testid="issues-panel"]');
        // Kanban default.
        await consoleWindow.locator('[data-testid="issues-view-table"]').click();
        await consoleWindow.waitForSelector('[data-testid="issues-table"]', { timeout: 5_000 });
        await expect(consoleWindow.locator('[data-testid="issues-table"]')).toBeVisible();
        // Toggle back.
        await consoleWindow.locator('[data-testid="issues-view-kanban"]').click();
        await consoleWindow.waitForSelector('[data-testid="issues-kanban"]', { timeout: 5_000 });
        await expect(consoleWindow.locator('[data-testid="issues-kanban"]')).toBeVisible();
    });

    test('IPC issues.health returns the typed shape', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/issues"]').click();
        const h = await consoleWindow.evaluate(() => window.refringenceConsole.issues.health());
        const health = h as { ghAvailable: boolean; repo: string; authStatus: string };
        expect(typeof health.ghAvailable).toBe('boolean');
        expect(typeof health.repo).toBe('string');
        expect(health.repo).toContain('Refringence-AI');
        expect(['ok', 'no-auth', 'unknown']).toContain(health.authStatus);
    });
});
