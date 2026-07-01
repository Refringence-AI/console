// console-electron/src/main/ipc/generate.ts
//
// Deterministic project-file generation IPC. Writes a template only when the
// file is absent; total so a bad request never throws across IPC.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import { generateFile, type GenResult } from '../generators';

function safeRoot(root: string): boolean {
    try { return typeof root === 'string' && root.length > 0 && fs.statSync(root).isDirectory(); } catch { return false; }
}

export function registerGenerateHandlers(): void {
    ipcMain.handle('console:generate.file', (_e, root: string, kind: string): GenResult => {
        try {
            if (!safeRoot(root)) return { ok: false, error: 'Invalid project.' };
            if (kind !== 'gitignore' && kind !== 'license' && kind !== 'readme') return { ok: false, error: 'Unknown file.' };
            return generateFile(root, kind);
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
}
