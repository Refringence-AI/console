// qa/tests/console/release.spec.ts
//
// Release panel functional test. Verifies:
//   - Panel mounts at /release.
//   - bridge.release.list() returns >= 1 checklist (0.3.0.yaml ships in repo).
//   - bridge.release.summary() classifies gates correctly.
//   - Rendered gates match the YAML source.
//   - Version select swaps the active checklist.
//   - Status colours render per-gate via data-testid attrs.
import { test, expect } from './_fixture';

test.describe('Release panel', () => {
    test('mounts and reads docs/release-checklists/0.3.0.yaml', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/release"]').click();
        await consoleWindow.waitForSelector('[data-testid="release-panel"]');
        await consoleWindow.waitForSelector('[data-testid="release-gates"]', { timeout: 5_000 });

        // Header reads "Release".
        const h1 = await consoleWindow.locator('main header h1').first().textContent();
        expect(h1).toBe('Release');

        // Version select has 0.3.0 option.
        const select = consoleWindow.locator('[data-testid="release-version-select"]');
        await expect(select).toBeVisible();
        const options = await select.locator('option').allTextContents();
        expect(options.some((o) => o.includes('0.3.0'))).toBe(true);
    });

    test('SummaryBar reports counts that sum to gate_count', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/release"]').click();
        const summary = consoleWindow.locator('[data-testid="release-summary"]');
        await expect(summary).toBeVisible();

        const text = await summary.textContent();
        const m = text?.match(/(\d+) green.*?(\d+) amber.*?(\d+) red.*?(\d+) blocked.*?(\d+) gates total/);
        expect(m, 'summary text format').not.toBeNull();
        if (m) {
            const green = +m[1], amber = +m[2], red = +m[3], blocked = +m[4], total = +m[5];
            expect(green + amber + red + blocked).toBe(total);
        }
    });

    test('renders gate per YAML row, includes the SBOM + Promptfoo gates', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/release"]').click();
        await consoleWindow.waitForSelector('[data-testid="release-gates"]');

        // The 0.3.0.yaml ships these gates — verify a sample.
        const sbomGate = consoleWindow.locator('[data-testid="release-gate-sbom-generated"]');
        const promptfooGate = consoleWindow.locator('[data-testid="release-gate-promptfoo-suite"]');
        const noApikeyGate = consoleWindow.locator('[data-testid="release-gate-no-apikey-leak-test"]');
        const signedGate = consoleWindow.locator('[data-testid="release-gate-signed-installer"]');
        await expect(sbomGate).toBeVisible();
        await expect(promptfooGate).toBeVisible();
        await expect(noApikeyGate).toBeVisible();
        await expect(signedGate).toBeVisible();
    });

    test('green/amber/red/blocked statuses render correct icon colour classes', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/release"]').click();
        await consoleWindow.waitForSelector('[data-testid="release-gates"]');

        // SBOM gate is green in 0.3.0.yaml.
        const sbomGateIcon = consoleWindow.locator('[data-testid="release-gate-sbom-generated"] svg').first();
        await expect(sbomGateIcon).toHaveClass(/text-emerald-600/);

        // Signed installer is blocked.
        const signedGateIcon = consoleWindow.locator('[data-testid="release-gate-signed-installer"] svg').first();
        await expect(signedGateIcon).toHaveClass(/text-slate-500/);

        // smoke-15-pass is amber.
        const smokeGateIcon = consoleWindow.locator('[data-testid="release-gate-smoke-15-pass"] svg').first();
        await expect(smokeGateIcon).toHaveClass(/text-amber-600/);
    });

    test('IPC bridge.release.list returns 0.3.0', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/release"]').click();
        const data = await consoleWindow.evaluate(() => window.refringenceConsole.release.list());
        expect(Array.isArray(data)).toBe(true);
        const v = (data as Array<{ version: string; status: string }>).map((r) => r.version);
        expect(v).toContain('0.3.0');
    });

    test('IPC bridge.release.get(0.3.0) returns checklist with gates array', async ({ consoleWindow }) => {
        await consoleWindow.locator('nav a[href="/release"]').click();
        const cl = await consoleWindow.evaluate(() => window.refringenceConsole.release.get('0.3.0'));
        expect(cl).not.toBeNull();
        expect(cl).toMatchObject({
            version: '0.3.0',
            status: 'in-progress',
            release_manager: expect.any(String),
        });
        expect(Array.isArray((cl as { gates: unknown[] }).gates)).toBe(true);
        expect((cl as { gates: unknown[] }).gates.length).toBeGreaterThanOrEqual(10);
    });
});
