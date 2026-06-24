// console-electron/src/main/main.ts
//
// Console — main process entry. Owns the BrowserWindow lifecycle, the
// frameless chrome, and registers every console:* IPC handler.
//
// Light theme by default. No gradients, no glassmorphism — a restrained
// shadcn/Radix design language via the shared packages/design-tokens/.

import { app, BrowserWindow, ipcMain, shell, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerAllConsoleIpc } from './ipc/index';
import { checkForUpdatesOnStartup } from './ipc/update';

// Resolve a project folder passed on the command line, e.g. `console .` or
// `console C:\path\to\repo`. The NSIS installer adds Console's directory to
// PATH, so the exe name itself is the launcher (Windows resolves `console` to
// Adopt a project folder ONLY when it is passed as an EXPLICIT absolute
// directory path (an "Open with Console" target or a second-instance open).
// Crucially, never resolve a relative/spurious arg against the cwd and never
// adopt the bare launch directory: on a normal GUI launch the shell's cwd is
// often the user's Desktop, and the old code adopted it as the project, which
// silently skipped onboarding and (via writeActiveProject) poisoned every later
// window. Returns undefined unless the arg is an absolute directory other than
// the working directory.
function projectPathFromArgv(argv: string[]): string | undefined {
    const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
    const last = args[args.length - 1];
    if (!last || !path.isAbsolute(last)) return undefined;
    try {
        const resolved = path.resolve(last);
        if (resolved === path.resolve(process.cwd())) return undefined;
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    } catch {
        /* not a usable path */
    }
    return undefined;
}

app.setName('Console');

// Honour REFRINGENCE_CONSOLE_USER_DATA so QA tests get isolated state.
// Each Playwright test sets a fresh temp dir; without this override the
// Console would share the default %APPDATA%\Console\ across
// tests and localStorage would leak (theme toggle, saved views, etc.).
const qaUserData = process.env.REFRINGENCE_CONSOLE_USER_DATA;
if (qaUserData) {
    app.setPath('userData', qaUserData);
}

// Swallow EPIPE so a detached parent shell doesn't crash the Console.
(process.stdout as NodeJS.WriteStream).on?.('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
});
(process.stderr as NodeJS.WriteStream).on?.('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
});
process.on('uncaughtException', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
    console.error('[console:main] uncaughtException', err);
});

let mainWindow: BrowserWindow | null = null;

