// console-electron/src/main/db-saturation.ts
//
// Queries Postgres saturation signals with a user-supplied read-only connection
// string. The string is used once, never stored, never echoed in errors. Only
// SELECTs run. The connection is closed immediately after the query.
import { Client } from 'pg';

export interface DbSaturation {
    ok: boolean;
    usedConns?: number;
    maxConns?: number;
    pctUsed?: number;
    idleInTx?: number;
    longestQuerySecs?: number;
    blocked?: number;
    warnings?: string[];
    error?: string;
}

// Strip any postgres:// URI from error text so passwords never appear in logs.
function redactConn(msg: string): string {
    return msg.replace(/postgres(?:ql)?:\/\/[^\s'"]*/gi, '[connection]');
}

const ACTIVITY_QUERY = `
SELECT
    count(*) FILTER (WHERE state = 'active')              AS active,
    count(*) FILTER (WHERE state = 'idle')                AS idle,
    count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
    count(*) FILTER (WHERE wait_event_type = 'Lock')      AS blocked,
    COALESCE(
        EXTRACT(EPOCH FROM max(now() - query_start))
            FILTER (WHERE state = 'active' AND query_start IS NOT NULL),
        0
    )::float8 AS longest_secs
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
`;

export async function dbSaturation(connString: string): Promise<DbSaturation> {
    if (typeof connString !== 'string' || connString.trim().length === 0) {
        return { ok: false, error: 'A read-only database connection string is required.' };
    }

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

        const [actRes, maxRes] = await Promise.all([
            client.query(ACTIVITY_QUERY),
            client.query(`SELECT current_setting('max_connections')::int AS max_connections`),
        ]);

        const row = actRes.rows[0] as {
            active: string | number;
            idle: string | number;
            idle_in_tx: string | number;
            blocked: string | number;
            longest_secs: number;
        };

        const active   = Number(row.active)     || 0;
        const idle     = Number(row.idle)        || 0;
        const idleInTx = Number(row.idle_in_tx)  || 0;
        const blocked  = Number(row.blocked)     || 0;
        const longestQuerySecs = Number(row.longest_secs) || 0;

        const maxConns  = Number((maxRes.rows[0] as { max_connections: number }).max_connections) || 0;
        const usedConns = active + idle + idleInTx;
        const pctUsed   = maxConns > 0 ? Math.round((usedConns / maxConns) * 100) : 0;

        const warnings: string[] = [];
        if (pctUsed >= 90) warnings.push(`Connection pool at ${pctUsed}% capacity (${usedConns}/${maxConns}).`);
        else if (pctUsed >= 70) warnings.push(`Connection pool at ${pctUsed}% capacity.`);
        if (idleInTx > 0) warnings.push(`${idleInTx} connection(s) idle in transaction; check for unclosed transactions.`);
        if (blocked > 0) warnings.push(`${blocked} connection(s) waiting on a lock.`);
        if (longestQuerySecs > 30) warnings.push(`Longest active query has been running ${Math.round(longestQuerySecs)}s.`);

        return { ok: true, usedConns, maxConns, pctUsed, idleInTx, longestQuerySecs, blocked, warnings };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: redactConn(msg) };
    } finally {
        try { await client.end(); } catch { /* already closed */ }
    }
}
