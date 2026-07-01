/**
 * Title and copy humanization for chrome strings.
 *
 * Strips dev-leak prefixes (Q3a:, [E7e], phase codes), file extensions,
 * em-dashes, and other artifacts so backend strings render cleanly in
 * the production UI.
 */

export function humanizeTitle(raw: string): string {
    let s = raw.replace(/^Q\d+[a-z]?:\s*/i, '');
    s = s.replace(/^\[[A-Z]+\d+[a-z]?\]\s*/i, '');
    s = s.replace(/^[A-Z]+-\d+:\s*/, '');
    s = s.replace(/\.(md|tsx?|jsx?|json|ya?ml|toml)$/i, '');
    s = s.replace(/[_-]+/g, ' ');
    s = s.replace(/\s*[—–]\s*/g, ': ');
    s = s.replace(/\s+/g, ' ').trim();
    // Screaming identifiers (PULL REQUEST TEMPLATE) -> Title Case. Leave
    // mixed-case titles untouched so embedded acronyms (JSONL, SBOM,
    // CycloneDX) survive intact.
    if (/[A-Z]/.test(s) && !/[a-z]/.test(s)) {
        s = s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
    } else if (s.length > 0) {
        s = s.charAt(0).toUpperCase() + s.slice(1);
    }
    return s;
}

export function stripIssueCode(title: string): string {
    return title.replace(/^[A-Z]+-\d+:\s*/, '').trim();
}

/**
 * Genericizes leftover codename / scratch-path artifacts in user-facing
 * strings before they reach a product user. Conservative on purpose: only
 * org repo-slug prefixes, phase codenames, and internal scratch paths are
 * touched.
 */
export function scrubInternal(text: string): string {
    let s = text;
    // Repo paths: keep the bare repo name, drop the org prefix.
    s = s.replace(/\bRefringence-AI\/[\w.-]+/gi, (m) => m.split('/').pop() ?? m);
    // Codenames -> dropped.
    s = s.replace(/\bPhase\s+Q\b/gi, '');
    s = s.replace(/\bPhase\s+E\d+[a-z]?\b/gi, '');
    // Internal scratch path prefix -> dropped.
    s = s.replace(/\.refringence-console\//gi, '');
    return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Cleans a raw GitHub issue title for display to any persona. Strips, in
 * order, a leading PHASE prefix in all of its observed forms, a leaked
 * "<2+ UPPER> <num>/<num>:" code (e.g. "HE 006/007:"), and a
 * "<UPPER>-<num>:" issue code (stripIssueCode), then runs humanizeTitle on
 * the remainder.
 *
 * PHASE forms handled (bracket may sit around PHASE, around the code, or be
 * absent, with an optional trailing colon):
 *   "[PHASE E12] foo", "[PHASE] E12 foo", "PHASE E12: foo", "[PHASE E12]: foo"
 */
export function cleanIssueTitle(raw: string): string {
    let s = raw.replace(
        /^\[?\s*PHASE\s*\]?\s*\[?\s*[A-Z]?\d+[a-z]?\s*\]?\s*:?\s*/i,
        '',
    );
    s = s.replace(/^[A-Z]{2,}\s+\d+\/\d+:\s*/, '');
    // scrubInternal can strip a leading codename mid-title and leave an orphaned
    // separator (": Cloud collab") or a lowercased first word ("the assistant
    // placeholder ..."). Drop the orphan separator, then re-case the first letter.
    let out = scrubInternal(humanizeTitle(stripIssueCode(s))).replace(/^[\s:–—-]+/, '').trim();
    if (out.length > 0) out = out.charAt(0).toUpperCase() + out.slice(1);
    return out;
}

/**
 * Strips a leading conventional-commit type/scope prefix (feat:, fix(ui):,
 * chore(split):, docs!:) so a commit subject reads as plain activity rather
 * than raw git log. Non-conforming subjects pass through untouched. The
 * remainder is sentence-cased.
 */
export function humanizeCommitSubject(subject: string): string {
    const m = subject.match(/^[a-z]+(\([^)]*\))?!?:\s+(.+)$/i);
    const rest = (m ? m[2] : subject).trim();
    if (rest.length === 0) return subject;
    return scrubInternal(rest.charAt(0).toUpperCase() + rest.slice(1));
}

/**
 * Strips internal repo-migration breadcrumbs out of a repository description
 * before it reaches a product user. Drops a trailing "moved to ... see
 * docs/..." dev note (the migration note left in the repo description) and any
 * bare "see docs/FOO.md" pointer. Returns the cleaned description, or an empty
 * string if nothing meaningful is left.
 */
export function cleanRepoDescription(text: string): string {
    let s = text
        .replace(/[.\s]*\bmoved to\b.*$/is, '')
        .replace(/[.\s]*\bsee\s+docs\/\S+/gis, '');
    s = s.replace(/\s+/g, ' ').replace(/[\s.,;:-]+$/, '').trim();
    return s;
}

export function cleanCopy(text: string): string {
    return scrubInternal(
        text
            .replace(/\s*[—–]\s*/g, ': ')
            .replace(/\s+/g, ' ')
            .trim(),
    );
}
