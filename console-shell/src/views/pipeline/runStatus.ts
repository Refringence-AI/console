// Shared workflow run -> status-pill mapping for both Pipeline personas.
//
// Workflow-level only: we look at the latest run's conclusion/status and
// collapse it to one of three pill states. Anything we cannot positively
// classify (null conclusion on a finished run, unknown status) returns
// null so the caller renders NOTHING rather than a grey "broken
// telemetry" dot.
import type { WorkflowRun } from '../../lib/bridge';

export type RunPill = 'passing' | 'failing' | 'running';

export function pillFor(run: WorkflowRun | undefined): RunPill | null {
    if (!run) return null;
    if (run.conclusion === 'success') return 'passing';
    if (run.conclusion === 'failure') return 'failing';
    if (run.conclusion === null && (run.status === 'in_progress' || run.status === 'queued')) {
        return 'running';
    }
    return null;
}

export function pillLabel(p: RunPill): string {
    if (p === 'passing') return 'Passing';
    if (p === 'failing') return 'Failing';
    return 'Running';
}

export function pillClasses(p: RunPill): string {
    if (p === 'passing') return 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400';
    if (p === 'failing') return 'bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/30 dark:text-rose-400';
    return 'bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-400';
}

// Short tooltip like "fix: widen TopBar - 2h ago" for the run pill.
export function pillTooltip(run: WorkflowRun): string {
    const when = relativeTime(run.createdAt);
    const title = run.displayTitle?.trim();
    return title ? `${title}${when ? ` - ${when}` : ''}` : when;
}

export function relativeTime(iso: string): string {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const secs = Math.floor((Date.now() - then) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

// "as of HH:MM" freshness stamp from a react-query dataUpdatedAt epoch.
export function asOf(updatedAtMs: number | undefined): string {
    if (!updatedAtMs) return '';
    const d = new Date(updatedAtMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `as of ${hh}:${mm}`;
}
