// console-electron/src/main/ipc/checks.ts
//
// Deterministic project checks IPC. Runs the registered checks and returns one
// CheckResult per check. Pure read; never throws across IPC.
import { ipcMain } from 'electron';
import { runChecks, type CheckResult } from '../checks';
import { liveMigrationDiff, type LiveMigrationDiff } from '../migration-live';

export function registerChecksHandlers(): void {
    ipcMain.handle('console:checks.run', (_e, projectRoot: string): CheckResult[] => {
        try { return runChecks(projectRoot); } catch { return []; }
    });
    // Optional live database diff. The connection string is used once and never
    // stored; only SELECTs run. Total so a bad string never throws across IPC.
    ipcMain.handle('console:checks.migrationLiveDiff', async (_e, projectRoot: string, connString: string): Promise<LiveMigrationDiff> => {
        try { return await liveMigrationDiff(projectRoot, connString); }
        catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });
}
