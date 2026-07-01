// console-electron/src/main/migration-live.ts
//
// The optional live half of the migration-drift check: connect to the database
// with a user-supplied read-only connection string, read the applied-migrations
// table, and diff it against the migration files. This is what catches the
// flo101 case - migrations applied to the database that were never committed, and
// committed migrations that were never applied. The connection string is used
// once and never stored; only SELECTs run; the connection is closed immediately.
import { Client } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LiveMigrationDiff {
    ok: boolean;
    tool?: string;
    appliedCount?: number;
    fileCount?: number;
    pending?: string[];   // in the files, not applied to the database
    extra?: string[];     // applied to the database, with no matching file (drift)
    error?: string;
}

function isDir(p: string): boolean { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listSql(dir: string): string[] { try { return fs.readdirSync(dir).filter((f) => /\.sql$/i.test(f)); } catch { return []; } }

// The applied-migrations table + a query yielding one `version` text column.
const APPLIED_QUERY: Record<string, string> = {
    supabase: 'SELECT version::text AS version FROM supabase_migrations.schema_migrations ORDER BY version',
    'golang-migrate': 'SELECT version::text AS version FROM schema_migrations ORDER BY version',
    prisma: 'SELECT migration_name AS version FROM _prisma_migrations ORDER BY migration_name',
    flyway: 'SELECT version::text AS version FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY version',
};

// The migration versions on disk + which tool, mirroring the file-based check's
// detection but returning the version list the live diff compares against.
function fileVersions(root: string): { tool: string; versions: string[] } | null {
    let dir = path.join(root, 'supabase', 'migrations');
    if (isDir(dir)) {
        return { tool: 'supabase', versions: listSql(dir).map((f) => /^(\d{14})/.exec(f)?.[1]).filter((v): v is string => Boolean(v)) };
    }
    dir = path.join(root, 'prisma', 'migrations');
    if (isDir(dir)) {
        return { tool: 'prisma', versions: fs.readdirSync(dir).filter((d) => d !== 'migration_lock.toml' && isDir(path.join(dir, d))) };
    }
    for (const d of ['migrations', 'db/migrations', 'db', 'sql', 'database']) {
        const full = path.join(root, d);
        if (!isDir(full)) continue;
        const files = fs.readdirSync(full);
        if (files.some((f) => /\.up\.sql$/i.test(f))) {
            const versions = files.map((f) => /^(\d+)_/.exec(f)?.[1]).filter((v): v is string => Boolean(v));
            return { tool: 'golang-migrate', versions: [...new Set(versions)] };
        }
        if (files.some((f) => /^V\d+(\.\d+)*__.+\.sql$/i.test(f))) {
            const versions = files.map((f) => /^V(\d+(?:\.\d+)*)__/.exec(f)?.[1]).filter((v): v is string => Boolean(v));
            return { tool: 'flyway', versions };
        }
    }
    return null;
}

export async function liveMigrationDiff(root: string, connString: string): Promise<LiveMigrationDiff> {
    if (typeof connString !== 'string' || connString.trim().length === 0) {
        return { ok: false, error: 'A read-only database connection string is required.' };
    }
    const fv = fileVersions(root);
    if (!fv) return { ok: false, error: 'No migrations directory found in this project.' };
    const query = APPLIED_QUERY[fv.tool];
    if (!query) return { ok: false, error: `Live diff is not supported for ${fv.tool} yet (file-based checks still run).` };

    const client = new Client({
        connectionString: connString.trim(),
        connectionTimeoutMillis: 8000,
        statement_timeout: 8000,
        // Verify the server certificate by default; only relax it when the user
        // explicitly opts out (sslmode=disable turns TLS off; sslmode=no-verify
        // keeps TLS but skips verification for a self-signed dev database).
        ssl: /sslmode=disable/.test(connString) ? false : { rejectUnauthorized: !/sslmode=no-verify/.test(connString) },
    });
    try {
        await client.connect();
        const res = await client.query(query);
        const applied = res.rows.map((r) => String((r as { version: unknown }).version)).filter(Boolean);
        const appliedSet = new Set(applied);
        const fileSet = new Set(fv.versions);
        return {
            ok: true,
            tool: fv.tool,
            appliedCount: applied.length,
            fileCount: fv.versions.length,
            pending: fv.versions.filter((v) => !appliedSet.has(v)),
            extra: applied.filter((v) => !fileSet.has(v)),
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Never echo the connection string (it can carry the password) in errors.
        return { ok: false, error: msg.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[connection]') };
    } finally {
        try { await client.end(); } catch { /* already closed */ }
    }
}
