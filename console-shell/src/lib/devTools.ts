// Which AI coding tools the user works with, captured in onboarding. Drives the
// dev-tool handoff target (.cursor/rules vs AGENTS.md vs .claude/.codex) and the
// prompts/skills install target later. Persisted in localStorage (per app).

export type DevTool =
    | 'claude-code' | 'cursor' | 'codex' | 'windsurf' | 'copilot'
    | 'antigravity' | 'bolt' | 'lovable' | 'v0' | 'emergent';

export const DEV_TOOLS: { id: DevTool; name: string }[] = [
    { id: 'claude-code', name: 'Claude Code' },
    { id: 'cursor', name: 'Cursor' },
    { id: 'codex', name: 'Codex' },
    { id: 'windsurf', name: 'Windsurf' },
    { id: 'copilot', name: 'GitHub Copilot' },
    { id: 'antigravity', name: 'Antigravity' },
    { id: 'bolt', name: 'Bolt' },
    { id: 'lovable', name: 'Lovable' },
    { id: 'v0', name: 'v0' },
    { id: 'emergent', name: 'Emergent' },
];

const KEY = 'refringence-console-dev-tools';

export function readDevTools(): DevTool[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const valid = new Set(DEV_TOOLS.map((t) => t.id));
        return parsed.filter((t): t is DevTool => typeof t === 'string' && valid.has(t as DevTool));
    } catch {
        return [];
    }
}

export function writeDevTools(tools: DevTool[]): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(KEY, JSON.stringify(tools));
    } catch {
        /* noop */
    }
}
