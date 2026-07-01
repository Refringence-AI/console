// console-electron/src/main/ipc/dead-config.ts
//
// IPC handler: console:deadconfig.scan(root) -> DeadConfigReport
//
// Delegates to the pure scanDeadConfig() function in ../dead-config.ts.
// Never throws across IPC; bad inputs return ok:false with an error message.
import { ipcMain } from 'electron';
import { scanDeadConfig, type DeadConfigReport } from '../dead-config';

const EMPTY_REPORT: DeadConfigReport = {
    ok: false,
    findings: [],
    counts: {
        'tsconfig-path': 0,
        'missing-script-file': 0,
        'unused-env': 0,
        'missing-extends': 0,
    },
    error: 'no root provided',
};

export function registerDeadConfigHandlers(): void {
    ipcMain.handle(
        'console:deadconfig.scan',
        async (_e, root: string): Promise<DeadConfigReport> => {
            if (typeof root !== 'string' || root.trim().length === 0) {
                return { ...EMPTY_REPORT };
            }
            try {
                return scanDeadConfig(root);
            } catch (err) {
                return {
                    ok: false,
                    findings: [],
                    counts: {
                        'tsconfig-path': 0,
                        'missing-script-file': 0,
                        'unused-env': 0,
                        'missing-extends': 0,
                    },
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    );
}
