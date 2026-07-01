/**
 * Per-window first-run flag.
 *
 * The GLOBAL flag (onboarded.ts) records "this user has onboarded at least
 * once". But onboarding/landing must be decided PER WINDOW: a brand-new window
 * (a fresh `?wid=`) with no project of its own should still see the landing,
 * even though the user onboarded long ago in another window. So the router
 * gates on THIS window having either an active project or its own finished
 * onboarding - never the global flag alone (that was the bug: a global flag
 * short-circuited the per-window check, so new windows skipped onboarding).
 *
 * Keyed by the `?wid=` the main process assigns per window, mirroring
 * activeProject.ts. The CommandPalette "reset onboarding" action clears both.
 */

function windowId(): string {
    if (typeof window === 'undefined') return '0';
    try {
        return new URLSearchParams(window.location.search).get('wid') || '0';
    } catch {
        return '0';
    }
}

const STORAGE_KEY = `refringence-console-onboarded:${windowId()}`;

export function readOnboardedForWindow(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeOnboardedForWindow(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
        /* noop */
    }
}

export function clearOnboardedForWindow(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* noop */
    }
}
