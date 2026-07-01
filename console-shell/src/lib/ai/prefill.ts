// console-shell/src/lib/ai/prefill.ts
//
// One-shot handoff of a drafted prompt into the /ai chat. The prompt panel
// stashes text here, navigates to /ai, and the chat composer reads-then-
// clears it on mount. sessionStorage (not a route param) keeps long bodies
// out of the URL and survives the navigate within the same window.

const KEY = 'refringence-console-ai-prefill';

export function setAiPrefill(text: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(KEY, text);
    } catch {
        /* noop */
    }
}

// Read and clear in one call so the prefill only lands once.
export function takeAiPrefill(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const v = window.sessionStorage.getItem(KEY);
        if (v != null) window.sessionStorage.removeItem(KEY);
        return v;
    } catch {
        return null;
    }
}
