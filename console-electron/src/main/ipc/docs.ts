// console-electron/src/main/ipc/docs.ts
//
// Docs panel IPC handler. Walks docs/ + root .md files and returns a
// categorised tree the Docs panel renders.
//
// Categorisation is driven by frontmatter (`category: <name>`) when
// present; otherwise inferred from the path (docs/architecture-decisions/
// → adr, docs/runbooks/ → runbook, docs/onboarding/ → onboarding, etc.).
//
// Excludes: node_modules, .git, dist, build, .refringence-qa.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type DocCategory =
    | 'plan' | 'onboarding' | 'runbook' | 'adr' | 'reference'
    | 'compliance' | 'testing' | 'operations' | 'unknown';

export interface DocEntry {
    /** Path relative to repo root, forward-slashes. */
    path: string;
    title: string;
    category: DocCategory;
    audience?: 'human' | 'agent' | 'both';
    last_reviewed?: string;
    sizeBytes: number;
    mtimeMs: number;
}

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.refringence-qa',
    '__pycache__', '.pio', '.cache', '.venv', 'tools-src', 'vcpkg',
    'src-qt', 'out',
]);

function inferCategory(relPath: string): DocCategory {
    const parts = relPath.split(/[\/\\]/);
    if (parts.length < 2) {
        // Root-level docs (README.md, CLAUDE.md, etc.) — onboarding.
        return 'onboarding';
    }
    const sub = parts[1]; // docs/<sub>/...
    if (sub === 'architecture-decisions') return 'adr';
    if (sub === 'onboarding') return 'onboarding';
    if (sub === 'runbooks') return 'runbook';
    if (sub === 'reference') return 'reference';
    if (sub === 'compliance') return 'compliance';
    if (sub === 'testing') return 'testing';
    if (sub === 'operations') return 'operations';
    if (sub === 'plans') return 'plan';
    if (sub === 'release-checklists') return 'operations';
    // docs/<file>.md — flat under docs/. Infer from filename markers.
    if (parts.length === 2 && parts[0] === 'docs') {
        const f = sub.toUpperCase();
        if (f.includes('PLAN') || f.includes('STRATEGY') || f.includes('RESEARCH')) return 'plan';
        if (f.includes('COMPLIANCE') || f.includes('AUDIT-LOG') || f.includes('CRYPTO') || f.includes('SBOM')) return 'compliance';
        if (f.includes('REFERENCE') || f.includes('CONVENTIONS') || f.includes('GLOSSARY') || f.includes('DETERMINISTIC')) return 'reference';
        if (f.includes('CRITIQUE') || f.includes('AUDIT') || f.includes('STATUS')) return 'operations';
        if (f.includes('UI') || f.includes('LAYOUT') || f.includes('DESIGN')) return 'reference';
        if (f.includes('BUILD')) return 'runbook';
    }
    return 'unknown';
}

function parseFrontmatter(body: string): Record<string, string | undefined> {
    // Minimal YAML frontmatter parser — only handles simple "key: value"
    // pairs between leading "---" lines. Good enough for our docs;
    // doesn't need YAML.parse().
    if (!body.startsWith('---')) return {};
    const end = body.indexOf('\n---', 3);
    if (end < 0) return {};
    const fm = body.slice(3, end).trim();
    const out: Record<string, string> = {};
    for (const line of fm.split(/\r?\n/)) {
        const m = line.match(/^([\w_-]+)\s*:\s*(.+)$/);
        if (m) {
            out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
        }
    }
    return out;
}

function extractTitle(body: string, fallback: string): string {
    const after = body.replace(/^---[\s\S]*?\n---\n/, '');
    const h1 = after.match(/^#\s+(.+?)$/m);
    return h1 ? h1[1].trim() : fallback;
}

// Lexical containment is bypassable via symlinks; canonicalise both root and
// target with realpath and confirm the real target still sits under the real
// root. Returns false on ENOENT, symlink loops, or any resolution failure.
function isRealInside(root: string, abs: string): boolean {
    try {
        const realRoot = fs.realpathSync(root);
        const realAbs = fs.realpathSync(abs);
        const rel = path.relative(realRoot, realAbs);
        return (rel === '' || !rel.startsWith('..')) && !path.isAbsolute(rel);
    } catch { return false; }
}

function walk(dir: string, out: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (SKIP_DIRS.has(ent.name)) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walk(abs, out);
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
            out.push(abs);
        }
    }
}

export function registerDocsHandlers(): void {
    // `root` is the PICKED project: its root-level .md + its docs/ tree.
    ipcMain.handle('console:docs.list', (_e, root: string): DocEntry[] => {
        if (typeof root !== 'string' || root.length === 0) return [];
        const files: string[] = [];
        // Root-level .md
        try {
            for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
                if (SKIP_DIRS.has(ent.name)) continue;
                if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
                    files.push(path.join(root, ent.name));
                }
            }
        } catch { /* noop */ }
        // docs/ tree
        walk(path.join(root, 'docs'), files);
        const out: DocEntry[] = [];
        for (const abs of files) {
            try {
                const stat = fs.statSync(abs);
                if (stat.size > 10_000_000) continue;  // skip huge files (sbom)
                const body = fs.readFileSync(abs, 'utf8');
                const fm = parseFrontmatter(body);
                const rel = path.relative(root, abs).replace(/\\/g, '/');
                const fileName = path.basename(rel, '.md');
                const title = extractTitle(body, fileName);
                const category = (fm.category as DocCategory) ?? inferCategory(rel);
                out.push({
                    path: rel,
                    title,
                    category,
                    audience: fm.audience as 'human' | 'agent' | 'both' | undefined,
                    last_reviewed: fm.last_reviewed,
                    sizeBytes: stat.size,
                    mtimeMs: stat.mtimeMs,
                });
            } catch { /* skip */ }
        }
        out.sort((a, b) => a.category.localeCompare(b.category) || a.path.localeCompare(b.path));
        return out;
    });

    ipcMain.handle('console:docs.read', (_e, root: string, relPath: string): string | null => {
        if (typeof root !== 'string' || root.length === 0) return null;
        if (typeof relPath !== 'string') return null;
        // Path-traversal guard.
        if (relPath.includes('..') || path.isAbsolute(relPath)) return null;
        if (!relPath.toLowerCase().endsWith('.md')) return null;
        const abs = path.resolve(root, relPath);
        if (!abs.startsWith(root)) return null;
        if (!fs.existsSync(abs)) return null;
        if (!isRealInside(root, abs)) return null;
        try {
            const stat = fs.statSync(abs);
            if (stat.size > 10_000_000) return null;
            return fs.readFileSync(abs, 'utf8');
        } catch {
            return null;
        }
    });
}
