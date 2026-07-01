// console-shell/src/views/overview/WhatsNextTile.tsx
//
// Bento-style "What is next" tile on the Overview band system.
// Surfaces 1-3 plain-English suggestions computed by the registry.
// HARD RULE: no chatbot widget. No textarea. No 'Ask AI'.

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Card, SectionLabel } from '@/components/ui';
import { suggestNext } from '../../lib/ai/registry';
import type { NextSuggestion, OverviewState } from '../../lib/ai/rules';
import type { MetricsSummary, ReleaseSummary, ObsCounters } from '../../lib/bridge';

interface Props {
    metrics: MetricsSummary | undefined;
    release: ReleaseSummary | null | undefined;
    obs: ObsCounters | undefined;
    // The Operator cockpit labels this block with its own section header,
    // so the internal "What is next" header is suppressed there.
    hideHeader?: boolean;
    // Route of the headline alert. When the top suggestion deep-links to the
    // same target, the alert already states it, so drop that one NEXT row to
    // avoid restating the same signal twice.
    suppressTopTo?: string;
}

const SEVERITY_RANK: Record<NextSuggestion['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2,
};

function daysSince(iso: string | null): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86_400_000);
}

function toOverviewState(p: Props): OverviewState {
    const state: OverviewState = {};

    if (p.release) {
        state.release = {
            version: p.release.version,
            blocked: p.release.overall_status === 'blocked' ? Math.max(p.release.blocked, 1) : p.release.blocked,
            red: p.release.overall_status === 'red' ? Math.max(p.release.red, 1) : p.release.red,
            amber: p.release.amber,
            green: p.release.green,
        };
    }

    if (p.metrics) {
        const lastRunDays = daysSince(p.metrics.promptfoo.last_run);
        state.evals = {
            lastRunIso: p.metrics.promptfoo.last_run,
            lastRunDays,
            failed: p.metrics.promptfoo.failed,
            errors: p.metrics.promptfoo.errors,
        };
        state.sbom = {
            present: p.metrics.sbom.present,
            components: p.metrics.sbom.components,
        };
    }

    if (p.obs) {
        // Map obs errors_last_24h into a synthetic "issues.openCritical"
        // bucket so the rules engine produces an obs-aware suggestion.
        state.issues = {
            openCritical: p.obs.errors_last_24h,
            openTotal: p.obs.runs,
        };
    }

    return state;
}

export function WhatsNextTile({ metrics, release, obs, hideHeader = false, suppressTopTo }: Props) {
    const [suggestions, setSuggestions] = useState<NextSuggestion[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const state = toOverviewState({ metrics, release, obs });
        suggestNext(state).then((all) => {
            if (cancelled) return;
            const filtered = all.filter((s) => s.id !== 'all-clear' ? true : all.length === 1);
            const sorted = [...filtered].sort(
                (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
            );
            // If the top suggestion deep-links to the same place as the
            // headline alert, the alert already states it; drop just that row.
            const deduped = suppressTopTo && sorted[0]?.to === suppressTopTo
                ? sorted.slice(1)
                : sorted;
            setSuggestions(deduped.slice(0, 3));
            setLoading(false);
        }).catch(() => {
            if (cancelled) return;
            setSuggestions([]);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [metrics, release, obs, suppressTopTo]);

    return (
        <Card
            data-testid="ov-whats-next"
            className="sm:col-span-2 xl:col-span-3 gap-2 p-4 shadow-none"
        >
            {!hideHeader && (
                <SectionLabel>What is next</SectionLabel>
            )}
            {loading ? (
                <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Computing next suggestions">
                    <div className="h-3 animate-pulse rounded bg-secondary/40" style={{ width: '85%' }} />
                    <div className="h-3 animate-pulse rounded bg-secondary/40" style={{ width: '70%' }} />
                    <div className="h-3 animate-pulse rounded bg-secondary/40" style={{ width: '55%' }} />
                </div>
            ) : suggestions.length === 0 ? (
                <p className="text-small text-muted-foreground/70">
                    Nothing to recommend right now.
                </p>
            ) : (
                <ul className="flex flex-col divide-y divide-border/60">
                    {suggestions.map((s) => {
                        const row = (
                            <>
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone(s.severity)}`} />
                                <span className="flex-1">{cleanLabel(s.label)}</span>
                                {s.to && (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                                )}
                            </>
                        );
                        return (
                            <li
                                key={s.id}
                                className="text-body text-foreground"
                            >
                                {s.to ? (
                                    <Link
                                        to={s.to}
                                        className="group flex items-center gap-2 py-1.5 hover:text-foreground"
                                    >
                                        {row}
                                    </Link>
                                ) : (
                                    <div className="flex items-center gap-2 py-1.5">{row}</div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
}

function dotTone(sev: NextSuggestion['severity']): string {
    if (sev === 'critical') return 'bg-danger';
    if (sev === 'warning') return 'bg-warning';
    return 'bg-muted-foreground/50';
}

function cleanLabel(label: string): string {
    let s = label.replace(/severity:\s*/gi, '');
    s = s.replace(/,\s*no run on record yet\.?/i, '. No run on record yet.');
    return s;
}
