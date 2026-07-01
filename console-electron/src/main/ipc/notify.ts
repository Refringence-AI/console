// console-electron/src/main/ipc/notify.ts
//
// OS-level desktop notifications via Electron's Notification API. The
// renderer fires these on threshold crossings (e.g. errors going from
// zero to positive within a session). Guarded by Notification.isSupported()
// so it is a no-op on platforms without notification support.
import { ipcMain, Notification } from 'electron';

export function registerNotifyHandlers(): void {
    ipcMain.handle('console:notify', (_e, title: string, body: string) => {
        if (!Notification.isSupported()) return;
        if (typeof title !== 'string') return;
        new Notification({ title, body: typeof body === 'string' ? body : '' }).show();
    });
}
