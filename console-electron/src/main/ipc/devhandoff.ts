// console-electron/src/main/ipc/devhandoff.ts
//
// Dev-tool router IPC. Wraps ../devhandoff.ts. The Claude CLI run streams
// over console:devhandoff.claude.output / .complete (subscribed in the
// renderer the same way the runner is).
import { ipcMain, BrowserWindow } from 'electron';
import {
    detect,
    writeCursorRules,
    writeAgentsMd,
    invokeClaudeCli,
    openInCursor,
    type DevToolDetect,
    type WriteResult,
    type WriteMode,
    type ClaudeRunResult,
} from '../devhandoff';

export function registerDevHandoffHandlers(): void {
    ipcMain.handle('console:devhandoff.detect', (): DevToolDetect => {
        try {
            return detect();
        } catch {
            return { cursor: false, claudeCli: false, windsurf: false };
        }
    });

    ipcMain.handle(
        'console:devhandoff.writeCursorRules',
        (_e, root: string, content: string, mode?: WriteMode): WriteResult => {
            try {
                return writeCursorRules(root, content, mode ?? 'replace');
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    ipcMain.handle(
        'console:devhandoff.writeAgentsMd',
        (_e, root: string, content: string, mode?: WriteMode): WriteResult => {
            try {
                return writeAgentsMd(root, content, mode ?? 'replace');
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    ipcMain.handle(
        'console:devhandoff.runClaude',
        (e, opts: { prompt: string; cwd?: string }): ClaudeRunResult => {
            try {
                const win = BrowserWindow.fromWebContents(e.sender);
                return invokeClaudeCli(win, opts);
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    ipcMain.handle('console:devhandoff.openInCursor', async (_e, root?: string): Promise<WriteResult> => {
        try {
            return await openInCursor(root);
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
}
