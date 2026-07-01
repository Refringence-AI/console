// console-electron/src/main/ipc/ai-config.ts
//
// IPC handler for AI coding-tool config detection.
// Channel: console:aiconfig.detect(root) -> AiConfigReport
//
// Never throws across the IPC boundary; always returns {ok, ...} shape.
import { ipcMain } from 'electron';
import { detectAiConfigs, type AiConfigReport } from '../ai-config';

export function registerAiConfigHandlers(): void {
    ipcMain.handle(
        'console:aiconfig.detect',
        (_evt, root: unknown): AiConfigReport => {
            if (typeof root !== 'string' || root.trim().length === 0) {
                return { ok: false, tools: [], error: 'root argument must be a non-empty string' };
            }
            try {
                return detectAiConfigs(root);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'unexpected error';
                return { ok: false, tools: [], error: msg };
            }
        },
    );
}
