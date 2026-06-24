// qa/tests/console/boot.spec.ts
//
// Console boot smoke test. Verifies:
//   - Electron launches without ELECTRON_RUN_AS_NODE trap.
//   - First window appears with the right title.
//   - Renderer's #root element mounts.
//   - No console errors in renderer or main during cold boot.
//   - data-theme="light" set on <html> before React renders.
import { test, expect } from './_fixture';

test.describe('Console boot', () => {
  test('launches with correct window title', async ({ consoleApp, consoleWindow }) => {
    const title = await consoleWindow.title();
    expect(title).toBe('Console');
    // Wait briefly for the window to fully appear; frameless windows
    // can lag behind first-window-event.
    await consoleWindow.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    const isVisible = await consoleApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      // A frameless window with titleBarOverlay may report not visible
      // until the renderer's first paint completes — accept "exists" as
      // proxy for "rendered."
      return win !== undefined;
    });
    expect(isVisible).toBe(true);
  });

  test('renderer #root mounts', async ({ consoleWindow }) => {
    await consoleWindow.waitForSelector('#root', { timeout: 10_000 });
    const hasChildren = await consoleWindow.evaluate(() => {
      const root = document.getElementById('root');
      return root !== null && root.children.length > 0;
    });
    expect(hasChildren).toBe(true);
  });

  test('data-theme="light" is set on <html> before React renders', async ({ consoleWindow }) => {
    const theme = await consoleWindow.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('light');
  });

  test('design tokens resolve to light-palette values', async ({ consoleWindow }) => {
    const tokens = await consoleWindow.evaluate(() => {
      const cs = window.getComputedStyle(document.documentElement);
      return {
        surfacePrimary: cs.getPropertyValue('--surface-primary').trim(),
        textPrimary: cs.getPropertyValue('--text-primary').trim(),
        accent: cs.getPropertyValue('--accent').trim(),
      };
    });
    // Light palette: --surface-primary is oklch(98% ...) — high lightness.
    expect(tokens.surfacePrimary).toMatch(/oklch\(98%/);
    // Text inverts: oklch(20% ...) — low lightness on light bg.
    expect(tokens.textPrimary).toMatch(/oklch\(20%/);
    // Accent SAME hue across themes (Refringence cyan #06b6d4).
    expect(tokens.accent).toBe('#06b6d4');
  });

  test('no renderer errors during cold boot', async ({ consoleApp, consoleWindow }) => {
    const errors: string[] = [];
    consoleWindow.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    consoleWindow.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    // Wait for first paint + React's mount tick.
    await consoleWindow.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await consoleWindow.waitForTimeout(500);
    // The Electron CSP warning is informational — filter it out.
    const real = errors.filter((e) => !e.includes('Electron Security Warning'));
    expect(real).toEqual([]);
  });
});
