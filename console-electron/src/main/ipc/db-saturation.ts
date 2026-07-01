// console-electron/src/main/ipc/db-saturation.ts
//
// IPC handler for DB saturation alerting. The connection string is transient:
// passed per-call, used once, never stored. Only SELECTs run; never throws
// across IPC.
import { ipcMain } from 'electron';
import { dbSaturation, type DbSaturation } from '../db-saturation';

export function registerDbSaturationHandlers(): void {
    ipcMain.handle(
        'console:db.saturation',
        async (_e, root: string, connString: string): Promise<DbSaturation> => {
            // root is accepted for call-site symmetry with other checks handlers
            // but the saturation query is cluster-wide, not project-scoped.
            void root;
            try {
                return await dbSaturation(connString);
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );
}
