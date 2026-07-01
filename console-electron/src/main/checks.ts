// console-electron/src/main/checks.ts
//
// Deterministic project checks: a small registry of read-only checks that each
// return a uniform CheckResult (status + findings + a next action). This is the
// substrate the golden path (v0.6) extends with more checks (migration-drift,
// etc.); for now it ships the env-diff check, which compares .env.example to
// .env. Privacy-safe: it reads only the KEY NAMES on the left of each line,
// never a value, and respects the per-project .env consent gate.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readEnvConsent } from './intel/consent';
import { checkLicenses } from './license-check';
import { scanDeadConfig } from './dead-config';

export interface CheckFinding { label: string; detail?: string; severity: 'info' | 'warn' | 'fail' }
export interface CheckResult {
    id: string;
    title: string;
    status: 'pass' | 'warn' | 'fail' | 'skip';
    summary: string;
    findings: CheckFinding[];
    nextAction?: string;
    scannedAt: string;
}

function resolveRoot(input: string): string | null {
    if (typeof input !== 'string' || input.trim().length === 0) return null;
    const abs = path.resolve(input);
    try { if (!fs.statSync(abs).isDirectory()) return null; } catch { return null; }
    return abs;
}

function firstExisting(root: string, names: string[]): string | null {
    for (const n of names) {
        const f = path.join(root, n);
        try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ }
    }
    return null;
}

// The KEY names on the left of `KEY=value` (and `export KEY=value`), in order,
// de-duplicated. Values are never read.
function envKeyNames(file: string): string[] {
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8').slice(0, 256 * 1024); } catch { return []; }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (m && !seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    }
    return out;
}

function envDiffCheck(root: string): CheckResult {
    const scannedAt = new Date().toISOString();
    const base: CheckResult = { id: 'env-diff', title: 'Environment variables', status: 'skip', summary: '', findings: [], scannedAt };

    const example = firstExisting(root, ['.env.example', '.env.sample', '.env.template']);
    if (!example) {
        return { ...base, summary: 'No .env.example to check against. Add one so teammates know which variables to set.' };
    }
    const exampleKeys = envKeyNames(example);

    // Respect the onboarding .env consent: false = the user turned .env reading
    // off, so show only the documented keys, never the real .env.
    if (readEnvConsent(root) === false) {
        return {
            ...base,
            summary: '.env reading is turned off. Showing the documented keys from .env.example only.',
            findings: exampleKeys.map((k) => ({ label: k, severity: 'info' })),
        };
    }

    const envFile = firstExisting(root, ['.env', '.env.local']);
    if (!envFile) {
        return {
            ...base, status: 'warn',
            summary: `No .env yet. Copy .env.example and fill in its ${exampleKeys.length} key${exampleKeys.length === 1 ? '' : 's'}.`,
            findings: exampleKeys.map((k) => ({ label: k, detail: 'documented, not set', severity: 'warn' })),
            nextAction: 'Create a .env from .env.example and set each value.',
        };
    }

    const envKeys = new Set(envKeyNames(envFile));
    const missing = exampleKeys.filter((k) => !envKeys.has(k));
    const undocumented = [...envKeys].filter((k) => !exampleKeys.includes(k));
    const findings: CheckFinding[] = [
        ...missing.map((k) => ({ label: k, detail: 'in .env.example, missing from .env', severity: 'warn' as const })),
        ...undocumented.map((k) => ({ label: k, detail: 'in .env, not documented in .env.example', severity: 'info' as const })),
    ];

    if (missing.length === 0) {
        return {
            ...base, status: 'pass',
            summary: undocumented.length
                ? `Your .env covers every documented key (${undocumented.length} extra, undocumented).`
                : 'Your .env covers every documented key.',
            findings,
        };
    }
    return {
        ...base, status: 'warn',
        summary: `${missing.length} documented key${missing.length === 1 ? '' : 's'} not set in your .env.`,
        findings,
        nextAction: 'Set the missing keys in your .env.',
    };
}