function createConsoleWindow(projectPath?: string): BrowserWindow {
    const win = new BrowserWindow({
        width: 1480,
        height: 940,
        minWidth: 1100,
        minHeight: 700,
        // Q3a Flo migration. The buttons visually sit over the panel
        // header band which paints `bg-card` (= oklch(1 0 0) light =
        // pure white). First paint matches so there's no colour shift
        // before CSS loads.
        backgroundColor: '#ffffff',
        title: 'Console',
        // Windows taskbar icon. .ico (PNG-embedded) for crisp render at
        // 16/32/48/256. SVG works for the window but Win11's taskbar
        // group needs a real ICO.
        icon: path.resolve(__dirname, '..', '..', 'resources', 'console.ico'),
        autoHideMenuBar: true,
        // Frameless: no OS-drawn chrome. The window controls (minimize /
        // maximize / close) are rendered in React by WindowControls.tsx and
        // call console:window.* IPC. Removing the OS titleBarOverlay removes
        // the caption band entirely, so there is no colour seam / rectangle
        // around the buttons in any theme.
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    const isDev = process.env.REFRINGENCE_CONSOLE_DEV === '1';
    const rendererUrl = process.env.REFRINGENCE_CONSOLE_RENDERER_URL ?? 'http://localhost:5174';
    // Packaged: the renderer is copied next to the app as an extraResource
    // (resources/renderer). Dev-built (npm start, not packaged): the sibling
    // console-shell/dist. Dev-server mode is handled by isDev below.
    const indexHtml = app.isPackaged
        ? path.join(process.resourcesPath, 'renderer', 'index.html')
        : path.resolve(__dirname, '..', '..', '..', 'console-shell', 'dist', 'index.html');

    // Dev-only: forward renderer console output to the terminal. Gated off in
    // packaged builds so renderer log lines are never echoed to main stdout in
    // production (avoids any chance of a logged value landing in process logs).
    if (!app.isPackaged) {
        win.webContents.on('console-message', (event) => {
            const levels = ['debug', 'info', 'warning', 'error'];
            const idx = Number(event.level);
            const levelName = (Number.isFinite(idx) ? levels[idx] : undefined) ?? 'info';
            console.log(`[console:renderer:${levelName}] ${event.sourceId}:${event.lineNumber} ${event.message}`);
        });
    }
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.error(`[console:renderer:load-failed] code=${code} desc="${desc}" url=${url}`);
    });

    // --- Security hardening -------------------------------------------------
    // Route any window.open / target=_blank / external link to the OS browser;
    // never open it as an in-app window (which would run external content with
    // the app's privileges). Deny everything else.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });
    // Block full-page navigation away from the bundled renderer. SPA routing
    // uses the history API (no will-navigate), so this only fires on a real
    // navigation attempt (a clicked link / redirect) — which we hand to the OS
    // browser instead. A reload (same URL) is allowed through.
    win.webContents.on('will-navigate', (event, url) => {
        if (url === win.webContents.getURL()) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    });
    // Console needs no web permissions (camera/mic/geolocation/notifications/
    // etc.); deny every request by default.
    win.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));

    // Keep the custom WindowControls maximize/restore icon in sync with the
    // real window state (covers double-click drag, Win+Up, snap, etc.).
    const sendMaxState = () => {
        if (!win.isDestroyed()) win.webContents.send('console:window.maximized-changed', win.isMaximized());
    };
    win.on('maximize', sendMaxState);
    win.on('unmaximize', sendMaxState);

    // Each window carries a stable id in the URL (?wid=) so the renderer can
    // scope its active project per window. BrowserWindow.id is stable for the
    // window's lifetime and the query survives reloads, so several windows can
    // each hold a different project.
    const wid = String(win.id);
    // A project path passed on the CLI rides along on the window URL so the
    // renderer's router can adopt it as this window's active project and skip
    // straight to the overview (see router.tsx).
    const query: Record<string, string> = projectPath ? { wid, project: projectPath } : { wid };
    if (isDev) {
        const devUrl = projectPath
            ? `${rendererUrl}?wid=${wid}&project=${encodeURIComponent(projectPath)}`
            : `${rendererUrl}?wid=${wid}`;
        win.loadURL(devUrl).catch((err) => {
            console.error('[console:main:loadURL failed]', err);
        });
        win.webContents.openDevTools({ mode: 'detach' });
    } else {
        win.loadFile(indexHtml, { query }).catch((err) => {
            console.error('[console:main:loadFile failed]', err);
        });
    }

    win.on('closed', () => {
        if (win === mainWindow) mainWindow = null;
    });

    return win;
}

// Single instance: a second `console <path>` invocation routes to the already
// running process (second-instance) and opens a new window there, rather than
// spawning a rival process. Console is multi-window by design, so this keeps
// one process owning all the windows.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        createConsoleWindow(projectPathFromArgv(argv));
    });

    app.whenReady().then(() => {
        // Content-Security-Policy for the renderer (production / file:// loads;
        // skipped under the Vite dev server, whose HMR injects its own inline
        // scripts). DOMPurify sanitizes all dynamic HTML; this CSP is the
        // defense-in-depth net — no remote scripts, no objects/frames, locked
        // base-uri. The single 'sha256-…' covers the inline theme-bootstrap
        // script in index.html.
        const isDevServer = process.env.REFRINGENCE_CONSOLE_DEV === '1';
        if (!isDevServer) {
            const csp = [
                "default-src 'self'",
                "script-src 'self' 'sha256-CCLiEdSKCAMHHrj3c2c4CNeTfsKRoce/HK584LDxsaM='",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: https:",
                "font-src 'self' data:",
                "connect-src 'self' https: ws://localhost:* http://localhost:*",
                "object-src 'none'",
                "base-uri 'none'",
                "frame-src 'none'",
                "form-action 'none'",
            ].join('; ');
            session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
                callback({
                    responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
                });
            });
        }

        registerAllConsoleIpc();

        // Auto-update from GitHub Releases (packaged only). The lifecycle events
        // drive the in-app "Restart to update" pill via console:update.event;
        // the new version downloads in the background.
        checkForUpdatesOnStartup();

        // New-window action: opens a fresh window that starts at onboarding /
        // connect-a-project, so the user can work on several projects at once.
        ipcMain.handle('console:window.new', () => {
            createConsoleWindow();
        });
        // Reflect the active project in the OS window title so multiple windows
        // are distinguishable on the taskbar and Alt-Tab.
        ipcMain.handle('console:window.setTitle', (e, title: string) => {
            const w = BrowserWindow.fromWebContents(e.sender);
            if (w && typeof title === 'string') w.setTitle(title || 'Console');
        });

        // First window honours a project path passed on the command line.
        mainWindow = createConsoleWindow(projectPathFromArgv(process.argv));

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                mainWindow = createConsoleWindow();
            }
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
