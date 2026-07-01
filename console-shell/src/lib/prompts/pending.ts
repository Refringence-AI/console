// console-shell/src/lib/prompts/pending.ts
//
// One-shot handoff of a prompt id when the command palette jumps to a specific
// prompt: the palette stashes the id, navigates to /prompts, and the panel
// reads-then-clears it on mount so it lands on that prompt instead of the first.

const KEY = 'refringence-console-pending-prompt';

export function setPendingPrompt(id: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(KEY, id);
    } catch {
        /* noop */
    }
}

// Read and clear in one call so the selection only lands once.
export function takePendingPrompt(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const v = window.sessionStorage.getItem(KEY);
        if (v != null) window.sessionStorage.removeItem(KEY);
        return v;
    } catch {
        return null;
    }
}