// --- Database migration drift ----------------------------------------------
// Detects migration problems from FILES alone (no DB connection): a missing
// rollback, a version gap or clash, a journal/folder mismatch, an empty
// migration, and the flo101 headline - a pile of hand-applied SQL with nothing
// that records which migrations actually ran. Read-only; findings carry file
// names and counts only, never SQL bodies.

type MigTool = 'supabase' | 'golang-migrate' | 'prisma' | 'drizzle' | 'flyway' | 'bare';

function isDir(p: string): boolean { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listDir(p: string): string[] { try { return fs.readdirSync(p); } catch { return []; } }
function sqlIsEmpty(p: string): boolean {
    let raw: string;
    try { raw = fs.readFileSync(p, 'utf8').slice(0, 256 * 1024); } catch { return false; }
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim().length === 0;
}
function pushVal(map: Map<string, string[]>, key: string, val: string): void {
    const a = map.get(key) ?? [];
    a.push(val);
    map.set(key, a);
}
function toolLabel(t: MigTool): string {
    const m: Record<MigTool, string> = {
        supabase: 'Supabase', 'golang-migrate': 'golang-migrate', prisma: 'Prisma',
        drizzle: 'Drizzle', flyway: 'Flyway', bare: 'SQL migrations',
    };
    return m[t];
}

interface DetectedTool { tool: MigTool; dir: string }

// Higher-confidence tools (by their own directory) win; a plain SQL folder with
// no tool config is the "bare/hand-applied" case only when nothing else matched.
function detectMigrationTools(root: string): DetectedTool[] {
    const tools: DetectedTool[] = [];
    if (isDir(path.join(root, 'supabase', 'migrations'))) tools.push({ tool: 'supabase', dir: path.join(root, 'supabase', 'migrations') });
    if (fs.existsSync(path.join(root, 'drizzle', 'meta', '_journal.json'))) tools.push({ tool: 'drizzle', dir: path.join(root, 'drizzle') });
    if (isDir(path.join(root, 'prisma', 'migrations'))) tools.push({ tool: 'prisma', dir: path.join(root, 'prisma', 'migrations') });
    for (const d of ['migrations', 'db/migrations', 'db', 'sql', 'database']) {
        const dir = path.join(root, d);
        if (!isDir(dir)) continue;
        const files = listDir(dir);
        if (files.some((f) => /\.up\.sql$/i.test(f))) { tools.push({ tool: 'golang-migrate', dir }); break; }
        if (files.some((f) => /^V\d+(\.\d+)*__.+\.sql$/i.test(f))) { tools.push({ tool: 'flyway', dir }); break; }
        if (tools.length === 0 && files.filter((f) => /\.sql$/i.test(f)).length > 0) { tools.push({ tool: 'bare', dir }); break; }
    }
    return tools;
}

function migrationFindings(dt: DetectedTool): { findings: CheckFinding[]; count: number } {
    const { tool, dir } = dt;
    const find: CheckFinding[] = [];
    let count = 0;

    if (tool === 'golang-migrate') {
        const names = new Set(listDir(dir));
        const ups = listDir(dir).filter((f) => /\.up\.sql$/i.test(f));
        count = ups.length;
        const byVer = new Map<string, string[]>();
        const keys: number[] = [];
        for (const f of ups) {
            const m = /^(\d+)_(.+)\.up\.sql$/i.exec(f);
            if (!m) { find.push({ label: f, detail: 'version prefix is not a golang-migrate integer', severity: 'warn' }); continue; }
            const [, version, name] = m;
            if (!names.has(`${version}_${name}.down.sql`)) find.push({ label: `${version}_${name}`, detail: 'up migration has no matching .down.sql', severity: 'warn' });
            if (sqlIsEmpty(path.join(dir, f))) find.push({ label: f, detail: 'migration is empty', severity: 'warn' });
            pushVal(byVer, version, name);
            keys.push(parseInt(version, 10));
        }
        for (const [v, ns] of byVer) if (ns.length > 1) find.push({ label: `version ${v}`, detail: `${ns.length} migrations share this version: ${ns.join(', ')}`, severity: 'fail' });
        const sorted = [...new Set(keys)].filter(Number.isFinite).sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 1) find.push({ label: `gap after ${sorted[i - 1]}`, detail: `missing version(s) ${sorted[i - 1] + 1} to ${sorted[i] - 1}`, severity: 'warn' });
    } else if (tool === 'supabase') {
        const sqls = listDir(dir).filter((f) => /\.sql$/i.test(f));
        count = sqls.length;
        const byVer = new Map<string, string[]>();
        for (const f of sqls) {
            const m = /^(\d{14})_(.+)\.sql$/i.exec(f);
            if (!m) { find.push({ label: f, detail: 'name does not start with a 14-digit timestamp', severity: 'warn' }); continue; }
            if (sqlIsEmpty(path.join(dir, f))) find.push({ label: f, detail: 'migration is empty', severity: 'warn' });
            pushVal(byVer, m[1], m[2]);
        }
        for (const [v, ns] of byVer) if (ns.length > 1) find.push({ label: `timestamp ${v}`, detail: `${ns.length} migrations share this timestamp: ${ns.join(', ')}`, severity: 'fail' });
    } else if (tool === 'prisma') {
        const subdirs = listDir(dir).filter((e) => isDir(path.join(dir, e)));
        count = subdirs.length;
        for (const d of subdirs) {
            const mig = path.join(dir, d, 'migration.sql');
            if (!fs.existsSync(mig)) find.push({ label: d, detail: 'migration folder has no migration.sql', severity: 'fail' });
            else if (sqlIsEmpty(mig)) find.push({ label: d, detail: 'migration.sql is empty', severity: 'warn' });
        }
        if (subdirs.length > 0 && !fs.existsSync(path.join(dir, 'migration_lock.toml'))) find.push({ label: 'migration_lock.toml', detail: 'missing, so the database provider is not pinned', severity: 'warn' });
    } else if (tool === 'drizzle') {
        let entries: { tag?: unknown }[] = [];
        try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')); if (Array.isArray(j.entries)) entries = j.entries; } catch { /* unreadable journal */ }
        count = entries.length;
        const sqlFiles = new Set(listDir(dir).filter((f) => /\.sql$/i.test(f)));
        const referenced = new Set<string>();
        for (const e of entries) {
            const tag = typeof e.tag === 'string' ? e.tag : '';
            if (!tag) continue;
            const file = `${tag}.sql`;
            if (!sqlFiles.has(file)) find.push({ label: tag, detail: 'listed in _journal.json but has no matching .sql', severity: 'fail' });
            else referenced.add(file);
        }
        for (const f of sqlFiles) if (!referenced.has(f)) find.push({ label: f, detail: 'migration file is not listed in _journal.json', severity: 'warn' });
    } else if (tool === 'flyway') {
        const vs = listDir(dir).filter((f) => /^V\d+(\.\d+)*__.+\.sql$/i.test(f));
        count = vs.length;
        const byVer = new Map<string, string[]>();
        for (const f of vs) {
            const m = /^V(\d+(?:\.\d+)*)__(.+)\.sql$/i.exec(f);
            if (!m) continue;
            if (sqlIsEmpty(path.join(dir, f))) find.push({ label: f, detail: 'migration is empty', severity: 'warn' });
            pushVal(byVer, m[1], m[2]);
        }
        for (const [v, ns] of byVer) if (ns.length > 1) find.push({ label: `version V${v}`, detail: `${ns.length} migrations share this version: ${ns.join(', ')}`, severity: 'fail' });
    } else if (tool === 'bare') {
        const sqls = listDir(dir).filter((f) => /\.sql$/i.test(f));
        count = sqls.length;
        const rel = path.basename(dir);
        find.push({
            label: `${rel}/ (${count} .sql ${count === 1 ? 'file' : 'files'})`,
            detail: 'SQL migrations with no tracking file committed (no schema_migrations, journal, or lock)',
            severity: count >= 20 ? 'warn' : 'info',
        });
    }
    return { findings: find, count };
}

