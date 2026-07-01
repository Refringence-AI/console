// console-electron/src/main/ipc/dora.ts
//
// IPC handler: console:dora.metrics
// Delegates to the pure computeDoraMetrics() function in ../dora.ts.
// Never throws across IPC; bad inputs return a null-filled result.
import { ipcMain } from 'electron';
import { computeDoraMetrics, type DoraMetrics } from '../dora';

const NULL_METRICS: DoraMetrics = {
    deployFreqPerWeek: null,
    leadTimeHours: null,
    changeFailRatePct: null,
    mttrHours: null,
    windowDays: 90,
    sampledAt: new Date().toISOString(),
};

export function registerDoraHandlers(): void {
    ipcMain.handle(
        'console:dora.metrics',
        async (_e, root: string, windowDays?: number): Promise<DoraMetrics> => {
            if (typeof root !== 'string' || root.length === 0) return NULL_METRICS;
            const days =
                typeof windowDays === 'number' && Number.isFinite(windowDays) && windowDays > 0
                    ? Math.min(windowDays, 365)
                    : 90;
            try {
                return await computeDoraMetrics(root, days);
            } catch {
                return { ...NULL_METRICS, sampledAt: new Date().toISOString() };
            }
        },
    );
}
