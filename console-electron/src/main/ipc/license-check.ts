// console-electron/src/main/ipc/license-check.ts
//
// IPC handler: console:license.check
// Wraps license-check.checkLicenses; deterministic, no network.
import { ipcMain } from 'electron';
import { checkLicenses } from '../license-check';
import type { LicenseReport } from '../license-check';

export function registerLicenseCheckHandlers(): void {
    ipcMain.handle(
        'console:license.check',
        (_evt, root: string): LicenseReport => {
            try {
                return checkLicenses(root);
            } catch (err) {
                return {
                    ok: false,
                    projectLicense: null,
                    totalScanned: 0,
                    truncated: false,
                    flagged: [],
                    counts: { permissive: 0, 'weak-copyleft': 0, 'strong-copyleft': 0, unknown: 0 },
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    );
}
