// console-electron/src/main/ipc/deps.ts
//
// Dependency health: read the project's declared dependencies and check them
// against public sources - OSV.dev for known vulnerabilities (one batch call)
// and the npm registry for newer releases (outdated). Read-only: it never
// installs, writes, or runs the project's code. npm ecosystem for now (the
// largest surface for our intended users); other ecosystems are additive.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DepVuln { id: string; }
export interface VulnerableDep { name: string; version: string; vulns: DepVuln[]; }
export interface OutdatedDep { name: string; current: string; latest: string; }
export interface DepScan {
    ecosystem: 'npm';
    total: number;          // declared deps found
    checked: number;        // deps with a concrete version we could query
    vulnerable: VulnerableDep[];
    outdated: OutdatedDep[];
    scannedAt: string;
    error?: string;
}

// ^1.2.3 / ~1.2.3 / >=1.2.3 / 1.2.3 -> 1.2.3 ; skip workspace:/file:/git/* ranges.
function cleanVersion(range: string): string | null {
    if (typeof range !== 'string') return null;
    if (/^(workspace:|file:|link:|git\+|https?:|github:|\*|latest)/.test(range.trim())) return null;
    const m = range.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/);
    return m ? m[1] : null;
}

function readDeps(root: string): { name: string; version: string }[] {
    const out: { name: string; version: string }[] = [];
    try {
        const pkgPath = path.join(path.resolve(root), 'package.json');
        if (!fs.existsSync(pkgPath)) return out;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        for (const [name, range] of Object.entries(all)) {
            const v = cleanVersion(range);
            if (v) out.push({ name, version: v });
        }
    } catch { /* malformed package.json -> empty */ }
    return out;
}

async function queryOsv(deps: { name: string; version: string }[]): Promise<VulnerableDep[]> {
    if (deps.length === 0) return [];
    try {
        const res = await fetch('https://api.osv.dev/v1/querybatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                queries: deps.map((d) => ({ package: { name: d.name, ecosystem: 'npm' }, version: d.version })),
            }),
        });
        if (!res.ok) return [];
        const data = await res.json() as { results?: Array<{ vulns?: Array<{ id?: string }> }> };
        const results = data.results ?? [];
        const out: VulnerableDep[] = [];
        results.forEach((r, i) => {
            const vulns = (r.vulns ?? []).map((v) => ({ id: v.id ?? '' })).filter((v) => v.id);
            if (vulns.length > 0) out.push({ name: deps[i].name, version: deps[i].version, vulns });
        });
        return out;
    } catch { return []; }
}

// Resolve the registry "latest" for a name. Total: any failure yields null.
async function latestVersion(name: string): Promise<string | null> {
    try {
        const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%2F', '/')}/latest`);
        if (!res.ok) return null;
        const data = await res.json() as { version?: string };
        return data.version ?? null;
    } catch { return null; }
}

// Run async tasks with a small concurrency cap so a big project doesn't open
// hundreds of sockets at once.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

async function findOutdated(deps: { name: string; version: string }[]): Promise<OutdatedDep[]> {
    const latest = await mapLimit(deps, 8, async (d) => ({ d, latest: await latestVersion(d.name) }));
    const out: OutdatedDep[] = [];
    for (const { d, latest: l } of latest) {
        if (l && l !== d.version && /^\d/.test(l) && cmpVersions(l, d.version) > 0) {
            out.push({ name: d.name, current: d.version, latest: l });
        }
    }
    return out;
}

// Numeric semver compare (a>b -> 1). Pre-release suffixes are ignored.
function cmpVersions(a: string, b: string): number {
    const pa = a.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
    const pb = b.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
    }
    return 0;
}

export async function scanDeps(root: string): Promise<DepScan> {
    const all = readDeps(root);
    // Cap the registry-latest fan-out; OSV is a single batch regardless.
    const deps = all.slice(0, 200);
    const base: DepScan = {
        ecosystem: 'npm', total: all.length, checked: deps.length,
        vulnerable: [], outdated: [], scannedAt: new Date().toISOString(),
    };
    if (deps.length === 0) return base;
    try {
        const [vulnerable, outdated] = await Promise.all([queryOsv(deps), findOutdated(deps)]);
        return { ...base, vulnerable, outdated };
    } catch (err) {
        return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
}

export function registerDepsHandlers(): void {
    ipcMain.handle('console:deps.scan', async (_evt, projectRoot: string): Promise<DepScan> => {
        try { return await scanDeps(projectRoot); }
        catch (err) {
            return {
                ecosystem: 'npm', total: 0, checked: 0, vulnerable: [], outdated: [],
                scannedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err),
            };
        }
    });
}
