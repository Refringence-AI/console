// console-electron/src/main/ipc/pii-scan.ts
//
// IPC handler for PII + secret leakage scanning.
// Channel: console:pii.scan  - scan arbitrary text
// Channel: console:pii.scanFile - read a file then scan it
//
// Never returns the raw match; scanText / scanFile always redact.
import { ipcMain } from 'electron';
import { scanText, scanFile, PiiScanResult } from '../pii-scan';

export function registerPiiScanHandlers(): void {
    ipcMain.handle('console:pii.scan', (_evt, text: unknown): PiiScanResult => {
        if (typeof text !== 'string') {
            return { ok: false, error: 'text argument must be a string', findings: [], counts: {} as PiiScanResult['counts'] };
        }
        try {
            return scanText(text);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'unexpected error';
            return { ok: false, error: msg, findings: [], counts: {} as PiiScanResult['counts'] };
        }
    });

    ipcMain.handle('console:pii.scanFile', (_evt, projectRoot: unknown, filePath: unknown): PiiScanResult => {
        if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
            return { ok: false, error: 'projectRoot argument must be a non-empty string', findings: [], counts: {} as PiiScanResult['counts'] };
        }
        if (typeof filePath !== 'string' || filePath.trim().length === 0) {
            return { ok: false, error: 'filePath argument must be a non-empty string', findings: [], counts: {} as PiiScanResult['counts'] };
        }
        try {
            return scanFile(projectRoot, filePath);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'unexpected error';
            return { ok: false, error: msg, findings: [], counts: {} as PiiScanResult['counts'] };
        }
    });
}
