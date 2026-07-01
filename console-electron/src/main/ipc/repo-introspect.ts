// console-electron/src/main/ipc/repo-introspect.ts
//
// Project Newcomer mode IPC. Fires when Console opens an unfamiliar
// project. Surfaces three things: a plain-English summary (README +
// package.json + LICENSE), hot files (most-changed in the last N
// days via git log), and a recommended reading order (toy
// implementation: leaf modules first by inbound import count).
//
// All handlers are tolerant of missing files / non-git directories /
// malformed JSON. Synchronous fs is fine — these fire once per panel
// open.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';


export interface ProjectSummary {
    name: string;
    description: string;
    license: string;
    languages: Record<string, number>;
    runCommands: string[];
}

export interface HotFile {
    path: string;
    changes: number;
    commits: number;
}

export interface ReadingEntry {
    path: string;
    score: number;
}

export interface ProjectShape {
    projectType: string;
    primaryLanguage: string;
    entryPoint?: string;
    startCommand?: string;
    isMonorepo: boolean;
    packageCount: number;
    runnable: boolean;
    /** Workspace orchestrator (pnpm/turbo/nx/lerna/npm workspaces/npm --prefix). */
    workspaceTool?: string | null;
    workspaceGlobs?: string[];
}

export interface ProjectCapabilities {
    hasGitRepo: boolean;
    hasCiWorkflows: boolean;
    hasTests: boolean;
    hasEvals: boolean;
    hasReleaseChecklists: boolean;
    hasServicesConfig: boolean;
    hasDocs: boolean;
    hasEnvFiles: boolean;
    workflowDir?: string;
    docsDir?: string;
}

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.refringence-qa',
    '__pycache__', '.pio', '.cache', '.venv', 'tools-src', 'vcpkg',
    'out', '.next', '.parcel-cache', 'target',
]);

const LANG_EXTS: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go',
    '.java': 'Java', '.cs': 'C#',
};

function resolveRoot(input: string | undefined | null): string {
    if (input && input.trim().length > 0) {
        const abs = path.resolve(input);
        if (fs.existsSync(abs)) return abs;
    }
    return process.cwd();
}

function safeReadJson(file: string): Record<string, unknown> | null {
    try {
        const body = fs.readFileSync(file, 'utf8');
        return JSON.parse(body) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function safeReadText(file: string, limit?: number): string {
    try {
        const body = fs.readFileSync(file, 'utf8');
        return typeof limit === 'number' ? body.slice(0, limit) : body;
    } catch {
        return '';
    }
}

export function detectLanguages(root: string): Record<string, number> {
    const counts: Record<string, number> = {};
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length > 0) {
        const { dir, depth } = stack.pop()!;
        if (depth > 1) continue;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            if (SKIP_DIRS.has(ent.name)) continue;
            if (ent.name.startsWith('.')) continue;
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                stack.push({ dir: abs, depth: depth + 1 });
            } else if (ent.isFile()) {
                const ext = path.extname(ent.name).toLowerCase();
                const lang = LANG_EXTS[ext];
                if (lang) {
                    counts[lang] = (counts[lang] ?? 0) + 1;
                }
            }
        }
    }
    return counts;
}

function extractReadmeRunCommands(readme: string): string[] {
    const out: string[] = [];
    const match = readme.match(/```(?:bash|sh|shell|zsh)\s*\n([\s\S]*?)```/);
    if (!match) return out;
    const block = match[1];
    for (const raw of block.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#')) continue;
        out.push(line.replace(/^\$\s*/, ''));
        if (out.length >= 6) break;
    }
    return out;
}

