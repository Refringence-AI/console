// console-electron/src/main/sbom.ts
//
// Deterministic CycloneDX 1.5 JSON SBOM builder. No network: reads
// package.json + lockfile from disk only. Walks workspace packages in a
// monorepo so each sub-package's direct deps are included. Version
// resolution priority: lockfile (exact) > manifest range (fallback).
//
// Public surface: buildSbom(root, generatedAt).
// Call new Date().toISOString() at the call site so this module stays
// side-effect-free and fully testable without faking time.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// ── CycloneDX 1.5 types ──────────────────────────────────────────────────

export interface SbomTool {
    vendor: string;
    name: string;
    version: string;
}

export interface SbomComponent {
    type: 'library';
    'bom-ref': string;
    name: string;
    version: string;
    purl: string;
}

export interface SbomMetadataComponent {
    type: 'application';
    name: string;
    version?: string;
}

export interface SbomMetadata {
    timestamp: string;
    tools: SbomTool[];
    component: SbomMetadataComponent;
}

export interface CycloneDxBom {
    bomFormat: 'CycloneDX';
    specVersion: '1.5';
    serialNumber: string;
    version: number;
    metadata: SbomMetadata;
    components: SbomComponent[];
}

export interface SbomResult {
    ok: boolean;
    bom?: CycloneDxBom;
    componentCount?: number;
    error?: string;
}

// ── lockfile parsers ──────────────────────────────────────────────────────

// package-lock.json v2/v3: packages["node_modules/<name>"].version
function parsePackageLock(lockText: string): Map<string, string> {
    const out = new Map<string, string>();
    let lock: unknown;
    try {
        lock = JSON.parse(lockText);
    } catch {
        return out;
    }
    const pkgs = (lock as Record<string, unknown>).packages;
    if (!pkgs || typeof pkgs !== 'object') return out;
    for (const [key, val] of Object.entries(pkgs as Record<string, unknown>)) {
        if (!key.startsWith('node_modules/')) continue;
        // Strip leading "node_modules/" and any nested "node_modules/" prefix.
        const name = key.replace(/^node_modules\//, '').replace(/\/node_modules\//, '/');
        const version = (val as Record<string, unknown>).version;
        if (typeof version === 'string' && version) {
            out.set(name, version);
        }
    }
    return out;
}

// pnpm-lock.yaml: packages section "/<name>/<version>:" or "/<name>@<version>:"
// Heuristic: match lines "  /<name>/<ver>:" capturing name + version.
function parsePnpmLock(lockText: string): Map<string, string> {
    const out = new Map<string, string>();
    // pnpm v6-v9 shapes vary; we use a regexp that handles both.
    // Format: "  /package-name/1.2.3:" or "  /package-name@1.2.3:"
    const re = /^  \/((?:@[^/@]+\/)?[^/@\s]+)[@/](\d[^\s:]*)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lockText)) !== null) {
        const name = m[1];
        const version = m[2];
        if (name && version && !out.has(name)) {
            out.set(name, version);
        }
    }
    return out;
}

// yarn.lock: lines like:
//   package-name@^1.0.0:
//     version "1.2.3"
function parseYarnLock(lockText: string): Map<string, string> {
    const out = new Map<string, string>();
    const nameRe = /^"?([^@"]+)@[^:]+:"?\s*$/;
    const verRe = /^\s+version "([^"]+)"/;
    let currentName: string | null = null;
    for (const raw of lockText.split('\n')) {
        const nm = nameRe.exec(raw);
        if (nm) {
            // Strip scope-less trailing comma artefacts.
            currentName = nm[1].replace(/,\s*$/, '').trim();
            continue;
        }
        if (currentName) {
            const vm = verRe.exec(raw);
            if (vm) {
                if (!out.has(currentName)) out.set(currentName, vm[1]);
                currentName = null;
            }
        }
    }
    return out;
}

function loadLockfile(root: string): Map<string, string> {
    const candidates: Array<[string, (t: string) => Map<string, string>]> = [
        ['package-lock.json', parsePackageLock],
        ['pnpm-lock.yaml', parsePnpmLock],
        ['yarn.lock', parseYarnLock],
    ];
    for (const [name, parser] of candidates) {
        const p = path.join(root, name);
        try {
            if (fs.existsSync(p)) return parser(fs.readFileSync(p, 'utf8'));
        } catch { /* skip malformed */ }
    }
    return new Map();
}

// ── manifest readers ──────────────────────────────────────────────────────

type PkgJson = {
    name?: string;
    version?: string;
    workspaces?: string[] | { packages?: string[] };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

function readPkgJson(p: string): PkgJson | null {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as PkgJson;
    } catch {
        return null;
    }
}

