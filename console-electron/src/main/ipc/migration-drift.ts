// console-electron/src/main/ipc/migration-drift.ts
//
// IPC handler for file-based migration drift detection.
// Channel: console:migrations.scan(root: string) -> MigrationReport
// Pure read; deterministic; never throws across IPC.
import { ipcMain } from 'electron';
import { scanMigrations, type MigrationReport } from '../migration-drift';

export function registerMigrationDriftHandlers(): void {
    ipcMain.handle('console:migrations.scan', (_evt, root: string): MigrationReport => {
        if (typeof root !== 'string' || root.trim().length === 0) {
            return {
                ok: false, tool: 'unknown', dir: '',
                count: 0, migrations: [], gaps: [], warnings: [],
                error: 'root path is required',
            };
        }
        try {
            return scanMigrations(root.trim());
        } catch (err) {
            return {
                ok: false, tool: 'unknown', dir: root.trim(),
                count: 0, migrations: [], gaps: [], warnings: [],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    });
}