export function buildSummary(root: string): ProjectSummary {
    const pkg = safeReadJson(path.join(root, 'package.json'));
    const pyproject = safeReadText(path.join(root, 'pyproject.toml'), 4000);
    const cargo = safeReadText(path.join(root, 'Cargo.toml'), 4000);
    const licenseFirst = safeReadText(path.join(root, 'LICENSE'), 200).split('\n')[0].trim();
    const readme = safeReadText(path.join(root, 'README.md'), 4000);

    let name = pkg?.name as string | undefined;
    let description = pkg?.description as string | undefined;
    let license = (pkg?.license as string | undefined) ?? licenseFirst ?? '';

    if (!name) {
        const m = pyproject.match(/^\s*name\s*=\s*"([^"]+)"/m) || cargo.match(/^\s*name\s*=\s*"([^"]+)"/m);
        if (m) name = m[1];
    }
    if (!description) {
        const m = pyproject.match(/^\s*description\s*=\s*"([^"]+)"/m) || cargo.match(/^\s*description\s*=\s*"([^"]+)"/m);
        if (m) description = m[1];
    }
    if (!name) name = path.basename(root);
    if (!description) {
        const firstLine = readme.split('\n').find((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
        description = firstLine?.trim() ?? '';
    }
    if (!license) license = '';

    const languages = detectLanguages(root);

    const runCommands: string[] = [];
    if (pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null) {
        for (const key of Object.keys(pkg.scripts as Record<string, string>)) {
            runCommands.push(`npm run ${key}`);
            if (runCommands.length >= 8) break;
        }
    }
    if (fs.existsSync(path.join(root, 'Dockerfile'))) {
        runCommands.push('docker build .');
    }
    for (const cmd of extractReadmeRunCommands(readme)) {
        if (!runCommands.includes(cmd)) runCommands.push(cmd);
        if (runCommands.length >= 14) break;
    }

    return { name, description, license, languages, runCommands };
}

export function buildHotFiles(root: string, sinceDays: number): HotFile[] {
    const days = Number.isFinite(sinceDays) && sinceDays > 0 ? Math.floor(sinceDays) : 30;
    let raw: string;
    try {
        raw = execFileSync(
            'git',
            ['-C', root, 'log', `--since=${days}.days`, '--numstat', '--pretty=tformat:__COMMIT__'],
            { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        );
    } catch {
        return [];
    }

    // Exclude generated / lockfile / report churn so the list points at files an
    // engineer actually edits, not a lockfile touched twice with 5000 line diffs.
    const GENERATED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|poetry\.lock|Cargo\.lock|go\.sum)$|\.cdx\.json$|[-.]report.*\.json$|(^|\/)(dist|build)\/|\.(png|jpe?g|gif|webp|svg|pdf|ico|lock)$|(^|\/)screenshots?\//i;
    const agg = new Map<string, { changes: number; commits: Set<number> }>();
    let commitIdx = 0;
    for (const line of raw.split('\n')) {
        if (!line) continue;
        if (line === '__COMMIT__') { commitIdx += 1; continue; }
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const added = parseInt(parts[0], 10);
        const removed = parseInt(parts[1], 10);
        const fpath = parts[2];
        if (!fpath || GENERATED.test(fpath)) continue;
        const delta = (Number.isFinite(added) ? added : 0) + (Number.isFinite(removed) ? removed : 0);
        const cur = agg.get(fpath) ?? { changes: 0, commits: new Set<number>() };
        cur.changes += delta;
        cur.commits.add(commitIdx);
        agg.set(fpath, cur);
    }

    // Rank by COMMIT FREQUENCY first (a file changed in many commits is a real
    // hotspot), line-changes as the tiebreak.
    return Array.from(agg.entries())
        .map(([p, v]) => ({ path: p, changes: v.changes, commits: v.commits.size }))
        .sort((a, b) => (b.commits - a.commits) || (b.changes - a.changes))
        .slice(0, 10);
}

function listCodeFiles(root: string): string[] {
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0 && out.length < 4000) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            if (SKIP_DIRS.has(ent.name)) continue;
            if (ent.name.startsWith('.')) continue;
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                stack.push(abs);
            } else if (ent.isFile()) {
                const ext = path.extname(ent.name).toLowerCase();
                if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
                    out.push(abs);
                }
            }
        }
    }
    return out;
}

