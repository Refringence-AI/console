// console-shell/src/lib/ai/rules.ts
//
// Rule-based fallbacks for the AI fabric. T0 capabilities never hit the
// network; they read OverviewState shape and return deterministic,
// human-readable suggestions and explanations.

export interface OverviewState {
    release?: {
        version?: string;
        blocked?: number;
        red?: number;
        amber?: number;
        green?: number;
    };
    evals?: {
        lastRunIso?: string | null;
        lastRunDays?: number | null;
        failed?: number;
        errors?: number;
    };
    issues?: {
        openCritical?: number;
        openTotal?: number;
    };
    sbom?: {
        present?: boolean;
        components?: number;
    };
}

export interface NextSuggestion {
    id: string;
    label: string;
    rationale: string;
    severity: 'info' | 'warning' | 'critical';
    /** Optional route the consumer may navigate to. */
    to?: string;
}

/**
 * Generate a ranked list of "do this next" suggestions from cached
 * overview state. Pure function, no I/O.
 */
export function suggestNextRule(state: OverviewState): NextSuggestion[] {
    const out: NextSuggestion[] = [];
    const rel = state.release ?? {};
    const ev = state.evals ?? {};
    const iss = state.issues ?? {};
    const sb = state.sbom ?? {};

    if ((rel.blocked ?? 0) > 0) {
        out.push({
            id: 'release-blocked',
            label: `Open Release panel, ${rel.blocked} gate${rel.blocked === 1 ? '' : 's'} blocked.`,
            rationale: `Release ${rel.version ?? 'in progress'} has ${rel.blocked} blocked gate${rel.blocked === 1 ? '' : 's'}. These cannot ship until cleared.`,
            severity: 'critical',
            to: '/release',
        });
    }
    if ((rel.red ?? 0) > 0) {
        out.push({
            id: 'release-red',
            label: `Triage ${rel.red} red gate${rel.red === 1 ? '' : 's'} on ${rel.version ?? 'current release'}.`,
            rationale: 'Red gates failed their last check. Investigate the artifact link in the Release panel.',
            severity: 'critical',
            to: '/release',
        });
    }

    if (typeof ev.lastRunDays === 'number' && ev.lastRunDays > 7) {
        out.push({
            id: 'evals-stale',
            label: `Run evals, last run was ${ev.lastRunDays} day${ev.lastRunDays === 1 ? '' : 's'} ago.`,
            rationale: 'Eval drift is the leading indicator of regressions. Weekly cadence keeps the safety nets honest.',
            severity: ev.lastRunDays > 14 ? 'critical' : 'warning',
            to: '/observability',
        });
    } else if (ev.lastRunIso === null || typeof ev.lastRunDays !== 'number') {
        out.push({
            id: 'evals-never',
            label: 'Run evals, no run on record yet.',
            rationale: 'The eval harness has not produced output for this checkout. Kick off the first run to establish a baseline.',
            severity: 'warning',
            to: '/observability',
        });
    }
    if ((ev.failed ?? 0) > 0) {
        out.push({
            id: 'evals-failed',
            label: `Investigate ${ev.failed} failed eval${ev.failed === 1 ? '' : 's'}.`,
            rationale: 'Failed evals usually point at a recently merged change. Pair with the latest commit window.',
            severity: 'warning',
            to: '/observability',
        });
    }

    if ((iss.openCritical ?? 0) > 0) {
        out.push({
            id: 'issues-critical',
            label: `Resolve ${iss.openCritical} severity:critical issue${iss.openCritical === 1 ? '' : 's'}.`,
            rationale: 'Critical issues block release and accumulate compounding risk.',
            severity: 'critical',
            to: '/issues',
        });
    }

    if (sb.present === false) {
        out.push({
            id: 'sbom-missing',
            label: 'Generate SBOM, no CycloneDX file on record.',
            rationale: 'Compliance gates and supply-chain reviews depend on a fresh CycloneDX SBOM.',
            severity: 'warning',
            to: '/release',
        });
    }

    if (out.length === 0) {
        out.push({
            id: 'all-clear',
            label: 'No blockers detected. Keep shipping.',
            rationale: 'Release gates are green and evals are fresh.',
            severity: 'info',
        });
    }
    return out;
}

const EXPLAINERS: Record<string, string> = {
    SBOM: 'Software Bill of Materials, the CycloneDX JSON listing every npm + Python dep.',
    evals: 'Promptfoo regression suite that runs prompts against expected outputs and grades pass/fail/cost.',
    Promptfoo: 'Open-source LLM eval harness for grading prompt outputs against expected results.',
    'QA runs': 'Captured test artifacts, including Playwright traces, screenshots, and eval reports.',
    'smoke tests': 'Boot-time checks that the app launches and core flows respond.',
    'eval-harness': 'A directory of LLM evaluation configs and judge prompts.',
    'repo-map': 'The packages, files, and language breakdown produced by the Repo panel.',
    CycloneDX: 'Industry-standard SBOM JSON schema. We emit spec_version 1.5 or newer.',
    'severity:critical': 'GitHub label meaning the issue blocks release.',
};

export function explainRule(label: string): string {
    const direct = EXPLAINERS[label];
    if (direct) return direct;
    // Case-insensitive fallback.
    const lower = label.toLowerCase();
    for (const [k, v] of Object.entries(EXPLAINERS)) {
        if (k.toLowerCase() === lower) return v;
    }
    return `No cached explainer for "${label}". Enable a higher AI tier for on-demand definitions.`;
}

/**
 * Pick the candidate label that best matches the input text by a naive
 * token-overlap score. Lowercase + word-boundary split, no stemming.
 */
export function categorizeRule(text: string, candidates: string[]): string {
    if (candidates.length === 0) return '';
    const tokens = tokenize(text);
    if (tokens.size === 0) return candidates[0];
    let best = candidates[0];
    let bestScore = -1;
    for (const cand of candidates) {
        const cTokens = tokenize(cand);
        let score = 0;
        for (const t of cTokens) if (tokens.has(t)) score++;
        // Tie-breaker: prefer the candidate whose label tokens are more
        // covered (precision), so 'docs' wins over 'docs and onboarding'
        // when the input is short.
        const precision = cTokens.size > 0 ? score / cTokens.size : 0;
        const composite = score + precision;
        if (composite > bestScore) {
            bestScore = composite;
            best = cand;
        }
    }
    return best;
}

function tokenize(s: string): Set<string> {
    return new Set(
        s
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((t) => t.length > 1),
    );
}
