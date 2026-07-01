// console-electron/src/main/license-check.ts
//
// Deterministic license scanner. No network. Detects the project's own
// license via LICENSE/LICENSE.md/COPYING file heuristic plus the
// package.json "license" field. Walks top-level node_modules (plus
// scoped @scope/name entries) to read each package's "license" field,
// classifies it, and returns a typed report.
//
// Public surface: checkLicenses(root): LicenseReport.

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Classification types ─────────────────────────────────────────────────

export type LicenseClass =
    | 'permissive'
    | 'weak-copyleft'
    | 'strong-copyleft'
    | 'unknown';

export interface FlaggedDep {
    name: string;
    version: string;
    license: string;
    class: LicenseClass;
}

export interface LicenseReport {
    ok: boolean;
    projectLicense: string | null;
    totalScanned: number;
    truncated: boolean;
    flagged: FlaggedDep[];
    counts: Record<LicenseClass, number>;
    error?: string;
}

// ── Limits ───────────────────────────────────────────────────────────────

const MAX_PACKAGES = 1500;

// ── License text heuristics (same patterns as hygiene.ts detectLicense) ──

function classifyLicenseString(raw: string | undefined): LicenseClass {
    if (!raw) return 'unknown';
    const s = raw.toUpperCase().trim();

    // Strong copyleft first (most restrictive wins in ambiguous expressions)
    if (/\bAGPL\b/.test(s)) return 'strong-copyleft';
    if (/\bGPL-?[0-9]/.test(s) || s === 'GPL') return 'strong-copyleft';
    // GPL without version suffix
    if (/^GNU GENERAL PUBLIC LICENSE/.test(s)) return 'strong-copyleft';

    // Weak copyleft
    if (/\bLGPL\b/.test(s)) return 'weak-copyleft';
    if (/\bMPL\b/.test(s)) return 'weak-copyleft';
    if (/\bEPL\b/.test(s)) return 'weak-copyleft';
    if (/\bCCPL\b/.test(s)) return 'weak-copyleft';
    if (/\bOSL\b/.test(s)) return 'weak-copyleft';
    if (/\bEUPL\b/.test(s)) return 'weak-copyleft';

    // Permissive
    if (/\bMIT\b/.test(s)) return 'permissive';
    if (/\bISC\b/.test(s)) return 'permissive';
    if (/\bBSD\b/.test(s)) return 'permissive';
    if (/\bAPACHE\b/.test(s)) return 'permissive';
    if (/\bCC0\b/.test(s)) return 'permissive';
    if (/\bUNLICENSE/.test(s)) return 'permissive';
    if (/\bWTFPL\b/.test(s)) return 'permissive';
    if (/\bZLIB\b/.test(s)) return 'permissive';
    if (/\bBOOST\b/.test(s)) return 'permissive';
    if (/\b0BSD\b/.test(s)) return 'permissive';
    if (/\bPUBLIC DOMAIN\b/.test(s)) return 'permissive';
    if (/\bPYTHON\b/.test(s)) return 'permissive';
    if (/\bAFL\b/.test(s)) return 'permissive';
    if (/\bARTISTIC\b/.test(s)) return 'permissive';

    return 'unknown';
}

// ── Project license detection ─────────────────────────────────────────────

function detectLicenseFromText(text: string): string | null {
    const t = text.slice(0, 4000);
    if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0';
    if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(t)) return 'GPL-3.0';
    if (/GNU GENERAL PUBLIC LICENSE\s+Version 2/i.test(t)) return 'GPL-2.0';
    if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return 'GPL';
    if (/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i.test(t)) return 'LGPL-3.0';
    if (/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2/i.test(t)) return 'LGPL-2.1';
    if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return 'LGPL';
    if (/Mozilla Public License Version 2\.0/i.test(t)) return 'MPL-2.0';
    if (/Mozilla Public License/i.test(t)) return 'MPL';
    if (/Apache License,?\s+Version 2\.0/i.test(t)) return 'Apache-2.0';
    if (/Apache License/i.test(t)) return 'Apache';
    if (/MIT License/i.test(t) || /Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
    if (/BSD 3-Clause/i.test(t)) return 'BSD-3-Clause';
    if (/BSD 2-Clause/i.test(t)) return 'BSD-2-Clause';
    if (/Redistribution and use in source and binary forms/i.test(t)) return 'BSD';
    if (/ISC License/i.test(t)) return 'ISC';
    if (/Business Source License/i.test(t)) return 'BSL';
    if (/Eclipse Public License/i.test(t)) return 'EPL';
    return null;
}

