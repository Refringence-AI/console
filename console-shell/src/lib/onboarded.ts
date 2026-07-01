/**
 * First-run onboarding flag. P3.
 *
 * The split onboarding wizard writes this once the user finishes (or
 * skips) so a returning user boots straight into the shell. Capture and
 * smoke tests seed it directly to skip the wizard, so the key name is
 * fixed: 'refringence-console-onboarded'. The CommandPalette "reset
 * onboarding" action clears it.
 */

const STORAGE_KEY = 'refringence-console-onboarded';

export function readOnboarded(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeOnboarded(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
        /* noop */
    }
}

export function clearOnboarded(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* noop */
    }
}
