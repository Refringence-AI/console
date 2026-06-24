// console-electron/src/main/ipc/library.ts
//
// Project Library IPC. Browses the active project's docs/, configs,
// workflows, READMEs, and other text artifacts so the user can "read
// the repo like a book". Replaces the project-docs browser lost in the
// Q3-batch-3 Flo DocsShell migration.
//
// list:  walks the project root (skipping vendored/build dirs), returns
//        up to 500 categorised entries by ext + location + filename.
// read:  utf-8, 256 KB cap, traversal-guarded by relPath resolution.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type LibraryCategory =
    | 'docs'
    | 'config'
    | 'data'
    | 'workflow'
    | 'license'
    | 'readme'
    | 'changelog'
    | 'other';

export interface LibraryEntry {
    path: string;       // absolute
    relPath: string;    // forward-slashes, relative to projectRoot
    ext: string;        // lowercased, includes leading dot (e.g. ".md")
    size: number;
    mtimeMs: number;
    category: LibraryCategory;
}

export interface LibraryFile {
    content: string;
    mime: string;
    truncated: boolean;
}

const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', '.git', '.refringence-qa',
    'target', '.next', 'vendor', '__pycache__', '.venv', '.cache',
    'out', '.turbo', '.parcel-cache',
]);

const ALLOWED_EXTS = new Set(['.md', '.yml', '.yaml', '.json', '.toml', '.txt']);
const MAX_ENTRIES = 500;
const MAX_READ_BYTES = 256 * 1024;

const CONFIG_NAMES = new Set([
    'tsconfig.json', 'package.json', 'cargo.toml', 'pyproject.toml',
    'jsconfig.json', 'eslint.config.json', '.eslintrc.json', '.prettierrc.json',
    'vite.config.json', 'pnpm-workspace.yaml', 'turbo.json', 'biome.json',
    'tailwind.config.json',
]);

function classify(relPath: string, ext: string): LibraryCategory {
    const lower = relPath.toLowerCase();
    const base = path.basename(lower);

    if (base.startsWith('readme.')) return 'readme';
    if (base.startsWith('changelog.') || base === 'changelog.md' || base === 'changelog.txt') return 'changelog';
    if (base === 'license' || base.startsWith('license.') || base.startsWith('licence.')) return 'license';
    if (base === 'copying' || base === 'notice') return 'license';

    if (lower.startsWith('.github/workflows/') || lower.includes('/.github/workflows/')) return 'workflow';

    if (lower.startsWith('docs/') || lower.includes('/docs/')) return 'docs';

    if (CONFIG_NAMES.has(base)) return 'config';
    if (ext === '.toml' || ext === '.yml' || ext === '.yaml') return 'config';

    if (ext === '.json') return 'data';
    if (ext === '.md') return 'docs';
    return 'other';
}

function walk(root: string, dir: string, out: LibraryEntry[]): void {
    if (out.length >= MAX_ENTRIES) return;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (out.length >= MAX_ENTRIES) return;
        if (SKIP_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith('.') && ent.name !== '.github') continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walk(root, abs, out);
            continue;
        }
        if (!ent.isFile()) continue;
        const ext = path.extname(ent.name).toLowerCase();
        const baseLower = ent.name.toLowerCase();
        const isLicense = baseLower === 'license' || baseLower === 'licence' ||
                          baseLower === 'copying' || baseLower === 'notice';
        if (!ALLOWED_EXTS.has(ext) && !isLicense) continue;
        let stat: fs.Stats;
        try {
            stat = fs.statSync(abs);
        } catch {
            continue;
        }
        if (stat.size > 5_000_000) continue;
        const relPath = path.relative(root, abs).replace(/\\/g, '/');
        out.push({
            path: abs,
            relPath,
            ext: ext || '',
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            category: classify(relPath, ext),
        });
    }
}

function isInside(root: string, abs: string): boolean {
    const resolvedRoot = path.resolve(root);
    const resolvedAbs = path.resolve(abs);
    const rel = path.relative(resolvedRoot, resolvedAbs);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
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

function mimeFor(ext: string): string {
    switch (ext) {
        case '.md':   return 'text/markdown';
        case '.json': return 'application/json';
        case '.yml':
        case '.yaml': return 'text/yaml';
        case '.toml': return 'text/toml';
        case '.txt':  return 'text/plain';
        default:      return 'text/plain';
    }
}

export function registerLibraryHandlers(): void {
    ipcMain.handle('console:library.list', (_e, projectRoot: string): LibraryEntry[] => {
        if (typeof projectRoot !== 'string' || !projectRoot) return [];
        let stat: fs.Stats;
        try {
            stat = fs.statSync(projectRoot);
        } catch {
            return [];
        }
        if (!stat.isDirectory()) return [];
        const out: LibraryEntry[] = [];
        walk(projectRoot, projectRoot, out);
        out.sort((a, b) =>
            a.category.localeCompare(b.category) || a.relPath.localeCompare(b.relPath),
        );
        return out;
    });

    ipcMain.handle('console:library.read', (
        _e,
        projectRoot: string,
        relPath: string,
    ): LibraryFile => {
        if (typeof projectRoot !== 'string' || typeof relPath !== 'string') {
            return { content: '', mime: 'text/plain', truncated: false };
        }
        if (relPath.includes('..') || path.isAbsolute(relPath)) {
            return { content: '', mime: 'text/plain', truncated: false };
        }
        const abs = path.resolve(projectRoot, relPath);
        if (!isInside(projectRoot, abs)) {
            return { content: '', mime: 'text/plain', truncated: false };
        }
        if (!isRealInside(projectRoot, abs)) {
            return { content: '', mime: 'text/plain', truncated: false };
        }
        let stat: fs.Stats;
        try {
            stat = fs.statSync(abs);
        } catch {
            return { content: '', mime: 'text/plain', truncated: false };
        }
        if (!stat.isFile()) {
            return { content: '', mime: 'text/plain', truncated: false };
        }
        const ext = path.extname(abs).toLowerCase();
        const truncated = stat.size > MAX_READ_BYTES;
        let content = '';
        try {
            if (truncated) {
                const fd = fs.openSync(abs, 'r');
                const buf = Buffer.alloc(MAX_READ_BYTES);
                fs.readSync(fd, buf, 0, MAX_READ_BYTES, 0);
                fs.closeSync(fd);
                content = buf.toString('utf8');
            } else {
                content = fs.readFileSync(abs, 'utf8');
            }
        } catch {
            return { content: '', mime: mimeFor(ext), truncated: false };
        }
        return { content, mime: mimeFor(ext), truncated };
    });
}
