// console-electron/src/main/ipc/guidelines.ts
//
// Project guideline IPC (Phase P6). Thin wrapper over ../guidelines.ts:
// generate the markdown, write it into AGENTS.md / .cursorrules via the
// shared managed-block writers, and report whether the block exists.
// Every handler is total: it try/catches and resolves rather than throwing
// across the bridge.
import { ipcMain } from 'electron';
import {
    generateGuideline,
    writeGuideline,
    guidelineStatus,
    type GuidelineTarget,
    type GuidelineStatus,
} from '../guidelines';
import type { WriteResult } from '../devhandoff';

export function registerGuidelinesHandlers(): void {
    ipcMain.handle('console:guidelines.generate', (): { ok: boolean; content?: string; error?: string } => {
        try {
            return { ok: true, content: generateGuideline() };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle('console:guidelines.write', (_e, root: string, target: GuidelineTarget): WriteResult => {
        try {
            const t: GuidelineTarget = target === 'cursorrules' ? 'cursorrules' : 'agents-md';
            return writeGuideline(root, t);
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle('console:guidelines.status', (_e, root?: string): GuidelineStatus => {
        try {
            return guidelineStatus(root);
        } catch {
            return { agentsMd: false, cursorRules: false };
        }
    });
}
