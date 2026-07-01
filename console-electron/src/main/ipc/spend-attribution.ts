// console-electron/src/main/ipc/spend-attribution.ts
//
// IPC handler: console:spend.attribute
// Wraps attributeSpend(); pure computation, no network.
// The caller passes sampledAt so results are reproducible in tests.
import { ipcMain } from 'electron';
import { attributeSpend, type UsageEvent, type SpendReport } from '../spend-attribution';

const EMPTY_REPORT: SpendReport = {
    total: {
        tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        costUsd: { input: 0, output: 0, total: 0 },
    },
    byModel:   [],
    byRoute:   [],
    bySession: [],
    unknownModels: [],
    windowDays: 30,
    sampledAt: '',
};

export function registerSpendAttributionHandlers(): void {
    ipcMain.handle(
        'console:spend.attribute',
        (
            _evt,
            events: UsageEvent[],
            windowDays?: number,
            sampledAt?: string,
        ): SpendReport => {
            const at = typeof sampledAt === 'string' && sampledAt
                ? sampledAt
                : new Date().toISOString();
            const days =
                typeof windowDays === 'number' && Number.isFinite(windowDays) && windowDays > 0
                    ? windowDays
                    : 30;
            if (!Array.isArray(events)) return { ...EMPTY_REPORT, sampledAt: at, windowDays: days };
            try {
                return attributeSpend(events, days, at);
            } catch {
                return { ...EMPTY_REPORT, sampledAt: at, windowDays: days };
            }
        },
    );
}
