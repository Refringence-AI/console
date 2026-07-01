// console-electron/src/main/dead-config.ts
//
// Deterministic scanner for dead/unused configuration in a repo.
// No network calls. Four finding kinds:
//
//   tsconfig-path       - compilerOptions.paths entry whose target dir does not exist
//   missing-script-file - package.json "scripts" that invoke a local file which is missing
//   unused-env          - .env.example / .env keys whose NAMES appear nowhere under src/
//   missing-extends     - config files referenced via "extends" that do not exist
//
// Privacy contract: for unused-env, only KEY NAMES are reported, never values.
// The function never reads .env values; it only reads key names from the left
// side of each KEY=VALUE line.
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type DeadConfigKind =
    | 'tsconfig-path'
    | 'missing-script-file'
    | 'unused-env'
    | 'missing-extends';

export interface DeadConfigFinding {
    kind: DeadConfigKind;
    detail: string;
    file: string;
}

export interface DeadConfigReport {
    ok: boolean;
    findings: DeadConfigFinding[];
    counts: Record<DeadConfigKind, number>;
    error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyReport(): DeadConfigReport {
    return {
        ok: true,
        findings: [],
        counts: {
            'tsconfig-path': 0,
            'missing-script-file': 0,
            'unused-env': 0,
            'missing-extends': 0,
        },
    };
}

function resolveRoot(input: string): string | null {
    if (typeof input !== 'string' || input.trim().length === 0) return null;
    const abs = path.resolve(input.trim());
    try {
        if (!fs.statSync(abs).isDirectory()) return null;
    } catch {
        return null;
    }
    return abs;
}

function readJsonFile(filePath: string): unknown | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// ── (a) tsconfig.json compilerOptions.paths ───────────────────────────────────

function scanTsconfigPaths(root: string, report: DeadConfigReport): void {
    const tscFile = path.join(root, 'tsconfig.json');
    if (!fs.existsSync(tscFile)) return;

    const parsed = readJsonFile(tscFile);
    if (!parsed || typeof parsed !== 'object') return;

    const co = (parsed as Record<string, unknown>).compilerOptions;
    if (!co || typeof co !== 'object') return;

    const paths = (co as Record<string, unknown>).paths;
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return;

    for (const [alias, targets] of Object.entries(paths as Record<string, unknown>)) {
        if (!Array.isArray(targets)) continue;
        for (const t of targets) {
            if (typeof t !== 'string') continue;
            // Strip the trailing wildcard (* or /**) to get the directory
            const dirPart = t.replace(/\*.*$/, '').replace(/\/$/, '');
            if (!dirPart) continue;
            const absTarget = path.resolve(root, dirPart);
            if (!fs.existsSync(absTarget)) {
                report.findings.push({
                    kind: 'tsconfig-path',
                    detail: `paths alias "${alias}" points to "${t}" but "${absTarget}" does not exist`,
                    file: tscFile,
                });
                report.counts['tsconfig-path']++;
            }
        }
    }
}

// ── (b) package.json scripts that invoke a missing local file ────────────────

// Patterns that indicate the script calls a local file:
//   node ./script.js  |  tsx ./src/x.ts  |  ts-node src/x.ts  |  ./script.sh
// We extract the first file-like token that starts with . or is an absolute path
// that looks like a relative extension from the project root.
const LOCAL_FILE_RE = /(?:^|\s)(?:node|tsx|ts-node|ts-node-esm|esno)\s+(\.{1,2}\/[^\s'"]+)/;
const SHELL_SCRIPT_RE = /(?:^|\s)(\.{1,2}\/[^\s'"]+\.(?:sh|cjs|mjs|js|ts))\b/;

function extractLocalFileCandidates(scriptCmd: string): string[] {
    const results: string[] = [];
    const m1 = LOCAL_FILE_RE.exec(scriptCmd);
    if (m1 && m1[1]) results.push(m1[1]);
    const m2 = SHELL_SCRIPT_RE.exec(scriptCmd);
    if (m2 && m2[1] && !results.includes(m2[1])) results.push(m2[1]);
    return results;
}

function scanPackageScripts(root: string, report: DeadConfigReport): void {
    const pkgFile = path.join(root, 'package.json');
    if (!fs.existsSync(pkgFile)) return;

    const parsed = readJsonFile(pkgFile);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

    const scripts = (parsed as Record<string, unknown>).scripts;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return;

    for (const [name, cmd] of Object.entries(scripts as Record<string, unknown>)) {
        if (typeof cmd !== 'string') continue;
        const candidates = extractLocalFileCandidates(cmd);
        for (const rel of candidates) {
            const abs = path.resolve(root, rel);
            if (!fs.existsSync(abs)) {
                report.findings.push({
                    kind: 'missing-script-file',
                    detail: `script "${name}" references "${rel}" which does not exist`,
                    file: pkgFile,
                });
                report.counts['missing-script-file']++;
            }
        }
    }
}

// ── (c) .env.example / .env key names unused in src/ ─────────────────────────

// Candidate files to read key names from (example files - not real secrets).
const ENV_EXAMPLE_NAMES = ['.env.example', '.env.sample', '.env.template'] as const;

function parseEnvKeyNames(filePath: string): string[] {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8').slice(0, 256 * 1024);
    } catch {
        return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const stripped = /^export\s+(.*)$/.exec(trimmed)?.[1] ?? trimmed;
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(stripped);
        if (m?.[1] && !seen.has(m[1])) {
            seen.add(m[1]);
            out.push(m[1]);
        }
    }
    return out;
}

// Walk src/ collecting all text content (up to 1 MB per file, skip binaries).
const MAX_SRC_FILE_BYTES = 1 * 1024 * 1024;
const SKIP_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.mp3', '.zip', '.gz', '.tar']);

function collectSrcText(srcDir: string): string {
    const parts: string[] = [];
    const queue: string[] = [srcDir];
    while (queue.length > 0) {
        const cur = queue.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(cur, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            const full = path.join(cur, ent.name);
            if (ent.isDirectory()) {
                if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
                queue.push(full);
            } else if (ent.isFile()) {
                const ext = path.extname(ent.name).toLowerCase();
                if (SKIP_EXTS.has(ext)) continue;
                try {
                    const stat = fs.statSync(full);
                    if (stat.size > MAX_SRC_FILE_BYTES) continue;
                    parts.push(fs.readFileSync(full, 'utf8'));
                } catch {
                    // unreadable file - skip
                }
            }
        }
    }
    return parts.join('\n');
}

function scanUnusedEnvKeys(root: string, report: DeadConfigReport): void {
    // Find the first example file
    let exampleFile: string | null = null;
    for (const name of ENV_EXAMPLE_NAMES) {
        const p = path.join(root, name);
        if (fs.existsSync(p)) { exampleFile = p; break; }
    }
    if (!exampleFile) return;

    const keys = parseEnvKeyNames(exampleFile);
    if (keys.length === 0) return;

    // Check if src/ exists
    const srcDir = path.join(root, 'src');
    if (!fs.existsSync(srcDir)) return;

    const srcText = collectSrcText(srcDir);

    for (const key of keys) {
        if (!srcText.includes(key)) {
            report.findings.push({
                kind: 'unused-env',
                detail: `env key "${key}" declared in ${path.basename(exampleFile)} but not referenced anywhere under src/`,
                file: exampleFile,
            });
            report.counts['unused-env']++;
        }
    }
}

// ── (d) Config files referenced via "extends" that do not exist ───────────────

// Checks tsconfig.json "extends" and eslint / prettier / babel config "extends"
// fields for missing referenced files.

function checkExtendsField(extendsValue: string | string[], fromFile: string, root: string, report: DeadConfigReport): void {
    const values = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
    for (const v of values) {
        if (typeof v !== 'string') continue;
        // Skip package names (no leading . or /) - those are node_modules references
        if (!v.startsWith('.') && !v.startsWith('/')) continue;
        const abs = path.resolve(path.dirname(fromFile), v);
        // Also try with .json extension if no extension given
        const candidates = [abs, abs + '.json', abs + '.js', abs + '.cjs'];
        const exists = candidates.some((c) => {
            try { return fs.statSync(c).isFile(); } catch { return false; }
        });
        if (!exists) {
            report.findings.push({
                kind: 'missing-extends',
                detail: `"extends": "${v}" referenced in ${path.relative(root, fromFile)} does not exist`,
                file: fromFile,
            });
            report.counts['missing-extends']++;
        }
    }
}

function scanMissingExtends(root: string, report: DeadConfigReport): void {
    // Candidate config files that support "extends"
    const candidateNames = [
        'tsconfig.json',
        '.eslintrc.json',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.babelrc',
        '.babelrc.json',
        'babel.config.json',
    ];

    for (const name of candidateNames) {
        const filePath = path.join(root, name);
        if (!fs.existsSync(filePath)) continue;
        const parsed = readJsonFile(filePath);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const ext = (parsed as Record<string, unknown>).extends;
        if (typeof ext === 'string' || Array.isArray(ext)) {
            checkExtendsField(ext as string | string[], filePath, root, report);
        }
    }

    // Also scan any tsconfig.*.json files in the root
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (!ent.isFile()) continue;
        if (!/^tsconfig.*\.json$/.test(ent.name)) continue;
        if (ent.name === 'tsconfig.json') continue; // already handled above
        const filePath = path.join(root, ent.name);
        const parsed = readJsonFile(filePath);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const ext = (parsed as Record<string, unknown>).extends;
        if (typeof ext === 'string' || Array.isArray(ext)) {
            checkExtendsField(ext as string | string[], filePath, root, report);
        }
    }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function scanDeadConfig(root: string): DeadConfigReport {
    const resolvedRoot = resolveRoot(root);
    if (!resolvedRoot) {
        return {
            ok: false,
            findings: [],
            counts: {
                'tsconfig-path': 0,
                'missing-script-file': 0,
                'unused-env': 0,
                'missing-extends': 0,
            },
            error: `Invalid or missing root directory: "${root}"`,
        };
    }

    const report = emptyReport();

    try { scanTsconfigPaths(resolvedRoot, report); } catch (err) {
        report.findings.push({
            kind: 'tsconfig-path',
            detail: `scanner error: ${err instanceof Error ? err.message : String(err)}`,
            file: path.join(resolvedRoot, 'tsconfig.json'),
        });
    }

    try { scanPackageScripts(resolvedRoot, report); } catch (err) {
        report.findings.push({
            kind: 'missing-script-file',
            detail: `scanner error: ${err instanceof Error ? err.message : String(err)}`,
            file: path.join(resolvedRoot, 'package.json'),
        });
    }

    try { scanUnusedEnvKeys(resolvedRoot, report); } catch (err) {
        report.findings.push({
            kind: 'unused-env',
            detail: `scanner error: ${err instanceof Error ? err.message : String(err)}`,
            file: path.join(resolvedRoot, '.env.example'),
        });
    }

    try { scanMissingExtends(resolvedRoot, report); } catch (err) {
        report.findings.push({
            kind: 'missing-extends',
            detail: `scanner error: ${err instanceof Error ? err.message : String(err)}`,
            file: resolvedRoot,
        });
    }

    return report;
}
