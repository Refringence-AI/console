// console-electron/src/main/ipc/repo.ts
//
// Repo panel IPC handler. Returns a tree of top-level packages with
// per-package + per-file metadata (language, LOC, mtime, sizeBytes).
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RepoFileEntry {
    path: string;          // forward-slash relative to repo root
    language: string;
    sizeBytes: number;
    loc: number;
    mtimeMs: number;
}

export interface RepoPackageEntry {
    name: string;
    path: string;
    file_count: number;
    total_loc: number;
    total_bytes: number;
    languages: Record<string, number>;
    sample_files: RepoFileEntry[];  // first 50 files for the leaf view
}

export interface RepoSummary {
    repo_root: string;
    total_packages: number;
    total_files: number;
    total_loc: number;
    packages: RepoPackageEntry[];
}

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.refringence-qa',
    '__pycache__', '.pio', '.cache', '.venv', 'tools-src', 'vcpkg',
    'src-qt', 'out', '.next', '.parcel-cache',
]);

const SKIP_EXTS = new Set([
    '.lock', '.png', '.jpg', '.jpeg', '.webm', '.mp4', '.zip', '.7z',
    '.tar.gz', '.tar.xz', '.exe', '.node', '.svg', '.gif', '.ico',
    '.woff', '.woff2', '.ttf', '.otf', '.eot', '.map',
]);

// Packages are DETECTED from the project, not a fixed list: every top-level
// directory that is not a skip/hidden dir is a package. A flat repo with no
// such subdirs falls back to a single package rooted at the repo itself, so the
// Repo panel reflects whatever project the user actually opened.
function detectPackages(root: string): { name: string; dir: string }[] {
    let ents: fs.Dirent[];
    try {
        ents = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const dirs = ents
        .filter((e) => e.isDirectory())
        .filter((e) => !SKIP_DIRS.has(e.name))
        .filter((e) => !(e.name.startsWith('.') && e.name !== '.github'))
        .map((e) => ({ name: e.name, dir: path.join(root, e.name) }));
    if (dirs.length > 0) return dirs;
    // Flat project: one package = the repo root.
    return [{ name: path.basename(root) || 'project', dir: root }];
}

function langFromExt(ext: string): string {
    const m: Record<string, string> = {
        '.ts': 'TypeScript', '.tsx': 'TSX', '.js': 'JavaScript', '.jsx': 'JSX',
        '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python',
        '.md': 'Markdown', '.yaml': 'YAML', '.yml': 'YAML', '.json': 'JSON',
        '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.toml': 'TOML',
        '.cpp': 'C++', '.cc': 'C++', '.h': 'C/C++ Header', '.hpp': 'C/C++ Header',
        '.c': 'C', '.rs': 'Rust', '.go': 'Go', '.sh': 'Shell',
        '.ps1': 'PowerShell', '.sql': 'SQL',
    };
    return m[ext.toLowerCase()] ?? 'Other';
}

function walkPkg(pkgRoot: string, repoRoot: string): { files: RepoFileEntry[]; languages: Record<string, number> } {
    const files: RepoFileEntry[] = [];
    const languages: Record<string, number> = {};
    walk(pkgRoot, files, languages, repoRoot);
    return { files, languages };
}

function walk(
    dir: string,
    out: RepoFileEntry[],
    languages: Record<string, number>,
    repoRoot: string,
    depth = 0
): void {
    if (depth > 12) return;  // sanity cap
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith('.') && ent.name !== '.gitignore' && ent.name !== '.claude') continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walk(abs, out, languages, repoRoot, depth + 1);
        } else if (ent.isFile()) {
            const ext = path.extname(ent.name).toLowerCase();
            if (SKIP_EXTS.has(ext)) continue;
            try {
                const stat = fs.statSync(abs);
                if (stat.size > 2_000_000) continue;
                let loc = 0;
                if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.md', '.yaml', '.yml',
                     '.json', '.html', '.css', '.scss', '.toml', '.cpp', '.cc', '.h', '.hpp',
                     '.c', '.rs', '.go', '.sh', '.ps1', '.sql'].includes(ext)) {
                    try {
                        const body = fs.readFileSync(abs, 'utf8');
                        loc = body.split('\n').length;
                    } catch { /* skip */ }
                }
                const lang = langFromExt(ext);
                languages[lang] = (languages[lang] ?? 0) + loc;
                out.push({
                    path: path.relative(repoRoot, abs).replace(/\\/g, '/'),
                    language: lang,
                    sizeBytes: stat.size,
                    loc,
                    mtimeMs: stat.mtimeMs,
                });
            } catch { /* skip */ }
        }
    }
}

const EMPTY_SUMMARY: RepoSummary = {
    repo_root: '', total_packages: 0, total_files: 0, total_loc: 0, packages: [],
};

export function registerRepoHandlers(): void {
    // `root` is the user's PICKED project, threaded from the renderer. The panel
    // describes that project, not a fixed sibling repo.
    ipcMain.handle('console:repo.summary', (_e, root: string): RepoSummary => {
        if (typeof root !== 'string' || root.length === 0) return EMPTY_SUMMARY;
        let isDir = false;
        try { isDir = fs.statSync(root).isDirectory(); } catch { isDir = false; }
        if (!isDir) return EMPTY_SUMMARY;

        const packages: RepoPackageEntry[] = [];
        let totalFiles = 0;
        let totalLoc = 0;
        for (const pkg of detectPackages(root)) {
            const { files, languages } = walkPkg(pkg.dir, root);
            if (files.length === 0) continue;
            const total_bytes = files.reduce((a, b) => a + b.sizeBytes, 0);
            const total_loc = files.reduce((a, b) => a + b.loc, 0);
            packages.push({
                name: pkg.name,
                path: path.relative(root, pkg.dir).replace(/\\/g, '/') || '.',
                file_count: files.length,
                total_loc,
                total_bytes,
                languages,
                sample_files: files.sort((a, b) => b.loc - a.loc).slice(0, 50),
            });
            totalFiles += files.length;
            totalLoc += total_loc;
        }
        packages.sort((a, b) => b.total_loc - a.total_loc);
        return {
            repo_root: root.replace(/\\/g, '/'),
            total_packages: packages.length,
            total_files: totalFiles,
            total_loc: totalLoc,
            packages,
        };
    });
}
