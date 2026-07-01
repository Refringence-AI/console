// console-electron/src/main/migration-drift.ts
//
// File-based migration drift detection. No database connection required.
// Detects the migration tool in use, lists migration files in order, and
// flags structural problems: numbering gaps, duplicate version prefixes,
// an up file with no matching down (where the convention pairs them), and
// timestamp-vs-sequence inconsistency (supabase: 14-digit timestamp vs
// a plain incrementing integer in the same directory).
//
// Supported tools: supabase, prisma, drizzle, golang-migrate, flyway,
// knex (JS migrations/), sequelize (migrations/).
//
// Return shape: MigrationReport, always. Never throws.

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationEntry {
    name: string;    // basename of the file or directory
    version: string; // extracted version/prefix string
}

export interface MigrationReport {
    ok: boolean;
    tool: string;       // 'supabase' | 'prisma' | 'drizzle' | 'golang-migrate' | 'flyway' | 'knex' | 'sequelize' | 'unknown'
    dir: string;        // absolute path that was scanned
    count: number;      // total migration files / dirs found
    migrations: MigrationEntry[];
    gaps: string[];     // ordered list of gap descriptions
    warnings: string[]; // non-fatal anomalies
    error?: string;     // set when ok is false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function readDir(p: string): string[] {
    try { return fs.readdirSync(p); } catch { return []; }
}

function safeResolve(root: string): string {
    try { return path.resolve(root); } catch { return root; }
}

// Returns [] when the path does not exist or is not a directory.
function listFiles(dir: string): string[] {
    if (!isDir(dir)) return [];
    return readDir(dir).sort(); // lexicographic order is version order for well-formed names
}

// ---------------------------------------------------------------------------
// Tool-specific parsers
// Each returns null when the directory/structure is not present.
// ---------------------------------------------------------------------------

interface Parsed {
    tool: string;
    dir: string;
    entries: MigrationEntry[];
}

function trySupabase(root: string): Parsed | null {
    const dir = path.join(root, 'supabase', 'migrations');
    if (!isDir(dir)) return null;
    const files = listFiles(dir).filter((f) => /\.sql$/i.test(f));
    const entries: MigrationEntry[] = files.map((f) => {
        const m = /^(\d{14})/.exec(f);
        return { name: f, version: m?.[1] ?? f };
    });
    return { tool: 'supabase', dir, entries };
}

function tryPrisma(root: string): Parsed | null {
    const dir = path.join(root, 'prisma', 'migrations');
    if (!isDir(dir)) return null;
    // Prisma directories are named <timestamp>_<description>; each contains migration.sql
    const subdirs = listFiles(dir).filter(
        (d) => d !== 'migration_lock.toml' && isDir(path.join(dir, d)),
    );
    const entries: MigrationEntry[] = subdirs.map((d) => {
        const m = /^(\d+)/.exec(d);
        return { name: d, version: m?.[1] ?? d };
    });
    return { tool: 'prisma', dir, entries };
}

function tryDrizzle(root: string): Parsed | null {
    // drizzle/ directory with a meta/ subdirectory is the canonical shape.
    for (const candidate of ['drizzle', 'src/db/migrations', 'db/migrations/drizzle']) {
        const dir = path.join(root, candidate);
        if (!isDir(dir)) continue;
        const metaDir = path.join(dir, 'meta');
        if (!isDir(metaDir)) continue;
        const files = listFiles(dir).filter((f) => /\d{4}_.+\.sql$/i.test(f));
        if (files.length === 0) continue;
        const entries: MigrationEntry[] = files.map((f) => {
            const m = /^(\d+)/.exec(f);
            return { name: f, version: m?.[1] ?? f };
        });
        return { tool: 'drizzle', dir, entries };
    }
    return null;
}

function tryGolangMigrate(root: string): Parsed | null {
    const candidates = ['migrations', 'db/migrations', 'database/migrations', 'db', 'sql', 'database'];
    for (const cand of candidates) {
        const dir = path.join(root, cand);
        if (!isDir(dir)) continue;
        const files = readDir(dir);
        // golang-migrate pairs: NNNN_name.up.sql + NNNN_name.down.sql
        if (!files.some((f) => /\.up\.sql$/i.test(f))) continue;
        // Collect unique version numbers; list both .up and .down as separate entries
        const allSql = files.filter((f) => /\.(up|down)\.sql$/i.test(f)).sort();
        const entries: MigrationEntry[] = allSql.map((f) => {
            const m = /^(\d+)/.exec(f);
            return { name: f, version: m?.[1] ?? f };
        });
        return { tool: 'golang-migrate', dir, entries };
    }
    return null;
}