function liveDbHint(tool: MigTool): string | undefined {
    switch (tool) {
        case 'supabase': return "To compare against the database, query supabase_migrations.schema_migrations. If the API still returns the old schema, run NOTIFY pgrst, 'reload schema'.";
        case 'golang-migrate': return 'To compare against the database, query the schema_migrations table.';
        case 'prisma': return 'To compare against the database, query _prisma_migrations.';
        case 'drizzle': return 'To compare against the database, query __drizzle_migrations in the drizzle schema.';
        case 'flyway': return 'To compare against the database, query flyway_schema_history.';
        default: return undefined;
    }
}

function migrationDriftCheck(root: string): CheckResult {
    const scannedAt = new Date().toISOString();
    const tools = detectMigrationTools(root);
    if (tools.length === 0) {
        return { id: 'migration-drift', title: 'Database migrations', status: 'skip', summary: 'No database migrations found. Nothing to check.', findings: [], scannedAt };
    }

    const findings: CheckFinding[] = [];
    const toolNames: MigTool[] = [];
    let total = 0;
    for (const dt of tools) {
        toolNames.push(dt.tool);
        findings.push({ label: 'tool', detail: dt.tool, severity: 'info' });
        const r = migrationFindings(dt);
        total += r.count;
        findings.push(...r.findings);
    }

    const status: CheckResult['status'] = findings.some((f) => f.severity === 'fail') ? 'fail'
        : findings.some((f) => f.severity === 'warn') ? 'warn' : 'pass';
    const label = [...new Set(toolNames)].map(toolLabel).join(' + ');
    const issues = findings.filter((f) => f.severity === 'warn' || f.severity === 'fail');

    let summary: string;
    let nextAction: string | undefined;
    const bare = issues.find((f) => f.detail?.includes('no tracking file'));
    const missingDown = issues.find((f) => f.detail?.includes('no matching .down.sql'));
    const noMigSql = issues.find((f) => f.detail?.includes('no migration.sql'));
    const dup = issues.find((f) => f.detail?.includes('share this'));

    if (status === 'pass') {
        summary = `${label}: ${total} migration${total === 1 ? '' : 's'}, all in order.`;
        nextAction = liveDbHint(toolNames[0]);
    } else if (bare) {
        summary = `${bare.label}: no tracking file, so there is no record of which migrations were applied.`;
        nextAction = 'Adopt a migration tool (Supabase, golang-migrate, Prisma, or Drizzle) so applied migrations are tracked.';
    } else {
        summary = issues.length === 1
            ? `${label}: ${issues[0].detail} (${issues[0].label}).`
            : `${label}: ${issues.length} migration issues to look at.`;
        nextAction = dup ? 'Renumber the duplicate migration so each version is unique, then re-run.'
            : noMigSql ? `Add the missing migration.sql or remove the empty ${noMigSql.label} folder.`
                : missingDown ? `Add ${missingDown.label}.down.sql so this migration can be reversed.`
                    : 'Fix the flagged migrations, then re-run.';
    }

    return { id: 'migration-drift', title: 'Database migrations', status, summary, findings, nextAction, scannedAt };
}

