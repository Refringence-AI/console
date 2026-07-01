// console-electron/src/main/ipc/setup.ts
//
// Keyless project-readiness scaffolding: detect which common files are missing
// and write them on request. All deterministic, no network, no AI key.
import { ipcMain } from 'electron';
import { detectSetup, scaffoldSetup, type SetupItem, type SetupScaffoldResult } from '../setup';

export function registerSetupHandlers(): void {
    ipcMain.handle('console:setup.detect', (_e, root: string): SetupItem[] => {
        try { return detectSetup(root); } catch { return []; }
    });

    ipcMain.handle('console:setup.scaffold', (_e, root: string, id: string): SetupScaffoldResult => {
        try { return scaffoldSetup(root, id); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });
}