function tryFlyway(root: string): Parsed | null {
    const candidates = ['migrations', 'db/migrations', 'sql', 'flyway', 'src/main/resources/db/migration'];
    for (const cand of candidates) {
        const dir = path.join(root, cand);
        if (!isDir(dir)) continue;
        const files = readDir(dir);
        if (!files.some((f) => /^V\d+/.test(f))) continue;
        const versioned = files.filter((f) => /^V\d/.test(f)).sort();
        const entries: MigrationEntry[] = versioned.map((f) => {
            const m = /^V(\d+(?:\.\d+)*)__/.exec(f);
            return { name: f, version: m?.[1] ?? f };
        });
        return { tool: 'flyway', dir, entries };
    }
    return null;
}

function tryKnexOrSequelize(root: string): Parsed | null {
    // Both knex and sequelize use a migrations/ directory with JS/TS files
    // named with a timestamp prefix: 20231001120000_create_users.js
    const dir = path.join(root, 'migrations');
    if (!isDir(dir)) return null;
    const files = readDir(dir).filter((f) => /\.(js|ts|cjs|mjs)$/.test(f)).sort();
    if (files.length === 0) return null;
    // Detect tool by checking package.json for knex vs sequelize
    let tool = 'knex';
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps['sequelize'] || allDeps['sequelize-cli']) tool = 'sequelize';
    } catch { /* ignore */ }
    const entries: MigrationEntry[] = files.map((f) => {
        const m = /^(\d+)/.exec(f);
        return { name: f, version: m?.[1] ?? f };
    });
    return { tool, dir, entries };
}

// ---------------------------------------------------------------------------
// Analysis: gap, duplicate, up-without-down, timestamp inconsistency
// ---------------------------------------------------------------------------

function analyzeSupabase(entries: MigrationEntry[]): { gaps: string[]; warnings: string[] } {
    const gaps: string[] = [];
    const warnings: string[] = [];
    const versions = entries.map((e) => e.version);
    const seen = new Map<string, number>();
    for (const v of versions) {
        seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    for (const [v, count] of seen.entries()) {
        if (count > 1) warnings.push(`duplicate version prefix ${v} (${count} files)`);
    }
    // Supabase uses 14-digit timestamps (YYYYMMDDHHmmss). If a version does
    // not match that shape, warn - mixing timestamp and sequence is a sign
    // of a hand-edited migration.
    const tsRe = /^\d{14}$/;
    const seqRe = /^\d{1,6}$/;
    let hasTs = false, hasSeq = false;
    for (const v of versions) {
        if (tsRe.test(v)) { hasTs = true; }
        else if (seqRe.test(v)) { hasSeq = true; }
    }
    if (hasTs && hasSeq) warnings.push('mixed timestamp and sequence version prefixes detected');
    return { gaps, warnings };
}

function analyzePrisma(entries: MigrationEntry[]): { gaps: string[]; warnings: string[] } {
    const gaps: string[] = [];
    const warnings: string[] = [];
    const versions = entries.map((e) => e.version);
    const seen = new Map<string, number>();
    for (const v of versions) seen.set(v, (seen.get(v) ?? 0) + 1);
    for (const [v, count] of seen.entries()) {
        if (count > 1) warnings.push(`duplicate version prefix ${v} (${count} directories)`);
    }
    // Prisma timestamps are typically 14 digits, same as supabase.
    const tsRe = /^\d{14}$/;
    const seqRe = /^\d{1,6}$/;
    let hasTs = false, hasSeq = false;
    for (const v of versions) {
        if (tsRe.test(v)) { hasTs = true; } else if (seqRe.test(v)) { hasSeq = true; }
    }
    if (hasTs && hasSeq) warnings.push('mixed timestamp and sequence version prefixes detected');
    return { gaps, warnings };
}

function analyzeGolangMigrate(entries: MigrationEntry[]): { gaps: string[]; warnings: string[] } {
    const gaps: string[] = [];
    const warnings: string[] = [];

    // Separate up and down files.
    const upFiles = entries.filter((e) => /\.up\.sql$/i.test(e.name));
    const downFiles = entries.filter((e) => /\.down\.sql$/i.test(e.name));
    const upVersions = new Set(upFiles.map((e) => e.version));
    const downVersions = new Set(downFiles.map((e) => e.version));

    for (const v of upVersions) {
        if (!downVersions.has(v)) gaps.push(`up file for version ${v} has no matching down file`);
    }
    for (const v of downVersions) {
        if (!upVersions.has(v)) warnings.push(`down file for version ${v} has no matching up file`);
    }

    // Numeric gap detection on the up-file sequence.
    const nums = [...upVersions].map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) {
        const prev = nums[i - 1];
        const curr = nums[i];
        if (curr !== prev + 1) {
            gaps.push(`gap in sequence: version ${prev} is followed by ${curr} (expected ${prev + 1})`);
        }
    }

    // Duplicate up-version prefixes
    const seenUp = new Map<string, number>();
    for (const e of upFiles) seenUp.set(e.version, (seenUp.get(e.version) ?? 0) + 1);
    for (const [v, count] of seenUp.entries()) {
        if (count > 1) warnings.push(`duplicate version prefix ${v} in up files (${count} files)`);
    }

    return { gaps, warnings };
}

