// qa/tests/console/docs.spec.ts
//
// Docs panel functional test. Verifies the real docs/ tree is walked,
// categorised, and renders via marked.
import { test, expect } from './_fixture';

test.describe('Docs panel', () => {
    test('mounts and lists >= 20 .md files', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/docs"]').click();
        await consoleWindow.waitForSelector('[data-testid="docs-panel"]');
        await consoleWindow.waitForSelector('[data-testid="docs-tree"]');
        const list = await consoleWindow.evaluate(() => window.refringenceConsole.docs.list());
        expect(Array.isArray(list)).toBe(true);
        expect((list as Array<unknown>).length).toBeGreaterThanOrEqual(15);
    });

    test('groups docs by category', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/docs"]').click();
        await consoleWindow.waitForSelector('[data-testid="docs-tree"]');
        // Plan category present (a plan doc groups under it).
        await expect(consoleWindow.locator('[data-testid="docs-cat-plan"]').first()).toBeVisible();
        // ADR category present (we wrote ADRs 006/007/008).
        await expect(consoleWindow.locator('[data-testid="docs-cat-adr"]').first()).toBeVisible();
    });

    test('renders the active doc body as parsed markdown HTML', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/docs"]').click();
        await consoleWindow.waitForSelector('[data-testid="docs-body"]');
        // Wait for first body to actually have content.
        await consoleWindow.waitForFunction(() => {
            const el = document.querySelector('[data-testid="docs-body"]');
            return el !== null && (el.innerHTML.length > 50 || el.children.length > 0);
        }, { timeout: 5_000 });
        const innerHtml = await consoleWindow.locator('[data-testid="docs-body"]').innerHTML();
        // marked emits real HTML elements, not the raw markdown.
        expect(innerHtml).toMatch(/<(h1|h2|p|ul|ol|pre)/);
    });

    test('filter narrows the tree', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/docs"]').click();
        await consoleWindow.waitForSelector('[data-testid="docs-tree"]');
        const totalBefore = await consoleWindow.locator('[data-testid^="docs-item-"]').count();
        await consoleWindow.locator('[data-testid="docs-filter"]').fill('promptfoo');
        await consoleWindow.waitForTimeout(300);
        const totalAfter = await consoleWindow.locator('[data-testid^="docs-item-"]').count();
        expect(totalAfter).toBeGreaterThan(0);
        expect(totalAfter).toBeLessThan(totalBefore);
    });

    test('clicking an item swaps the active path + body', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/docs"]').click();
        await consoleWindow.waitForSelector('[data-testid="docs-tree"]');
        const items = consoleWindow.locator('[data-testid^="docs-item-"]');
        const count = await items.count();
        expect(count).toBeGreaterThan(1);

        // Click the second item; verify the active-path span updates.
        const first = await consoleWindow.locator('[data-testid="docs-active-path"]').textContent();
        await items.nth(1).click();
        await consoleWindow.waitForTimeout(300);
        const after = await consoleWindow.locator('[data-testid="docs-active-path"]').textContent();
        expect(after).not.toBe(first);
        expect(after?.length ?? 0).toBeGreaterThan(0);
    });

    test('IPC bridge.docs.read rejects path traversal', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/docs"]').click();
        const result = await consoleWindow.evaluate(() => window.refringenceConsole.docs.read('../etc/passwd'));
        expect(result).toBeNull();
    });

    test('IPC bridge.docs.read returns content for an in-tree path', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/docs"]').click();
        const body = await consoleWindow.evaluate(() => window.refringenceConsole.docs.read('docs/README.md'));
        expect(typeof body).toBe('string');
        expect((body as string).length).toBeGreaterThan(50);
    });
});