function buildReadingOrder(root: string): ReadingEntry[] {
    const files = listCodeFiles(root);
    if (files.length === 0) return [];

    const relByAbs = new Map<string, string>();
    for (const f of files) {
        relByAbs.set(f, path.relative(root, f).replace(/\\/g, '/'));
    }

    const inbound = new Map<string, number>();
    for (const f of files) {
        inbound.set(relByAbs.get(f)!, 0);
    }

    const importRe = /(?:from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g;
    for (const f of files) {
        let body = '';
        try {
            body = fs.readFileSync(f, 'utf8');
        } catch {
            continue;
        }
        if (body.length > 200_000) continue;
        const fromDir = path.dirname(f);
        let m: RegExpExecArray | null;
        importRe.lastIndex = 0;
        while ((m = importRe.exec(body)) !== null) {
            const spec = m[1] ?? m[2];
            if (!spec || !spec.startsWith('.')) continue;
            const baseResolved = path.resolve(fromDir, spec);
            const candidates = [
                baseResolved,
                baseResolved + '.ts', baseResolved + '.tsx',
                baseResolved + '.js', baseResolved + '.jsx',
                path.join(baseResolved, 'index.ts'),
                path.join(baseResolved, 'index.tsx'),
                path.join(baseResolved, 'index.js'),
            ];
            for (const c of candidates) {
                const rel = relByAbs.get(c);
                if (rel) {
                    inbound.set(rel, (inbound.get(rel) ?? 0) + 1);
                    break;
                }
            }
        }
    }

    return Array.from(inbound.entries())
        .map(([p, score]) => ({ path: p, score }))
        .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
        .slice(0, 15);
}

const UNKNOWN_SHAPE: ProjectShape = {
    projectType: 'Unknown',
    primaryLanguage: 'Unknown',
    isMonorepo: false,
    packageCount: 0,
    runnable: false,
};

function dominantLanguage(root: string): string {
    const counts = detectLanguages(root);
    let best = '';
    let bestN = -1;
    for (const [lang, n] of Object.entries(counts)) {
        if (n > bestN) { best = lang; bestN = n; }
    }
    return best || 'Unknown';
}

function countWorkspacePackages(root: string, pkg: Record<string, unknown> | null): number {
    // lerna.json or a workspaces field both imply a monorepo. We count
    // real package.json files one level under each workspace glob root,
    // capped — exact globbing isn't worth it for a count.
    const roots = new Set<string>();
    const ws = pkg?.workspaces;
    const globs: string[] = [];
    if (Array.isArray(ws)) {
        for (const g of ws) if (typeof g === 'string') globs.push(g);
    } else if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages)) {
        for (const g of (ws as { packages: unknown[] }).packages) if (typeof g === 'string') globs.push(g);
    }
    if (fs.existsSync(path.join(root, 'lerna.json')) && globs.length === 0) {
        globs.push('packages/*');
    }
    for (const g of globs) {
        const dirGlob = g.replace(/\/\*+$/, '');
        roots.add(path.join(root, dirGlob));
    }
    let count = 0;
    for (const dir of roots) {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (fs.existsSync(path.join(dir, ent.name, 'package.json'))) count += 1;
        }
    }
    return count;
}

