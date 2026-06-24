// console-electron/src/main/ipc/version.ts
//
// Tiny IPC handler returning Console's own version + Electron + Node.
import { ipcMain, app, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Targets shell.openPath must never launch: shell.openPath runs the path with
// its registered OS handler, so an executable/script extension would be code
// execution.
const BLOCKED_OPEN_EXT = new Set([
    '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp', '.lnk',
    '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta',
    '.cpl', '.jar', '.reg', '.sh',
]);

export function registerVersionHandlers(): void {
    ipcMain.handle('console:getVersion', () => {
        const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
        let consoleVersion = 'dev';
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
            if (pkg.version) consoleVersion = pkg.version;
        } catch {
            /* keep dev */
        }
        return {
            name: app.getName(),
            version: consoleVersion,
            electron: process.versions.electron ?? 'unknown',
            node: process.versions.node ?? 'unknown',
        };
    });

    ipcMain.handle('console:openExternal', async (_e, url: string) => {
        if (typeof url !== 'string') return;
        // http(s) + mailto only. NEVER file:// — shell.openExternal('file://...')
        // (incl. UNC file://host/share) would launch a local/remote executable
        // via the OS handler. Local opens go through console:openPath instead.
        if (!/^(https?|mailto):/i.test(url)) return;
        await shell.openExternal(url);
    });

    // Open a local path (folder or file) in the OS file manager / default
    // app. Unlike openExternal('file://...'), this works on Windows for
    // relative paths: a hostless file:// URL silently fails there. Accepts
    // an absolute path or a repo-relative one (resolved against
    // the current dir). shell.openPath returns '' on success or an error
    // message string.
    ipcMain.handle('console:openPath', async (_e, p: string): Promise<{ ok: boolean; error?: string }> => {
        if (typeof p !== 'string' || p.length === 0) {
            return { ok: false, error: 'No path provided' };
        }
        let abs: string;
        try {
            abs = path.isAbsolute(p) ? p : path.resolve(p);
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        // Refuse UNC / network paths (\\host\share or //host/share) — opening one
        // can trigger an outbound SMB auth (NTLM-hash leak) or run a remote exe.
        if (/^\\\\/.test(abs) || /^\/\//.test(abs)) {
            return { ok: false, error: 'Network paths are not allowed' };
        }
        // Refuse executable/script targets — shell.openPath launches them via the
        // OS handler, so this would be code execution if a path ever reached here
        // from untrusted content.
        if (BLOCKED_OPEN_EXT.has(path.extname(abs).toLowerCase())) {
            return { ok: false, error: 'That file type cannot be opened from Console' };
        }
        const error = await shell.openPath(abs);
        return error ? { ok: false, error } : { ok: true };
    });
}
