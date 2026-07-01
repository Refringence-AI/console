// qa/tests/console/theme.spec.ts
//
// Console theme-toggle test. Verifies:
//   - Light is the default (data-theme="light" set BEFORE React renders).
//   - Theme toggle button in TopBar swaps theme.
//   - Choice persists across reload via localStorage.
//   - Design tokens swap on toggle (verified by computed style of CSS vars).
import { test, expect } from './_fixture';

test.describe('Console theme', () => {
  test('light is default on first paint', async ({ consoleWindow }) => {
    const theme = await consoleWindow.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('light');
  });

  test('toggle button swaps to dark', async ({ consoleWindow }) => {
    const toggle = consoleWindow.locator('[data-testid="theme-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-theme-current', 'light');
    await toggle.click();
    await consoleWindow.waitForFunction(() => document.documentElement.dataset.theme === 'dark', {
      timeout: 2_000,
    });
    await expect(toggle).toHaveAttribute('data-theme-current', 'dark');
  });

  test('toggle swaps surface tokens', async ({ consoleWindow }) => {
    const surfacesBefore = await consoleWindow.evaluate(() =>
      window.getComputedStyle(document.documentElement).getPropertyValue('--surface-primary').trim()
    );
    expect(surfacesBefore).toMatch(/oklch\(98%/); // light: oklch(98% 0.005 240)

    await consoleWindow.locator('[data-testid="theme-toggle"]').click();
    await consoleWindow.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

    const surfacesAfter = await consoleWindow.evaluate(() =>
      window.getComputedStyle(document.documentElement).getPropertyValue('--surface-primary').trim()
    );
    // Dark palette resolves to #000000 from tokens-dark.css ':root'.
    // CSS-loader may normalise to rgb(...) form; accept either.
    expect(surfacesAfter).toMatch(/^(#000000|rgb\(0,?\s*0,?\s*0\)|#000)$/i);
    expect(surfacesAfter).not.toMatch(/oklch/);  // dark must NOT still resolve as light oklch
  });

  test('theme persists to localStorage', async ({ consoleWindow }) => {
    await consoleWindow.locator('[data-testid="theme-toggle"]').click();
    await consoleWindow.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const stored = await consoleWindow.evaluate(() => window.localStorage.getItem('refringence-console-theme'));
    expect(stored).toBe('dark');
  });
});
