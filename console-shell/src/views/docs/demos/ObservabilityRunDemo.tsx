import { useMemo } from 'react';
import { RunningIndicator } from '@/components/RunningIndicator';
import { LiveConsole } from '@/components/LiveConsole';
import type { RunLine } from '../../../lib/useRunner';

/**
 * A projection of the Observability panel's live run surface. Unlike the other
 * demos this one mounts the REAL RunningIndicator and LiveConsole components
 * with static props: both are prop-driven, so the doc shows the exact
 * spinner + elapsed clock and the exact terminal styling a real run produces.
 *
 * startedAt is seeded a few seconds back so the elapsed clock reads a non-zero
 * value and keeps ticking, which is what makes the projection feel live.
 */
const LINES: RunLine[] = [
    { line: '> refringence-console@0.3.0 smoke', stream: 'stdout', ts: 0 },
    { line: 'Scanning .refringence-qa/runs ...', stream: 'stdout', ts: 0 },
    { line: 'smoke: 14 checks, 14 passed', stream: 'stdout', ts: 0 },
    { line: 'warning: 1 empty run skipped', stream: 'stderr', ts: 0 },
    { line: 'artifacts written to .refringence-qa/runs/2026-06-18T09-12-03Z', stream: 'stdout', ts: 0 },
];

export function ObservabilityRunDemo() {
    // Fixed offset so the elapsed clock starts a little above zero. Computed
    // once per mount; the indicator ticks it forward on its own.
    const startedAt = useMemo(() => Date.now() - 47_000, []);
    return (
        <div className="flex w-full max-w-[520px] flex-col gap-2">
            <RunningIndicator
                label="Run smoke"
                startedAt={startedAt}
                runId="demo-run"
                onStop={() => {
                    /* projection only: the docs demo does not start a real process */
                }}
            />
            <LiveConsole lines={LINES} />
        </div>
    );
}