function detectProjectLicense(root: string): string | null {
    const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING'];
    for (const name of candidates) {
        const p = path.join(root, name);
        try {
            if (fs.existsSync(p)) {
                const text = fs.readFileSync(p, 'utf8');
                const detected = detectLicenseFromText(text);
                if (detected) return detected;
            }
        } catch { /* skip unreadable */ }
    }
    // Fall back to package.json "license" field.
    try {
        const pkgPath = path.join(root, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { license?: string };
            if (typeof pkg.license === 'string' && pkg.license) return pkg.license;
        }
    } catch { /* ignore */ }
    return null;
}

// ── node_modules walker ───────────────────────────────────────────────────

interface PkgMeta { name?: string; version?: string; license?: string | { type?: string } }

function readPkgMeta(pkgDir: string): PkgMeta | null {
    try {
        const p = path.join(pkgDir, 'package.json');
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf8')) as PkgMeta;
    } catch {
        return null;
    }
}

function normalizeLicenseField(raw: string | { type?: string } | undefined): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw.type) return raw.type;
    return '';
}

// Enumerate packages from node_modules at a single depth level.
// Handles scoped packages (@scope/name) by entering one level of scoped dirs.
function enumerateNodeModules(nmDir: string): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(nmDir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (ent.name.startsWith('.')) continue;
        if (ent.name.startsWith('@')) {
            // Scoped: descend one more level.
            const scopeDir = path.join(nmDir, ent.name);
            try {
                const scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
                for (const s of scoped) {
                    if (s.isDirectory()) out.push(path.join(scopeDir, s.name));
                }
            } catch { /* skip */ }
        } else {
            out.push(path.join(nmDir, ent.name));
        }
    }
    return out;
}

// ── Main function ─────────────────────────────────────────────────────────

export function checkLicenses(root: string): LicenseReport {
    const absRoot = path.resolve(root);

    const empty: LicenseReport = {
        ok: false,
        projectLicense: null,
        totalScanned: 0,
        truncated: false,
        flagged: [],
        counts: { permissive: 0, 'weak-copyleft': 0, 'strong-copyleft': 0, unknown: 0 },
    };

    if (!fs.existsSync(absRoot)) {
        return { ...empty, error: `Root not found: ${absRoot}` };
    }

    const projectLicense = detectProjectLicense(absRoot);

    const nmDir = path.join(absRoot, 'node_modules');
    if (!fs.existsSync(nmDir)) {
        return {
            ...empty,
            ok: true,
            projectLicense,
            error: 'node_modules not found - run npm install first',
        };
    }

    const pkgDirs = enumerateNodeModules(nmDir);
    const truncated = pkgDirs.length > MAX_PACKAGES;
    const toScan = truncated ? pkgDirs.slice(0, MAX_PACKAGES) : pkgDirs;

    const counts: Record<LicenseClass, number> = {
        permissive: 0,
        'weak-copyleft': 0,
        'strong-copyleft': 0,
        unknown: 0,
    };
    const flagged: FlaggedDep[] = [];
    let totalScanned = 0;

    for (const dir of toScan) {
        const meta = readPkgMeta(dir);
        if (!meta) continue;
        totalScanned++;

        const licenseRaw = normalizeLicenseField(meta.license);
        const cls = classifyLicenseString(licenseRaw);
        counts[cls]++;

        if (cls === 'weak-copyleft' || cls === 'strong-copyleft' || cls === 'unknown') {
            const name = meta.name ?? path.relative(nmDir, dir).replace(/\\/g, '/');
            flagged.push({
                name,
                version: meta.version ?? '',
                license: licenseRaw || '(none)',
                class: cls,
            });
        }
    }

    return {
        ok: true,
        projectLicense,
        totalScanned,
        truncated,
        flagged,
        counts,
    };
}