// Expand workspace globs (supports "packages/*" and "apps/*" patterns only;
// no full glob engine needed, just directory-level wildcards).
function expandWorkspaceDirs(root: string, pkg: PkgJson): string[] {
    const ws = pkg.workspaces;
    const globs: string[] = [];
    if (Array.isArray(ws)) {
        for (const g of ws) if (typeof g === 'string') globs.push(g);
    } else if (ws && typeof ws === 'object' && Array.isArray(ws.packages)) {
        for (const g of ws.packages) if (typeof g === 'string') globs.push(g);
    }
    const dirs: string[] = [];
    for (const g of globs) {
        const base = g.replace(/\/\*+$/, '');
        const baseDir = path.join(root, base);
        try {
            if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) continue;
            for (const ent of fs.readdirSync(baseDir, { withFileTypes: true })) {
                if (!ent.isDirectory()) continue;
                const sub = path.join(baseDir, ent.name);
                if (fs.existsSync(path.join(sub, 'package.json'))) dirs.push(sub);
            }
        } catch { /* skip inaccessible */ }
    }
    return dirs;
}

// Range "^1.2.3" -> "1.2.3"; skip workspace:/file:/git/etc.
function cleanRange(range: string): string | null {
    if (typeof range !== 'string') return null;
    const trimmed = range.trim();
    if (/^(workspace:|file:|link:|git\+|https?:|github:|\*|latest)/.test(trimmed)) return null;
    const m = trimmed.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?)/);
    return m ? m[1] : null;
}

// ── purl builder ─────────────────────────────────────────────────────────

function buildPurl(name: string, version: string): string {
    // Scoped packages: @scope/name -> pkg:npm/%40scope%2Fname@version
    const encoded = name.startsWith('@')
        ? encodeURIComponent(name).replace(/%40/, '@').replace('%2F', '/')
        : name;
    return `pkg:npm/${encoded}@${version}`;
}

// ── bom-ref dedup helper ─────────────────────────────────────────────────

function bomRef(name: string, version: string): string {
    return `${name}@${version}`;
}

// ── serial number (UUID v4 without external deps) ────────────────────────

function uuidV4(): string {
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join('-');
}

// ── collector ────────────────────────────────────────────────────────────

interface RawDep { name: string; range: string }

function collectDepsFromPkg(pkg: PkgJson): RawDep[] {
    const out: RawDep[] = [];
    const merged = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [name, range] of Object.entries(merged)) {
        if (name && range) out.push({ name, range });
    }
    return out;
}

// ── public builder ───────────────────────────────────────────────────────

export function buildSbom(root: string, generatedAt: string): SbomResult {
    const absRoot = path.resolve(root);

    if (!fs.existsSync(absRoot)) {
        return { ok: false, error: `Root not found: ${absRoot}` };
    }

    const rootPkg = readPkgJson(path.join(absRoot, 'package.json'));
    if (!rootPkg) {
        return { ok: false, error: 'No package.json found at root' };
    }

    const lockMap = loadLockfile(absRoot);

    // Gather all raw deps from root + each workspace package.json.
    const allRaw: RawDep[] = collectDepsFromPkg(rootPkg);

    const workspaceDirs = expandWorkspaceDirs(absRoot, rootPkg);
    for (const dir of workspaceDirs) {
        const subPkg = readPkgJson(path.join(dir, 'package.json'));
        if (subPkg) allRaw.push(...collectDepsFromPkg(subPkg));
    }

    // Resolve versions; deduplicate by name@version.
    const seen = new Set<string>();
    const components: SbomComponent[] = [];

    for (const { name, range } of allRaw) {
        // Lockfile is authoritative; fall back to range extraction.
        const version = lockMap.get(name) ?? cleanRange(range);
        if (!version) continue;

        const ref = bomRef(name, version);
        if (seen.has(ref)) continue;
        seen.add(ref);

        components.push({
            type: 'library',
            'bom-ref': ref,
            name,
            version,
            purl: buildPurl(name, version),
        });
    }

    const appComponent: SbomMetadataComponent = {
        type: 'application',
        name: rootPkg.name ?? path.basename(absRoot),
        ...(rootPkg.version ? { version: rootPkg.version } : {}),
    };

    const bom: CycloneDxBom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: `urn:uuid:${uuidV4()}`,
        version: 1,
        metadata: {
            timestamp: generatedAt,
            tools: [{ vendor: 'Refringence', name: 'Console SBOM', version: '1.0.0' }],
            component: appComponent,
        },
        components,
    };

    return { ok: true, bom, componentCount: components.length };
}