function analyzeFlyway(entries: MigrationEntry[]): { gaps: string[]; warnings: string[] } {
    const gaps: string[] = [];
    const warnings: string[] = [];
    const seen = new Map<string, number>();
    for (const e of entries) seen.set(e.version, (seen.get(e.version) ?? 0) + 1);
    for (const [v, count] of seen.entries()) {
        if (count > 1) warnings.push(`duplicate version ${v} (${count} files)`);
    }
    // Numeric gap: check integer part of each version
    const nums = [...seen.keys()]
        .map((v) => parseInt(v.split('.')[0], 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] !== nums[i - 1] + 1) {
            gaps.push(`gap in flyway sequence: version ${nums[i - 1]} is followed by ${nums[i]}`);
        }
    }
    return { gaps, warnings };
}

function analyzeKnexSequelize(entries: MigrationEntry[]): { gaps: string[]; warnings: string[] } {
    const gaps: string[] = [];
    const warnings: string[] = [];
    const versions = entries.map((e) => e.version);
    const seen = new Map<string, number>();
    for (const v of versions) seen.set(v, (seen.get(v) ?? 0) + 1);
    for (const [v, count] of seen.entries()) {
        if (count > 1) warnings.push(`duplicate timestamp prefix ${v} (${count} files)`);
    }
    const tsRe = /^\d{14}$/;
    const seqRe = /^\d{1,6}$/;
    let hasTs = false, hasSeq = false;
    for (const v of versions) {
        if (tsRe.test(v)) { hasTs = true; } else if (seqRe.test(v)) { hasSeq = true; }
    }
    if (hasTs && hasSeq) warnings.push('mixed timestamp and sequence prefixes in migrations/');
    return { gaps, warnings };
}

function analyzeDrizzle(entries: MigrationEntry[]): { gaps: string[]; warnings: string[] } {
    const gaps: string[] = [];
    const warnings: string[] = [];
    const versions = entries.map((e) => e.version);
    const seen = new Map<string, number>();
    for (const v of versions) seen.set(v, (seen.get(v) ?? 0) + 1);
    for (const [v, count] of seen.entries()) {
        if (count > 1) warnings.push(`duplicate sequence prefix ${v} (${count} files)`);
    }
    // Drizzle uses 0000, 0001, 0002 ... check for gaps
    const nums = versions.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] !== nums[i - 1] + 1) {
            gaps.push(`gap in drizzle sequence: ${nums[i - 1].toString().padStart(4, '0')} is followed by ${nums[i].toString().padStart(4, '0')}`);
        }
    }
    return { gaps, warnings };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function scanMigrations(root: string): MigrationReport {
    const resolvedRoot = safeResolve(root);

    // Guard: root must exist
    if (!isDir(resolvedRoot)) {
        return {
            ok: false, tool: 'unknown', dir: resolvedRoot,
            count: 0, migrations: [], gaps: [], warnings: [],
            error: `directory not found: ${resolvedRoot}`,
        };
    }

    // Detection order: most-specific signatures first
    const parsed: Parsed | null =
        trySupabase(resolvedRoot) ??
        tryPrisma(resolvedRoot) ??
        tryDrizzle(resolvedRoot) ??
        tryFlyway(resolvedRoot) ??
        tryGolangMigrate(resolvedRoot) ??
        tryKnexOrSequelize(resolvedRoot);

    if (!parsed) {
        return {
            ok: true, tool: 'unknown', dir: resolvedRoot,
            count: 0, migrations: [], gaps: [], warnings: ['no migrations directory detected'],
        };
    }

    let gapsAndWarnings: { gaps: string[]; warnings: string[] };
    switch (parsed.tool) {
        case 'supabase':       gapsAndWarnings = analyzeSupabase(parsed.entries);        break;
        case 'prisma':         gapsAndWarnings = analyzePrisma(parsed.entries);          break;
        case 'drizzle':        gapsAndWarnings = analyzeDrizzle(parsed.entries);         break;
        case 'golang-migrate': gapsAndWarnings = analyzeGolangMigrate(parsed.entries);   break;
        case 'flyway':         gapsAndWarnings = analyzeFlyway(parsed.entries);          break;
        case 'knex':
        case 'sequelize':      gapsAndWarnings = analyzeKnexSequelize(parsed.entries);   break;
        default:               gapsAndWarnings = { gaps: [], warnings: [] };
    }

    return {
        ok: true,
        tool: parsed.tool,
        dir: parsed.dir,
        count: parsed.entries.length,
        migrations: parsed.entries,
        gaps: gapsAndWarnings.gaps,
        warnings: gapsAndWarnings.warnings,
    };
}