export function buildShape(root: string): ProjectShape {
    const pkg = safeReadJson(path.join(root, 'package.json'));
    const hasIndexHtml = fs.existsSync(path.join(root, 'index.html'));
    const hasDockerfile = fs.existsSync(path.join(root, 'Dockerfile'));
    const pyproject = fs.existsSync(path.join(root, 'pyproject.toml'));
    const setupPy = fs.existsSync(path.join(root, 'setup.py'));
    const cargo = fs.existsSync(path.join(root, 'Cargo.toml'));
    const goMod = fs.existsSync(path.join(root, 'go.mod'));
    const hasLerna = fs.existsSync(path.join(root, 'lerna.json'));

    const primaryLanguage = dominantLanguage(root);

    // Monorepo detection.
    const hasWorkspaces = !!pkg && (
        Array.isArray((pkg as { workspaces?: unknown }).workspaces) ||
        (typeof (pkg as { workspaces?: unknown }).workspaces === 'object' && (pkg as { workspaces?: unknown }).workspaces !== null)
    );
    const isMonorepo = hasLerna || hasWorkspaces;
    const packageCount = isMonorepo ? countWorkspacePackages(root, pkg) : (pkg ? 1 : 0);

    // Node-flavoured fields.
    const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null)
        ? (pkg.scripts as Record<string, string>)
        : {};
    const main = typeof pkg?.main === 'string' ? (pkg.main as string) : undefined;
    const bin = pkg?.bin;
    const pkgType = typeof pkg?.type === 'string' ? (pkg.type as string) : undefined;

    let projectType = 'Unknown';
    let entryPoint: string | undefined;
    let startCommand: string | undefined;
    let runnable = false;

    if (isMonorepo) {
        projectType = `Monorepo (${packageCount} package${packageCount === 1 ? '' : 's'})`;
        if (scripts.start) startCommand = 'npm start';
        else if (scripts.dev) startCommand = 'npm run dev';
        runnable = !!startCommand;
    } else if (pkg) {
        if (scripts.start || scripts.dev || hasIndexHtml) runnable = true;
        if (hasIndexHtml || scripts.dev) {
            projectType = 'Node.js web app';
        } else if (bin) {
            projectType = 'Node.js CLI';
            if (typeof bin === 'string') entryPoint = bin;
            else if (bin && typeof bin === 'object') {
                const first = Object.values(bin as Record<string, unknown>).find((v) => typeof v === 'string');
                if (typeof first === 'string') entryPoint = first;
            }
        } else if (main && !scripts.start && !scripts.dev) {
            projectType = primaryLanguage === 'TypeScript' ? 'TypeScript library' : 'Node.js library';
            entryPoint = main;
        } else {
            projectType = 'Node.js project';
        }
        if (!entryPoint && main) entryPoint = main;
        if (scripts.start) startCommand = 'npm start';
        else if (scripts.dev) startCommand = 'npm run dev';
        else if (pkgType) { /* type-only marker, keep null */ }
    } else if (pyproject || setupPy) {
        const hasMainPy = fs.existsSync(path.join(root, 'main.py'));
        projectType = hasMainPy ? 'Python CLI' : 'Python package';
        if (hasMainPy) { entryPoint = 'main.py'; startCommand = 'python main.py'; runnable = true; }
    } else if (cargo) {
        const hasMainRs = fs.existsSync(path.join(root, 'src', 'main.rs'));
        projectType = hasMainRs ? 'Rust binary' : 'Rust crate';
        if (hasMainRs) { entryPoint = 'src/main.rs'; }
        startCommand = 'cargo run';
        runnable = hasMainRs;
    } else if (goMod) {
        projectType = 'Go module';
        startCommand = 'go run .';
        runnable = true;
    } else if (hasDockerfile) {
        projectType = 'Containerized project';
        startCommand = 'docker build .';
        runnable = true;
    } else if (hasIndexHtml) {
        projectType = 'Static web page';
        entryPoint = 'index.html';
        runnable = false;
    }

    return {
        projectType,
        primaryLanguage,
        entryPoint,
        startCommand,
        isMonorepo,
        packageCount,
        runnable,
    };
}

function hasDir(root: string, rel: string): boolean {
    try {
        return fs.statSync(path.join(root, rel)).isDirectory();
    } catch {
        return false;
    }
}

