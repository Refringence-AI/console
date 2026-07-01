// console-electron/src/main/ipc/fs-watch.ts
//
// console:fs.watch(root) starts watching that project (or stops, on '') and
// pushes console:fs.projectChanged to the renderer on a debounced change.
import { ipcMain, BrowserWindow } from 'electron';
import { watchProject, stopWatching } from '../fs-watch';

export function registerFsWatchHandlers(): void {
    ipcMain.handle('console:fs.watch', (e, root: string): void => {
        try {
            if (typeof root !== 'string' || !root) { stopWatching(); return; }
            const win = BrowserWindow.fromWebContents(e.sender);
            watchProject(root, () => {
                if (win && !win.isDestroyed()) win.webContents.send('console:fs.projectChanged');
            });
        } catch {
            /* never throw across IPC */
        }
    });
}
