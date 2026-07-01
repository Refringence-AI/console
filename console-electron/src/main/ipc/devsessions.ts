// console-electron/src/main/ipc/devsessions.ts
//
// Read-only IPC over the user's local AI coding-tool history. list/read are pure
// reads; clean turns a captured chunk into a reusable template. Saving reuses
// the existing prompts.create channel. Reads are guarded to the user's own
// ~/.claude/projects tree so a renderer-supplied path can never escape it.
import { ipcMain } from 'electron';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    listSessions,
    readSession,
    cleanPromptText,
    type DevSession,
    type DevTurn,
    type DevPlan,
    type CleanedPrompt,
} from '../devsessions';

// Reads are confined to the known AI-tool history dirs under the user's own
// home / AppData, so a renderer-supplied path can never escape into the repo
// or the wider filesystem.
function safeSessionPath(p: string): boolean {
    try {
        const resolved = path.resolve(p).replace(/\\/g, '/').toLowerCase();
        const appData = (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')).replace(/\\/g, '/').toLowerCase();
        const home = os.homedir().replace(/\\/g, '/').toLowerCase();
        const roots = [
            `${home}/.claude/projects/`,
            `${home}/.codex/`,
            `${appData}/code/user/workspacestorage/`,
            `${appData}/cursor/user/workspacestorage/`,
        ];
        return roots.some((r) => resolved.startsWith(r))
            && (resolved.endsWith('.jsonl') || resolved.endsWith('.json') || resolved.endsWith('state.vscdb'));
    } catch {
        return false;
    }
}

export function registerDevSessionsHandlers(): void {
    ipcMain.handle('console:devsessions.list', (_e, projectRoot: string): DevSession[] => {
        try { return listSessions(projectRoot); } catch { return []; }
    });
    ipcMain.handle('console:devsessions.read', (_e, sessionPath: string): { turns: DevTurn[]; plans: DevPlan[] } => {
        try {
            if (!safeSessionPath(sessionPath)) return { turns: [], plans: [] };
            return readSession(sessionPath);
        } catch {
            return { turns: [], plans: [] };
        }
    });
    ipcMain.handle('console:devsessions.clean', (_e, text: string, projectRoot?: string): CleanedPrompt => {
        try { return cleanPromptText(typeof text === 'string' ? text : '', projectRoot); } catch { return { body: '', variables: [] }; }
    });
}
