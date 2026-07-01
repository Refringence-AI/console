// console-electron/src/main/ipc/devtools-config.ts
//
// IPC for the dev-tool AI config viewer: scan the project for each coding tool's
// config files and return them parsed. Pure read; never throws across IPC.
import { ipcMain } from 'electron';
import { scanDevtools, type DevToolsScan } from '../devtools-scan';

export function registerDevtoolsConfigHandlers(): void {
    ipcMain.handle('console:devtoolsConfig.scan', (_e, projectRoot: string): DevToolsScan => {
        try {
            return scanDevtools(projectRoot);
        } catch {
            return { root: '', scannedAt: new Date().toISOString(), tools: [], presentCount: 0 };
        }
    });
}
