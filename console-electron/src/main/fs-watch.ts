// console-electron/src/main/fs-watch.ts
//
// Intelligent freshness: watch the active project for real file changes and
// notify the renderer (debounced) so it can invalidate just the cheap, visible
// queries. No polling, no tight loop - the watcher is event-driven and idle
// until the filesystem actually changes, and heavy directories are ignored.
import * as fs from 'node:fs';

const SKIP = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache',
    '.venv', '__pycache__', '.refringence-qa', '.refringence-console',
]);

let current: { watcher: fs.FSWatcher; root: string } | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

export function stopWatching(): void {
    if (debounce) { clearTimeout(debounce); debounce = null; }
    if (current) { try { current.watcher.close(); } catch { /* already closed */ } current = null; }
}

export function watchProject(root: string, onChange: () => void): void {
    if (current && current.root === root) return; // already watching this root
    stopWatching();
    if (!root || !fs.existsSync(root)) return;
    try {
        const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
            if (filename) {
                const parts = String(filename).split(/[\\/]/);
                if (parts.some((p) => SKIP.has(p))) return; // ignore noise from heavy dirs
            }
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(onChange, 800);
        });
        current = { watcher, root };
    } catch {
        // recursive watch unsupported on this platform, or a permission issue:
        // freshness falls back to staleTime + focus refetch, no crash.
    }
}
