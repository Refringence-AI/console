// console-electron/src/main/ipc/window.ts
//
// Window controls for the frameless window. The renderer draws the
// minimize / maximize / close buttons (WindowControls.tsx) and calls these
// handlers, so there is no OS-drawn caption overlay (and no colour seam).
import { ipcMain, BrowserWindow, screen } from 'electron';

export function registerWindowHandlers(): void {
    ipcMain.handle('console:window.minimize', (e) => {
        BrowserWindow.fromWebContents(e.sender)?.minimize();
    });

    // Toggle and report the resulting state so the renderer can swap the
    // maximize/restore icon without a round-trip.
    ipcMain.handle('console:window.toggleMaximize', (e): boolean => {
        const win = BrowserWindow.fromWebContents(e.sender);
        if (!win) return false;
        if (win.isMaximized()) {
            win.unmaximize();
            return false;
        }
        win.maximize();
        return true;
    });

    ipcMain.handle('console:window.close', (e) => {
        BrowserWindow.fromWebContents(e.sender)?.close();
    });

    ipcMain.handle('console:window.isMaximized', (e): boolean => {
        return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
    });

    // Grow the window when the right chat dock opens so content is not
    // squished. We only add what fits inside the display's work area; a
    // maximized window already fills it, so we no-op there. Returns the px
    // actually added so the renderer can restore exactly on close.
    ipcMain.handle('console:window.growForDock', (e, extraWidth: number): number => {
        const win = BrowserWindow.fromWebContents(e.sender);
        if (!win || win.isMaximized() || win.isFullScreen()) return 0;
        const want = Math.max(0, Math.round(Number(extraWidth) || 0));
        if (want === 0) return 0;
        const [x, y] = win.getPosition();
        const [w, h] = win.getSize();
        const work = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
        const maxRight = work.x + work.width;
        const grow = Math.min(want, Math.max(0, maxRight - (x + w)));
        if (grow > 0) win.setSize(w + grow, h);
        return grow;
    });
}