function dirHasYaml(dir: string): boolean {
    try {
        return fs.readdirSync(dir).some((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    } catch {
        return false;
    }
}

export function buildCapabilities(root: string): ProjectCapabilities {
    const pkg = safeReadJson(path.join(root, 'package.json'));
    const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null)
        ? (pkg.scripts as Record<string, string>)
        : {};

    const hasGitRepo = fs.existsSync(path.join(root, '.git'));

    const workflowDirAbs = path.join(root, '.github', 'workflows');
    const hasCiWorkflows = hasDir(root, path.join('.github', 'workflows')) && dirHasYaml(workflowDirAbs);

    const hasTests =
        hasDir(root, 'test') || hasDir(root, 'tests') || hasDir(root, '__tests__') ||
        typeof scripts.test === 'string';

    const hasEvals =
        hasDir(root, 'eval-harness') ||
        fs.existsSync(path.join(root, 'promptfooconfig.yaml')) ||
        fs.existsSync(path.join(root, 'promptfooconfig.yml')) ||
        typeof scripts.eval === 'string' ||
        typeof scripts.evals === 'string';

    const hasReleaseChecklists =
        hasDir(root, path.join('docs', 'release-checklists')) ||
        hasDir(root, 'release-checklists');

    const hasServicesConfig =
        fs.existsSync(path.join(root, 'vercel.json')) ||
        fs.existsSync(path.join(root, 'render.yaml')) ||
        fs.existsSync(path.join(root, 'netlify.toml')) ||
        fs.existsSync(path.join(root, 'fly.toml')) ||
        fs.existsSync(path.join(root, 'railway.json')) ||
        fs.existsSync(path.join(root, 'app.yaml'));

    let hasDocs = hasDir(root, 'docs');
    const docsDir = hasDocs ? 'docs' : undefined;
    if (!hasDocs) {
        try {
            hasDocs = fs.readdirSync(root).some((f) => f.toLowerCase().endsWith('.md'));
        } catch { /* leave false */ }
    }

    let hasEnvFiles = false;
    try {
        hasEnvFiles = fs.readdirSync(root).some((f) => f === '.env' || f.startsWith('.env.'));
    } catch { /* leave false */ }

    return {
        hasGitRepo,
        hasCiWorkflows,
        hasTests,
        hasEvals,
        hasReleaseChecklists,
        hasServicesConfig,
        hasDocs,
        hasEnvFiles,
        workflowDir: hasCiWorkflows ? '.github/workflows' : undefined,
        docsDir,
    };
}

export function registerRepoIntrospectHandlers(): void {
    ipcMain.handle('console:repo.summary.full', (_e, projectRoot: string): ProjectSummary => {
        const root = resolveRoot(projectRoot);
        try {
            return buildSummary(root);
        } catch {
            return { name: path.basename(root), description: '', license: '', languages: {}, runCommands: [] };
        }
    });

    ipcMain.handle('console:repo.hotFiles', (_e, projectRoot: string, sinceDays?: number): HotFile[] => {
        const root = resolveRoot(projectRoot);
        try {
            return buildHotFiles(root, sinceDays ?? 30);
        } catch {
            return [];
        }
    });

    ipcMain.handle('console:repo.readingOrder', (_e, projectRoot: string): ReadingEntry[] => {
        const root = resolveRoot(projectRoot);
        try {
            return buildReadingOrder(root);
        } catch {
            return [];
        }
    });

    ipcMain.handle('console:repo.shape', (_e, projectRoot: string): ProjectShape => {
        const root = resolveRoot(projectRoot);
        try {
            return buildShape(root);
        } catch {
            return { ...UNKNOWN_SHAPE };
        }
    });

    ipcMain.handle('console:repo.capabilities', (_e, projectRoot: string): ProjectCapabilities => {
        const root = resolveRoot(projectRoot);
        try {
            return buildCapabilities(root);
        } catch {
            return {
                hasGitRepo: false,
                hasCiWorkflows: false,
                hasTests: false,
                hasEvals: false,
                hasReleaseChecklists: false,
                hasServicesConfig: false,
                hasDocs: false,
                hasEnvFiles: false,
            };
        }
    });
}
