// console-electron/src/main/ipc/ground.ts
//
// Grounding IPC: turn an error or stack trace into a fix prompt anchored to the
// files that actually exist in this repo. Read-only; never throws across IPC.
import { ipcMain } from 'electron';
import { groundError, type GroundedError } from '../grounding';

export function registerGroundHandlers(): void {
    ipcMain.handle('console:ground.error', (_e, root: string, errorText: string): GroundedError => {
        try { return groundError(root, errorText); }
        catch { return { foundPaths: [], mentioned: [], prompt: '' }; }
    });
}
