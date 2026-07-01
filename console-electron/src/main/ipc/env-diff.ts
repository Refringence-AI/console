// console-electron/src/main/ipc/env-diff.ts
//
// IPC handler for env-key diff.
// Channel: console:env.diff(projectRoot) -> EnvDiff
//
// Privacy contract: only key NAMES cross the IPC boundary, never values.
import { ipcMain } from 'electron';
import { diffEnvKeys, type EnvDiff } from '../env-diff';

export function registerEnvDiffHandlers(): void {
    ipcMain.handle('console:env.diff', (_evt, projectRoot: string): EnvDiff => {
        try {
            return diffEnvKeys(projectRoot);
        } catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                hasExample: false,
                hasEnv: false,
                missingInEnv: [],
                extraInEnv: [],
                inSync: false,
            };
        }
    });
}
