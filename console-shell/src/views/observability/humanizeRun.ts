import type { RunEntry } from '../../lib/bridge';
import { cleanCopy } from '../../lib/humanize';

/**
 * Turn a raw runId (e.g. "vibration-monitor-visible-2026-06-15T09-42-11Z")
 * into a human label suitable for tables and cards. Never returns the raw
 * runId.
 */
export interface HumanRunLabel {
    title: string;
    when: string;
    subline: string;
    /** Raw runId, for a title= hover fallback. */
    rawId: string;
}

const KIND_MAP: Record<string, string> = {
    smoke: 'Smoke run',
    eval: 'Eval run',
    evaluation: 'Eval run',
    regression: 'Regression run',
    qa: 'QA capture',
    capture: 'QA capture',
    e2e: 'End-to-end run',
    unit: 'Unit tests',
    integration: 'Integration run',
    perf: 'Performance run',
    a11y: 'Accessibility run',
    visual: 'Visual snapshot',
    snapshot: 'Visual snapshot',
    trace: 'Trace capture',
    vibration: 'Vibration capture',
    monitor: 'Monitor session',
};

// Short words that map to a fuller, readable form.
const WORD_MAP: Record<string, string> = {
    med: 'Medium',
    lg: 'Large',
    sm: 'Small',
    prod: 'Production',
    dev: 'Development',
};

const TOKEN_ACRONYMS = new Set(['qa', 'ci', 'cd', 'e2e', 'a11y', 'pr', 'ui', 'sbom', 'drc']);

/**
 * Humanize a single run-id token. Preserves a phase-style "letter+digits"
 * token (q0 -> Q0, e7 -> E7) as a single uppercased unit instead of
 * letting a blind toLowerCase().toUpperCase() round-trip mangle it (the
 * old code turned "q0" into "QO"). Known acronyms uppercase; a few short
 * words expand to a readable form; everything else is Title-cased.
 */
function humanizeToken(token: string): string {
    const lower = token.toLowerCase();
    if (/^[a-z]\d+[a-z]?$/.test(lower)) return lower.toUpperCase();
    if (TOKEN_ACRONYMS.has(lower)) return lower.toUpperCase();
    if (WORD_MAP[lower]) return WORD_MAP[lower];
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Strip a trailing ISO-ish timestamp (e.g. "-2026-06-15T09-42-11Z" or a
 * bare "-2026...") and split the remaining run id into tokens.
 */
function runIdTokens(runId: string): string[] {
    const stripped = runId.replace(/[-_]?\d{4}-\d{2}.*$/, '').replace(/[-_]?\d{4}.*$/, '');
    return stripped.split(/[-_]+/).filter(Boolean);
}

function pickKindLabel(runId: string, kindHint?: string): string {
    if (kindHint) {
        const words = kindHint.toLowerCase();
        for (const key of Object.keys(KIND_MAP)) {
            if (words.includes(key)) return KIND_MAP[key];
        }
    }
    const tokens = runIdTokens(runId);
    if (tokens.length === 0) return 'Run';
    // A bare kind id (e.g. "smoke", "eval-2026...") gets the friendly canned
    // phrase ("Smoke run"). When a phase/scope token leads (e.g. "q0-smoke"),
    // keep it readable as "Q0 smoke" rather than forcing "... run".
    const leadKind = KIND_MAP[tokens[0].toLowerCase()];
    if (leadKind && tokens.length === 1) return leadKind;
    return tokens
        .map((t, i) => {
            if (i === 0) return humanizeToken(t);
            // Subsequent tokens stay lowercase for readability ("Q0 smoke"),
            // except phase-style ids and known acronyms which must keep case.
            const lower = t.toLowerCase();
            if (/^[a-z]\d+[a-z]?$/.test(lower) || TOKEN_ACRONYMS.has(lower)) {
                return humanizeToken(t);
            }
            return WORD_MAP[lower] ? WORD_MAP[lower].toLowerCase() : lower;
        })
        .join(' ');
}

function formatWhen(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = Date.now();
    const diffMs = now - d.getTime();
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) {
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    const day = Math.round(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Turn a raw artifact-kind slug (e.g. "critique-agent-dock-presence")
 * into a human label: drop the "critique-" prefix, split on dashes/
 * underscores, Title Case each word.
 */
export function humanizeArtifactKind(kind: string): string {
    const cleaned = kind.replace(/^critique[-_]/i, '').replace(/[-_]+/g, ' ').trim();
    if (!cleaned) return 'Artifact';
    return cleaned
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Render a run's artifact kinds for a one-line summary. Lists humanized
 * names up to `max`; beyond that, falls back to an honest "N artifacts"
 * count so the line never becomes a raw comma-slug dump.
 */
export function summarizeArtifactKinds(kinds: string[], max = 3): string {
    if (kinds.length === 0) return 'no subdirectories';
    if (kinds.length > max) {
        return `${kinds.length.toLocaleString()} artifacts`;
    }
    return kinds.map(humanizeArtifactKind).join(', ');
}

export function humanizeRunLabel(run: RunEntry, kindHint?: string): HumanRunLabel {
    const rawTitle = pickKindLabel(run.runId, kindHint);
    const title = cleanCopy(rawTitle);
    const when = formatWhen(run.startedAt);
    const files = run.totalFiles;
    const subline =
        files === 0
            ? 'no files'
            : `${files.toLocaleString()} file${files === 1 ? '' : 's'}`;
    return { title, when, subline, rawId: run.runId };
}
