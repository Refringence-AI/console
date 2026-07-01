// console-electron/src/main/env-diff.ts
//
// Deterministic env-key diff. Compares the KEY NAMES declared in
// .env.example / .env.sample / .env.template against .env (and .env.local).
//
// Privacy contract: only the left-hand side of each KEY=... line is read.
// Values are never read, held, or returned.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface EnvDiff {
    ok: boolean;
    error?: string;
    hasExample: boolean;
    hasEnv: boolean;
    missingInEnv: string[];   // in example, absent from .env
    extraInEnv: string[];     // in .env, absent from example
    inSync: boolean;
}

const EXAMPLE_NAMES = ['.env.example', '.env.sample', '.env.template'] as const;
const ENV_NAMES = ['.env', '.env.local'] as const;

function resolveDir(input: string): string | null {
    if (typeof input !== 'string' || input.trim().length === 0) return null;
    const abs = path.resolve(input);
    try {
        if (!fs.statSync(abs).isDirectory()) return null;
    } catch {
        return null;
    }
    return abs;
}

function firstFile(root: string, candidates: readonly string[]): string | null {
    for (const name of candidates) {
        const full = path.join(root, name);
        try {
            if (fs.statSync(full).isFile()) return full;
        } catch {
            // next candidate
        }
    }
    return null;
}

// Extract KEY NAMES only (left of '='). Handles:
//   KEY=value
//   export KEY=value
//   KEY=          (empty value - still a valid name)
// Ignores comments and blank lines. Deduplicated, order-preserving.
function parseKeyNames(filePath: string): string[] {
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
        // Strip leading `export ` (with optional extra whitespace)
        const stripped = /^export\s+(.*)$/.exec(trimmed)?.[1] ?? trimmed;
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(stripped);
        if (m && !seen.has(m[1])) {
            seen.add(m[1]);
            out.push(m[1]);
        }
    }
    return out;
}

export function diffEnvKeys(projectRoot: string): EnvDiff {
    const root = resolveDir(projectRoot);
    if (!root) {
        return { ok: false, error: 'Invalid project root', hasExample: false, hasEnv: false, missingInEnv: [], extraInEnv: [], inSync: false };
    }

    const exampleFile = firstFile(root, EXAMPLE_NAMES);
    const hasExample = exampleFile !== null;

    const envFile = firstFile(root, ENV_NAMES);
    const hasEnv = envFile !== null;

    if (!hasExample) {
        return { ok: true, hasExample: false, hasEnv, missingInEnv: [], extraInEnv: [], inSync: !hasEnv };
    }

    const exampleKeys = parseKeyNames(exampleFile);

    if (!hasEnv) {
        return { ok: true, hasExample: true, hasEnv: false, missingInEnv: exampleKeys, extraInEnv: [], inSync: exampleKeys.length === 0 };
    }

    const envKeyList = parseKeyNames(envFile);
    const envKeySet = new Set(envKeyList);
    const exampleKeySet = new Set(exampleKeys);

    const missingInEnv = exampleKeys.filter((k) => !envKeySet.has(k));
    const extraInEnv = envKeyList.filter((k) => !exampleKeySet.has(k));
    const inSync = missingInEnv.length === 0 && extraInEnv.length === 0;

    return { ok: true, hasExample: true, hasEnv: true, missingInEnv, extraInEnv, inSync };
}
