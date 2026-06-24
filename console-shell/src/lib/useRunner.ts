// console-shell/src/lib/useRunner.ts
//
// Renderer-side state for the streaming process runner. Subscribes once
// to runner.onOutput / runner.onComplete and accumulates per-run state.
// Panels call start()/stop() and read `runs`. Phase 1b substrate; panels
// wire in Phase 3.
import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge, type RunnerStartOpts, type RunnerOutput, type RunnerComplete } from './bridge';

export type RunStatus = 'running' | 'done' | 'failed' | 'killed';

export interface RunLine {
    line: string;
    stream: 'stdout' | 'stderr';
    ts: number;
}

export interface RunState {
    runId: string;
    label: string;
    status: RunStatus;
    lines: RunLine[];
    exitCode?: number | null;
    startedAt: number;
    durationMs?: number;
}

export interface UseRunner {
    start(opts: RunnerStartOpts): Promise<string>;
    stop(runId: string): Promise<void>;
    runs: RunState[];
}

export function useRunner(): UseRunner {
    const [runs, setRuns] = useState<RunState[]>([]);
    // Label is known at start() time but lines arrive by runId; keep a
    // pending-label map so the first output line can name the run.
    const labelsRef = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        const offOutput = bridge.runner.onOutput((e: RunnerOutput) => {
            setRuns((prev) => {
                const idx = prev.findIndex((r) => r.runId === e.runId);
                const newLine: RunLine = { line: e.line, stream: e.stream, ts: e.ts };
                if (idx === -1) {
                    const created: RunState = {
                        runId: e.runId,
                        label: labelsRef.current.get(e.runId) ?? e.runId,
                        status: 'running',
                        lines: [newLine],
                        startedAt: e.ts,
                    };
                    return [...prev, created];
                }
                const next = prev.slice();
                next[idx] = { ...next[idx], lines: [...next[idx].lines, newLine] };
                return next;
            });
        });

        const offComplete = bridge.runner.onComplete((e: RunnerComplete) => {
            setRuns((prev) => {
                const idx = prev.findIndex((r) => r.runId === e.runId);
                const status: RunStatus = e.killed
                    ? 'killed'
                    : e.exitCode === 0
                        ? 'done'
                        : 'failed';
                if (idx === -1) {
                    return [...prev, {
                        runId: e.runId,
                        label: labelsRef.current.get(e.runId) ?? e.runId,
                        status,
                        lines: [],
                        exitCode: e.exitCode,
                        startedAt: Date.now() - e.durationMs,
                        durationMs: e.durationMs,
                    }];
                }
                const next = prev.slice();
                next[idx] = { ...next[idx], status, exitCode: e.exitCode, durationMs: e.durationMs };
                return next;
            });
        });

        return () => {
            offOutput();
            offComplete();
        };
    }, []);

    const start = useCallback(async (opts: RunnerStartOpts): Promise<string> => {
        const { runId } = await bridge.runner.start(opts);
        const label = opts.label ?? `${opts.kind} ${opts.args.join(' ')}`.trim();
        if (runId) {
            labelsRef.current.set(runId, label);
            setRuns((prev) => prev.some((r) => r.runId === runId)
                ? prev
                : [...prev, { runId, label, status: 'running', lines: [], startedAt: Date.now() }]);
        }
        return runId;
    }, []);

    const stop = useCallback(async (runId: string): Promise<void> => {
        await bridge.runner.stop(runId);
    }, []);

    return { start, stop, runs };
}
