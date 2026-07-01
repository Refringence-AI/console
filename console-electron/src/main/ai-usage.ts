// console-electron/src/main/ai-usage.ts
//
// A small append-only log of the assistant's token usage per turn, so spend can
// be sliced per model / session over time (AN-5). One JSON line per finished
// turn under userData; reads cap to the most recent events. No prompts or
// content are ever stored - only counts + the model id.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { UsageEvent } from './spend-attribution';

const MAX_EVENTS = 5000;

function usageFile(): string {
    return path.join(app.getPath('userData'), 'ai-usage.jsonl');
}

export function appendUsageEvent(e: UsageEvent): void {
    try {
        fs.appendFileSync(usageFile(), JSON.stringify(e) + '\n', 'utf8');
    } catch {
        /* spend tracking is best-effort; never break a chat turn over it */
    }
}

export function readUsageEvents(): UsageEvent[] {
    let raw: string;
    try { raw = fs.readFileSync(usageFile(), 'utf8'); } catch { return []; }
    const lines = raw.split('\n').filter(Boolean).slice(-MAX_EVENTS);
    const out: UsageEvent[] = [];
    for (const l of lines) {
        try { out.push(JSON.parse(l) as UsageEvent); } catch { /* skip a corrupt line */ }
    }
    return out;
}
