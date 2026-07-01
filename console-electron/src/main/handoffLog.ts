// console-electron/src/main/handoffLog.ts
//
// The agent-run audit trail. Every time a prompt is handed to a dev tool, a line
// is appended to <root>/.refringence-console/handoff-log.jsonl. It records WHAT
// happened (tool, target, when) and a SHA-256 of the prompt for correlation -
// never the prompt text itself, so the log can be read or shared without leaking
// what was sent. Local-first; the file is gitignored with the rest of that dir.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export type HandoffTool = 'copy' | 'cursorrules' | 'agentsmd' | 'claude' | 'open-cursor';

export interface HandoffRecord {
    ts: string;              // ISO 8601
    tool: HandoffTool;
    target?: string;         // file written, 'clipboard', or 'cli'
    promptSha256?: string;   // hash for correlation, never the raw prompt
    promptChars?: number;    // length only
}

function logPath(root: string): string {
    return path.join(root, '.refringence-console', 'handoff-log.jsonl');
}

export function hashPrompt(text: string): { promptSha256: string; promptChars: number } | undefined {
    if (typeof text !== 'string' || text.length === 0) return undefined;
    return { promptSha256: createHash('sha256').update(text).digest('hex'), promptChars: text.length };
}

export function appendHandoff(root: string, tool: HandoffTool, target: string | undefined, promptText?: string): void {
    if (typeof root !== 'string' || root.length === 0) return;
    try {
        const dir = path.join(root, '.refringence-console');
        fs.mkdirSync(dir, { recursive: true });
        const rec: HandoffRecord = { ts: new Date().toISOString(), tool, target, ...hashPrompt(promptText ?? '') };
        fs.appendFileSync(logPath(root), JSON.stringify(rec) + '\n', 'utf8');
    } catch { /* the audit log is best-effort; never break a handoff over it */ }
}

export function readHandoffLog(root: string, limit = 30): HandoffRecord[] {
    if (typeof root !== 'string' || root.length === 0) return [];
    let raw: string;
    try { raw = fs.readFileSync(logPath(root), 'utf8'); } catch { return []; }
    const out: HandoffRecord[] = [];
    for (const line of raw.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
            const rec = JSON.parse(s) as HandoffRecord;
            if (rec && typeof rec.ts === 'string' && typeof rec.tool === 'string') out.push(rec);
        } catch { /* skip a corrupt line */ }
    }
    return out.slice(-limit).reverse();
}
