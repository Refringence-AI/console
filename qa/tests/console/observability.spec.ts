import { test, expect } from './_fixture';

test.describe('Observability panel', () => {
    test('mounts at /observability with counter strip', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/observability"]').click();
        await consoleWindow.waitForSelector('[data-testid="observability-panel"]');
        await expect(consoleWindow.locator('[data-testid="obs-counters"]')).toBeVisible();
    });

    test('IPC obs.counters returns 4 numeric fields', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/observability"]').click();
        const c = await consoleWindow.evaluate(() => window.refringenceConsole.obs.counters());
        const counters = c as { runs: number; runs_last_24h: number; errors: number; errors_last_24h: number };
        expect(typeof counters.runs).toBe('number');
        expect(typeof counters.runs_last_24h).toBe('number');
        expect(typeof counters.errors).toBe('number');
        expect(typeof counters.errors_last_24h).toBe('number');
        // We've run several QA suites this session, so >= 1 is reasonable.
        expect(counters.runs).toBeGreaterThan(0);
    });

    test('IPC obs.runs returns array of RunEntry with required fields', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/observability"]').click();
        const r = await consoleWindow.evaluate(() => window.refringenceConsole.obs.runs());
        const runs = r as Array<{
            runId: string;
            artifactKinds: string[];
            totalFiles: number;
            totalBytes: number;
        }>;
        expect(Array.isArray(runs)).toBe(true);
        expect(runs.length).toBeGreaterThan(0);
        expect(typeof runs[0].runId).toBe('string');
        expect(Array.isArray(runs[0].artifactKinds)).toBe(true);
    });
});
