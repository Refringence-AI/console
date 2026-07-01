// console-electron/src/main/ipc/ecn.ts
//
// IPC handler: console:ecn.generate
// Delegates to the pure generateEcn() function in ../ecn.ts.
// Never throws across IPC; bad inputs return ok:false with an error message.
import { ipcMain } from 'electron';
import { generateEcn, type EcnEntry } from '../ecn';

const NULL_ECN = (ref: string, at: string, error: string): EcnEntry => ({
    ok: false,
    ref,
    title: '',
    summary: '',
    impactedAreas: [],
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    risk: 'low',
    at,
    error,
});

export function registerEcnHandlers(): void {
    ipcMain.handle(
        'console:ecn.generate',
        async (_e, root: string, ref: string, at: string): Promise<EcnEntry> => {
            const safeRef = typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : 'HEAD';
            const safeAt = typeof at === 'string' && at.length > 0 ? at : new Date().toISOString();

            if (typeof root !== 'string' || root.length === 0) {
                return NULL_ECN(safeRef, safeAt, 'root is required');
            }
            try {
                return await generateEcn(root, safeRef, safeAt);
            } catch (err) {
                return NULL_ECN(
                    safeRef,
                    safeAt,
                    err instanceof Error ? err.message : String(err),
                );
            }
        },
    );
}
