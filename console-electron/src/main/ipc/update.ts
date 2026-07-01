// console-electron/src/main/ipc/update.ts
//
// In-app auto-update surface. Wraps electron-updater's autoUpdater singleton:
// forwards its lifecycle events to every renderer over console:update.event so
// the UI can show an "update ready" banner, and exposes check/install actions.
//
// Default electron-updater behaviour is a silent background download + an OS
// notification on completion (checkForUpdatesAndNotify). We instead drive a
// visible in-app banner: the update still downloads in the background, but the
// user sees a "Restart to update" button and stays in control of when it lands.

import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'not-available'
    | 'downloaded'
    | 'error';

export interface UpdateEvent {
    status: UpdateStatus;
    version?: string; // the new version (downloading / downloaded)
    percent?: number; // 0..100 while downloading
    message?: string; // error text, when status === 'error'
}

function broadcast(event: UpdateEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('console:update.event', event);
    }
}

let wired = false;

export function registerUpdateHandlers(): void {
    // Renderer-driven "check now" (e.g. from Settings). No-op in dev.
    ipcMain.handle('console:update.check', async () => {
        if (!app.isPackaged) return { ok: false, reason: 'dev' };
        try {
            await autoUpdater.checkForUpdates();
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: String(err) };
        }
    });
    // Quit and install the downloaded update. isSilent=true runs the NSIS
    // installer with /S so the assisted wizard (license + destination pages) is
    // skipped on update -- a quiet in-place swap + relaunch with no wizard,
    // like VS Code / Cursor. Install is per-user (perMachine:false), so /S writes to
    // %LOCALAPPDATA% and needs no elevation / UAC prompt. isForceRunAfter=true
    // relaunches the app. Squirrel.Mac swaps the bundle. No-op if nothing staged.
    ipcMain.handle('console:update.install', () => {
        autoUpdater.quitAndInstall(true, true);
    });

    if (wired || !app.isPackaged) return;
    wired = true;

    // autoDownload defaults to true: the new version downloads in the background
    // as soon as it's found; we surface the banner only once it's ready.
    autoUpdater.on('checking-for-update', () => broadcast({ status: 'checking' }));
    autoUpdater.on('update-available', (info) =>
        broadcast({ status: 'downloading', version: info?.version }));
    autoUpdater.on('update-not-available', () => broadcast({ status: 'not-available' }));
    autoUpdater.on('download-progress', (p) =>
        broadcast({ status: 'downloading', percent: Math.round(p?.percent ?? 0) }));
    autoUpdater.on('update-downloaded', (info) =>
        broadcast({ status: 'downloaded', version: info?.version }));
    autoUpdater.on('error', (err) =>
        broadcast({ status: 'error', message: String(err?.message ?? err) }));
}

// Kick an initial check shortly after launch (packaged only). Called from
// main.ts after the IPC handlers + window exist so the first event has a
// renderer to reach.
export function checkForUpdatesOnStartup(): void {
    if (!app.isPackaged) return;
    autoUpdater.checkForUpdates().catch((err) => {
        console.error('[console:updater]', err);
    });
}
