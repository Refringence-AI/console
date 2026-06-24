// Shared formatting for the inferred ProjectShape and per-package roles.
//
// Both Overview (lede prose) and Repo (orientation header + structure)
// render the same inferred shape, so the article/casing rules and the
// role taxonomy live here rather than being re-derived per view. The
// goal is orientation prose, not LOC ranking: what is it, how to run it.

import type { ProjectShape } from './bridge';

/** "An" before a vowel sound, "A" otherwise. Cheap heuristic, good enough. */
function indefiniteArticle(word: string): string {
    return /^[aeiou]/i.test(word) ? 'An' : 'A';
}

/**
 * One or two plain sentences describing the project, built from the
 * inferred shape. The Guided lede orients ("what is it, how to run it")
 * and deliberately omits the line count: a raw LOC figure here fights
 * that goal by ranking size before purpose. LOC lives on the Operator
 * Files tab instead. The `totalLoc` argument stays for call-site
 * compatibility but no longer feeds the lede.
 *
 * Examples:
 *   "A Node.js web app. Start with npm start."
 *   "A Rust binary. Run it with cargo run."
 *   "A TypeScript codebase."
 */
export function describeShape(shape: ProjectShape, _totalLoc?: number): string {
    const sentences: string[] = [];

    if (shape.projectType && shape.projectType !== 'Unknown') {
        sentences.push(`${indefiniteArticle(shape.projectType)} ${shape.projectType}.`);
    } else if (shape.primaryLanguage && shape.primaryLanguage !== 'Unknown') {
        sentences.push(`${indefiniteArticle(shape.primaryLanguage)} ${shape.primaryLanguage} codebase.`);
    } else {
        sentences.push('A codebase we could not classify from its manifests.');
    }

    if (shape.runnable && shape.startCommand) {
        sentences.push(`Start with ${shape.startCommand}.`);
    }

    return sentences.join(' ');
}

/** "5,240 lines across 8 packages." / "1,102 lines." / "" when unknown. */
export function describeSize(totalLoc?: number, packageCount?: number): string {
    if (typeof totalLoc !== 'number' || totalLoc <= 0) return '';
    const lines = `${totalLoc.toLocaleString()} lines`;
    if (packageCount && packageCount > 1) {
        return `${lines} across ${packageCount.toLocaleString()} packages.`;
    }
    return `${lines}.`;
}

/** Terse one-liner for the Operator subtitle: "Node.js web app · npm start · 8 packages". */
export function shapeSubtitle(shape: ProjectShape, totalLoc?: number): string {
    const parts: string[] = [];
    if (shape.projectType && shape.projectType !== 'Unknown') {
        parts.push(shape.projectType);
    } else if (shape.primaryLanguage && shape.primaryLanguage !== 'Unknown') {
        parts.push(shape.primaryLanguage);
    }
    if (shape.runnable && shape.startCommand) parts.push(shape.startCommand);
    if (shape.packageCount > 1) parts.push(`${shape.packageCount.toLocaleString()} packages`);
    if (typeof totalLoc === 'number' && totalLoc > 0) parts.push(`${totalLoc.toLocaleString()} LOC`);
    return parts.join(' · ');
}

export type PackageRole =
    | 'app'
    | 'ui'
    | 'service'
    | 'library'
    | 'tooling'
    | 'tests'
    | 'docs'
    | 'tool-wrapper'
    | 'other';

export interface RoleMeta {
    label: string;
    blurb: string;
}

export const ROLE_META: Record<PackageRole, RoleMeta> = {
    app: { label: 'App shells', blurb: 'The runnable entry points users launch.' },
    ui: { label: 'User interface', blurb: 'The screens and components people see.' },
    service: { label: 'Services', blurb: 'Backend or process code that runs in the background.' },
    library: { label: 'Libraries', blurb: 'Shared code other packages import.' },
    tooling: { label: 'Build and scripts', blurb: 'Programs that build, package, and release the app.' },
    tests: { label: 'Tests', blurb: 'Automated checks that exercise the app.' },
    docs: { label: 'Docs', blurb: 'Written guides, decisions, and runbooks.' },
    'tool-wrapper': { label: 'Tool wrappers', blurb: 'Typed wrappers around bundled command-line tools.' },
    other: { label: 'Other', blurb: 'Everything else in the project.' },
};

// Ordered most-to-least "lead with this" so role groups render in a
// sensible orientation order regardless of LOC.
export const ROLE_ORDER: PackageRole[] = [
    'app', 'ui', 'service', 'library', 'tool-wrapper', 'tooling', 'tests', 'docs', 'other',
];

/**
 * Infer a structural role from a package name/path. Name-based, since the
 * repo scanner only gives us names and paths, not manifest internals.
 * Falls back to 'other' so the caller never has to handle undefined.
 */
export function inferPackageRole(name: string): PackageRole {
    const n = name.toLowerCase();
    const rules: Array<[RegExp, PackageRole]> = [
        [/(^|\/)bundled-tools\//, 'tool-wrapper'],
        [/(electron|console-electron|main)$/, 'app'],
        [/(shell|chrome|renderer|web|frontend|ui)$/, 'ui'],
        [/(server|service|backend|api|daemon)$/, 'service'],
        [/(design-tokens|tokens|shared|common|lib|sdk|core|utils)$/, 'library'],
        [/(^|\/)(scripts|tooling|build)$/, 'tooling'],
        [/(^|\/)(qa|tests?|e2e|eval-harness|evals?)$/, 'tests'],
        [/(^|\/)docs?$/, 'docs'],
    ];
    for (const [pattern, role] of rules) {
        if (pattern.test(n)) return role;
    }
    return 'other';
}

// Words that read as acronyms/brand-cased rather than Title Case when we
// humanize a package slug. Keyed lowercase; the value is the exact casing
// we want ("Qa" -> "QA", "npm" stays lowercase).
const KNOWN_ACRONYMS: Record<string, string> = {
    qa: 'QA',
    ci: 'CI',
    cd: 'CD',
    mcp: 'MCP',
    npm: 'npm',
    ui: 'UI',
    api: 'API',
    sdk: 'SDK',
    cli: 'CLI',
    pcb: 'PCB',
    e2e: 'E2E',
};

/**
 * Human label for a package, derived from the last path segment. Splits on
 * separators, Title-cases each word, and applies KNOWN_ACRONYMS so role
 * shorthands render correctly ("qa" -> "QA", not "Qa"). Falls back to the
 * raw name when there is nothing to format.
 */
export function prettyPackageLabel(name: string): string {
    const short = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
    const words = short.replace(/[-_]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return name;
    return words
        .map((w) => {
            const known = KNOWN_ACRONYMS[w.toLowerCase()];
            if (known) return known;
            return w.charAt(0).toUpperCase() + w.slice(1);
        })
        .join(' ');
}

/** Short, human entry/role label for one package within its role group. */
export function packageEntryLabel(role: PackageRole): string {
    switch (role) {
        case 'app': return 'launches the app';
        case 'ui': return 'renders the interface';
        case 'service': return 'runs in the background';
        case 'library': return 'shared code';
        case 'tool-wrapper': return 'wraps a bundled tool';
        case 'tooling': return 'build and release scripts';
        case 'tests': return 'automated checks';
        case 'docs': return 'written guides';
        default: return 'part of the project';
    }
}
