// console-electron/src/main/lastProject.ts
//
// The last project the user opened, persisted in userData so a returning user
// reopens it on the next launch (and after an app update - userData survives
// both). A fresh install has no file here, so the first window shows onboarding.
// Only the FIRST window on launch restores it; new windows start empty.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

function storePath(): string {
    return path.join(app.getPath('userData'), 'last-project.json');
}

export function rememberLastProject(projectPath: string): void {
    try {
        if (typeof projectPath !== 'string' || projectPath.length === 0) return;
        fs.writeFileSync(storePath(), JSON.stringify({ lastProject: projectPath }), 'utf8');
    } catch {
        /* best effort */
    }
}

// The remembered project, only if it still exists as a directory (a moved or
// deleted project falls back to onboarding rather than booting into nothing).
export function readLastProject(): string | undefined {
    try {
        const obj = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as { lastProject?: unknown };
        const p = obj.lastProject;
        if (typeof p === 'string' && p.length > 0 && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            return p;
        }
    } catch {
        /* no file / unreadable */
    }
    return undefined;
}