// --- Stale / unrelated committed files -------------------------------------
// Build output, tool caches, logs, a committed .env, or two lockfiles that ended
// up in the repo and should not have. Each is cross-checked against .gitignore,
// so a path that IS ignored is never flagged. Read-only; names + reasons only.

function readGitignore(root: string): Set<string> {
    const out = new Set<string>();
    try {
        for (const line of fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith('#') || t.startsWith('!')) continue;
            out.add(t.replace(/^\/+/, '').replace(/\/+$/, ''));
        }
    } catch { /* no .gitignore */ }
    return out;
}

// Matches a top-level name against .gitignore patterns, honouring the common
// glob forms (.env*, *.log, dist*) so an ignored file is never flagged. A `*`
// matches any run of non-slash chars; other patterns match exactly.
function isIgnored(ignore: Set<string>, name: string): boolean {
    for (const pat of ignore) {
        if (pat === name) return true;
        if (pat.includes('*')) {
            const re = new RegExp(`^${pat.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
            if (re.test(name)) return true;
        }
    }
    return false;
}

const JUNK_DIRS: Array<{ name: string; severity: CheckFinding['severity']; why: string }> = [
    { name: 'node_modules', severity: 'fail', why: 'installed dependencies, never commit these' },
    { name: 'dist', severity: 'warn', why: 'build output' },
    { name: 'build', severity: 'warn', why: 'build output' },
    { name: 'out', severity: 'warn', why: 'build output' },
    { name: '.next', severity: 'warn', why: 'Next.js build cache' },
    { name: '.nuxt', severity: 'warn', why: 'Nuxt build cache' },
    { name: '.turbo', severity: 'warn', why: 'Turborepo cache' },
    { name: '.parcel-cache', severity: 'warn', why: 'Parcel cache' },
    { name: 'coverage', severity: 'warn', why: 'test coverage report' },
    { name: '.cache', severity: 'info', why: 'tool cache' },
];
const JUNK_FILES: Array<{ name: string; severity: CheckFinding['severity']; why: string }> = [
    { name: '.DS_Store', severity: 'info', why: 'macOS folder metadata' },
    { name: 'Thumbs.db', severity: 'info', why: 'Windows thumbnail cache' },
    { name: 'npm-debug.log', severity: 'warn', why: 'npm debug log' },
    { name: 'yarn-error.log', severity: 'warn', why: 'yarn error log' },
    { name: 'tsconfig.tsbuildinfo', severity: 'info', why: 'TypeScript incremental build cache' },
];

function staleArtifactsCheck(root: string): CheckResult {
    const scannedAt = new Date().toISOString();
    const ignore = readGitignore(root);
    const findings: CheckFinding[] = [];

    for (const { name, severity, why } of JUNK_DIRS) {
        if (isDir(path.join(root, name)) && !isIgnored(ignore, name)) {
            findings.push({ label: `${name}/`, detail: `${why}, committed and not in .gitignore`, severity });
        }
    }
    for (const { name, severity, why } of JUNK_FILES) {
        if (fs.existsSync(path.join(root, name)) && !isIgnored(ignore, name)) {
            findings.push({ label: name, detail: `${why}, committed and not in .gitignore`, severity });
        }
    }
    for (const env of ['.env', '.env.local', '.env.production']) {
        if (fs.existsSync(path.join(root, env)) && !isIgnored(ignore, env) && !isIgnored(ignore, '.env')) {
            findings.push({ label: env, detail: 'an environment file with secrets, committed and not in .gitignore', severity: 'fail' });
        }
    }
    for (const f of listDir(root)) {
        if (/\.log$/i.test(f) && !isIgnored(ignore, f)) {
            findings.push({ label: f, detail: 'a log file, committed and not in .gitignore', severity: 'warn' });
        }
    }
    const locks = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'].filter((l) => fs.existsSync(path.join(root, l)));
    if (locks.length > 1) {
        findings.push({ label: locks.join(' + '), detail: 'more than one lockfile; keep only the one for your package manager', severity: 'warn' });
    }

    const status: CheckResult['status'] = findings.some((f) => f.severity === 'fail') ? 'fail'
        : findings.some((f) => f.severity === 'warn') ? 'warn' : 'pass';

    const secret = findings.find((f) => f.detail?.includes('environment file'));
    const summary = status === 'pass'
        ? 'No stray build output, caches, or environment files are committed.'
        : secret ? `${secret.label} is committed. Anyone with the repo can read its secrets.`
            : `${findings.length} stray ${findings.length === 1 ? 'file' : 'files'} committed (build output, caches, or logs).`;
    const nextAction = status === 'pass' ? undefined
        : secret ? `Add ${secret.label} to .gitignore, remove it with "git rm --cached ${secret.label}", and rotate the exposed keys.`
            : 'Add these to .gitignore, then remove them from git with "git rm -r --cached <path>".';

    return { id: 'stale-artifacts', title: 'Committed files', status, summary, findings, nextAction, scannedAt };
}

// --- Unused dependencies ----------------------------------------------------
// A package.json `dependencies` entry that is imported nowhere in source, in a
// config file, or in a script. Deliberately conservative: the import scan
// OVER-matches (any from/import/require string), @types/* are skipped, and
// findings are info-severity with a verify-before-removing caveat, so an OSS
// maintainer is never told to delete a dep that is used dynamically or in CSS.

// Matches the specifier in `from '...'`, `import '...'`, `import('...')`,
// `require('...')`. Over-matching here is safe: more "used" = fewer false unused.
const USED_MODULE_RE = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
// CSS at-rules that reference a package: @import "tw-animate-css", @plugin,
// @source/@reference "@scope/tokens" (Tailwind v4 + PostCSS).
const CSS_REF_RE = /@(?:import|use|plugin|source|reference|config|tailwind|forward)\s+(?:url\()?\s*['"]?([^'")\s;]+)/g;
// Any quoted string - used only on config files, where a dep can appear as a
// plugin name or a path-alias key rather than an import statement.
const QUOTED_RE = /['"]([^'"\n]+)['"]/g;
// A config file references deps without importing them (vite/tailwind/postcss
// plugins, tsconfig path aliases, shadcn components.json). package.json is
// excluded - loose-scanning it would mark every dep as used.
const CONFIG_NAME_RE = /(\.config\.[mc]?[jt]s|tsconfig[\w.-]*\.json|components\.json|tailwind\.[\w.-]*|postcss\.[\w.-]*|\.postcssrc[\w.]*)$/i;
const SCAN_SKIP = new Set(['node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.turbo', '.cache', 'vendor', 'target', '.venv', '__pycache__']);

function bareModule(spec: string): string {
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) return '';
    const parts = spec.split('/');
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// All imported bare-module names under a directory subtree (each package's own
// files; over-matching is safe). Bounded so a huge tree stays cheap.
function collectUsedModules(dir: string): Set<string> {
    const used = new Set<string>();
    const stack: string[] = [dir];
    let files = 0;
    while (stack.length > 0 && files < 4000) {
        const d = stack.pop()!;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            if (e.isDirectory()) {
                if (!SCAN_SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(d, e.name));
                continue;
            }
            const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|astro)$/i.test(e.name);
            const isCss = /\.(css|scss|sass|less)$/i.test(e.name);
            const isJsonConfig = /tsconfig[\w.-]*\.json$|components\.json$/i.test(e.name);
            if (!isCode && !isCss && !isJsonConfig) continue;
            files += 1;
            let body: string;
            try { body = fs.readFileSync(path.join(d, e.name), 'utf8').slice(0, 256 * 1024); } catch { continue; }
            const add = (re: RegExp) => {
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(body)) !== null) { const n = bareModule(m[1]); if (n) used.add(n); }
            };
            if (isCode) add(USED_MODULE_RE);
            if (isCss) add(CSS_REF_RE);
            // A dep can appear in a config file as a plugin/alias rather than an
            // import, so scan config files (never package.json) loosely.
            if (isJsonConfig || (isCode && CONFIG_NAME_RE.test(e.name))) add(QUOTED_RE);
        }
    }
    return used;
}

// Every package.json under the repo (root + workspace sub-packages), bounded.
function findManifests(root: string, cap: number): string[] {
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0 && out.length < cap) {
        const d = stack.pop()!;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            if (e.isDirectory()) {
                if (!SCAN_SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(d, e.name));
            } else if (e.name === 'package.json') {
                out.push(path.join(d, e.name));
            }
        }
    }
    return out;
}

function unusedDepsCheck(root: string): CheckResult {
    const scannedAt = new Date().toISOString();
    const base = { id: 'unused-deps', title: 'Dependencies', findings: [] as CheckFinding[], scannedAt };
    const manifests = findManifests(root, 40);
    if (manifests.length === 0) return { ...base, status: 'skip', summary: 'No package.json to check.' };

    const findings: CheckFinding[] = [];
    let totalDeps = 0;
    for (const mf of manifests) {
        let pkg: { dependencies?: Record<string, unknown>; scripts?: Record<string, unknown> };
        try { pkg = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { continue; }
        const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : [];
        if (deps.length === 0) continue;
        totalDeps += deps.length;
        const dir = path.dirname(mf);
        const rel = path.relative(root, dir).replace(/\\/g, '/');
        // A dep is used if imported anywhere in this package's subtree, named in
        // its scripts (a CLI like vite/tsx), or is a @types/* type-only dep.
        const used = collectUsedModules(dir);
        const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? Object.values(pkg.scripts).join(' ') : '';
        for (const dep of deps) {
            if (dep.startsWith('@types/') || used.has(dep) || scripts.includes(dep)) continue;
            findings.push({ label: rel ? `${rel}: ${dep}` : dep, detail: 'declared but not imported in this package', severity: 'info' });
        }
    }

    if (totalDeps === 0) return { ...base, status: 'skip', summary: 'No runtime dependencies declared.' };
    if (findings.length === 0) {
        return { ...base, status: 'pass', summary: `All ${totalDeps} declared ${totalDeps === 1 ? 'dependency is' : 'dependencies are'} imported somewhere.` };
    }
    return {
        ...base,
        status: 'warn',
        summary: `${findings.length} declared ${findings.length === 1 ? 'dependency is' : 'dependencies are'} not imported. They may be used in config, CSS, or dynamically.`,
        findings,
        nextAction: 'Confirm each is unused (search for dynamic or config use), then remove it from that package.json.',
    };
}

// Distribution-readiness: flag copyleft dependency licenses (wraps the
// license-check module so the gate and the assistant share one source).
function licenseRiskCheck(root: string): CheckResult {
    const scannedAt = new Date().toISOString();
    const r = checkLicenses(root);
    if (!r.ok) return { id: 'license-risk', title: 'Dependency licenses', status: 'skip', summary: r.error ?? 'Could not read dependency licenses.', findings: [], scannedAt };
    const strong = r.counts['strong-copyleft'];
    const weak = r.counts['weak-copyleft'];
    const findings: CheckFinding[] = r.flagged.slice(0, 20).map((f) => ({
        label: `${f.name}@${f.version}`,
        detail: `${f.license} (${f.class})`,
        severity: f.class === 'strong-copyleft' ? 'fail' : 'warn',
    }));
    const status: CheckResult['status'] = strong > 0 ? 'fail' : weak > 0 ? 'warn' : 'pass';
    const summary = status === 'pass'
        ? `Project license ${r.projectLicense ?? 'unset'}; ${r.totalScanned} dependencies scanned, no copyleft risk.`
        : `${strong} strong-copyleft and ${weak} weak-copyleft dependencies out of ${r.totalScanned}.`;
    return {
        id: 'license-risk', title: 'Dependency licenses', status, summary, findings, scannedAt,
        nextAction: status === 'pass' ? undefined : 'Review each flagged dependency; replace or get sign-off on the copyleft ones before distributing.',
    };
}

// Config hygiene: dead tsconfig paths, missing script files, unused env names.
function deadConfigCheck(root: string): CheckResult {
    const scannedAt = new Date().toISOString();
    const r = scanDeadConfig(root);
    if (!r.ok) return { id: 'dead-config', title: 'Config hygiene', status: 'skip', summary: r.error ?? 'Could not scan configuration.', findings: [], scannedAt };
    if (!r.findings.length) return { id: 'dead-config', title: 'Config hygiene', status: 'pass', summary: 'No dead or unused configuration found.', findings: [], scannedAt };
    const findings: CheckFinding[] = r.findings.slice(0, 20).map((f) => ({ label: f.kind, detail: `${f.detail} (${f.file})`, severity: 'warn' }));
    return {
        id: 'dead-config', title: 'Config hygiene', status: 'warn',
        summary: `${r.findings.length} dead or unused config ${r.findings.length === 1 ? 'item' : 'items'}.`,
        findings, scannedAt,
        nextAction: 'Remove the unresolved tsconfig paths, missing script files, and unused env names.',
    };
}

// The registered checks. The golden path (v0.6) appends more.
const CHECKS: ((root: string) => CheckResult)[] = [envDiffCheck, migrationDriftCheck, staleArtifactsCheck, unusedDepsCheck, licenseRiskCheck, deadConfigCheck];

export function runChecks(projectRoot: string): CheckResult[] {
    const root = resolveRoot(projectRoot);
    if (!root) return [];
    return CHECKS.map((c) => {
        try { return c(root); } catch (err) {
            return { id: 'error', title: 'Check failed', status: 'fail' as const, summary: err instanceof Error ? err.message : String(err), findings: [], scannedAt: new Date().toISOString() };
        }
    });
}
