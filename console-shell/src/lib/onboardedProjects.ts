/**
 * Per-PROJECT onboarding/setup state.
 *
 * Onboarding is a property of a project, not the app: a project that has been
 * set up once should boot straight to its overview forever; a project that has
 * never been set up - however it's opened (recent, last-project, the CLI, or the
 * Open-folder dialog) - should go through onboarding/setup. The global +
 * per-window flags (onboarded.ts / onboardedWindow.ts) only answer "has this
 * user/window seen the wizard at all"; THIS set answers "is THIS project set up",
 * which is what the router and the open-folder flow gate on.
 *
 * Stored globally (shared across windows) under one key - onboarding a project in
 * any window marks it set up everywhere.
 */

const STORAGE_KEY = 'refringence-console-onboarded-projects';

// Canonical path key so the same project matches regardless of who supplied the
// string: the main process resolves with backslashes (Windows), the renderer
// stores forward slashes, and paths are case-insensitive on Windows. Normalize
// all of that to one comparable form.
function norm(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function read(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
        return [];
    }
}

export function isProjectOnboarded(path: string | null | undefined): boolean {
    if (!path) return false;
    const n = norm(path);
    return read().some((p) => norm(p) === n);
}

export function markProjectOnboarded(path: string | null | undefined): void {
    if (!path || typeof window === 'undefined') return;
    try {
        const n = norm(path);
        const kept = read().filter((p) => norm(p) !== n);
        kept.push(n);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    } catch {
        /* noop */
    }
}

export function clearProjectOnboarded(path?: string): void {
    if (typeof window === 'undefined') return;
    try {
        if (!path) { window.localStorage.removeItem(STORAGE_KEY); return; }
        const n = norm(path);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(read().filter((p) => norm(p) !== n)));
    } catch {
        /* noop */
    }
}
