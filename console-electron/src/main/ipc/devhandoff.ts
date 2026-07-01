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
import { scanText, type PromptLeak } from './secrets';
import { appendHandoff, readHandoffLog, type HandoffRecord } from '../handoffLog';

export function registerDevHandoffHandlers(): void {
    ipcMain.handle('console:devhandoff.detect', (): DevToolDetect => {
        try {
            return detect();
        } catch {
            return { cursor: false, claudeCli: false, windsurf: false };
        }
    });

    // Leakage guard: scan a prompt for secret formats before it is handed off.
    ipcMain.handle('console:devhandoff.scanText', (_e, text: string): PromptLeak[] => {
        try { return scanText(text); } catch { return []; }
    });

    // Audit trail: the renderer logs a clipboard copy (the only handoff that
    // doesn't pass through a main handler); the others log themselves below.
    ipcMain.handle('console:devhandoff.logCopy', (_e, root: string, text: string): void => {
        appendHandoff(root, 'copy', 'clipboard', text);
    });

    ipcMain.handle('console:devhandoff.recentHandoffs', (_e, root: string): HandoffRecord[] => {
        try { return readHandoffLog(root); } catch { return []; }
    });

    ipcMain.handle(
        'console:devhandoff.writeCursorRules',
        (_e, root: string, content: string, mode?: WriteMode): WriteResult => {
            try {
                const res = writeCursorRules(root, content, mode ?? 'replace');
                if (res.ok) appendHandoff(root, 'cursorrules', res.path, content);
                return res;
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    ipcMain.handle(
        'console:devhandoff.writeAgentsMd',
        (_e, root: string, content: string, mode?: WriteMode): WriteResult => {
            try {
                const res = writeAgentsMd(root, content, mode ?? 'replace');
                if (res.ok) appendHandoff(root, 'agentsmd', res.path, content);
                return res;
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
                const res = invokeClaudeCli(win, opts);
                if (res.ok && opts.cwd) appendHandoff(opts.cwd, 'claude', 'cli', opts.prompt);
                return res;
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    ipcMain.handle('console:devhandoff.openInCursor', async (_e, root?: string): Promise<WriteResult> => {
        try {
            const res = await openInCursor(root);
            if (res.ok && root) appendHandoff(root, 'open-cursor', 'editor', undefined);
            return res;
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
}
