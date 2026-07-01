// console-electron/src/main/design-profile-store.ts
//
// Cross-project design profiles: a normalised snapshot of a DesignSystem saved
// to the Console userData dir (NOT per-project), so palettes / scales / library
// choices can be reused and compared across projects. Plain JSON, one file per
// profile (electron-store is avoided here - it crashed on an ESM mismatch in
// connections.ts). Stores only tokens + labels; never file contents or paths.
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DesignSystem, TypeStep } from './design-system';

export interface DesignProfile {
    id: string;
    label: string;
    projectName: string;
    createdAt: string;
    updatedAt: string;
    summary: {
        libraries: string[];
        tailwindVersion?: string;
        shadcnStyle?: string;
        shadcnBaseColor?: string;
        fontSans?: string;
        colorCount: number;
        typeStepCount: number;
    };
    palette: { name: string; value: string }[];
    typeScale: TypeStep[];
    spacing: string[];
    radii: { name: string; value: string }[];
    fonts: { name: string; value: string }[];
    libraries: string[];
}

export interface ProfileDiff {
    colors: { name: string; a?: string; b?: string; status: 'same' | 'changed' | 'onlyA' | 'onlyB' }[];
    typeScale: { name: string; status: 'same' | 'changed' | 'onlyA' | 'onlyB' }[];
    fonts: { name: string; a?: string; b?: string; status: 'same' | 'changed' | 'onlyA' | 'onlyB' }[];
    libraries: { added: string[]; removed: string[] };
}

function dir(): string {
    return path.join(app.getPath('userData'), 'design-profiles');
}

function slug(s: string): string {
    return (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'profile';
}

// Derive a portable profile from a freshly-scanned DesignSystem.
export function toProfile(ds: DesignSystem, projectName: string, label?: string): Omit<DesignProfile, 'id' | 'createdAt' | 'updatedAt'> {
    const lightColors = ds.tokens.colors.filter((c) => c.theme !== 'dark');
    const fontSans = ds.tokens.fonts.find((f) => /sans/i.test(f.name))?.value ?? ds.tokens.fonts[0]?.value;
    return {
        label: label || projectName,
        projectName,
        summary: {
            libraries: ds.libraries,
            tailwindVersion: ds.tailwind?.version,
            shadcnStyle: ds.shadcn?.style,
            shadcnBaseColor: ds.shadcn?.baseColor,
            fontSans,
            colorCount: lightColors.length,
            typeStepCount: ds.tokens.typeScale.length,
        },
        palette: lightColors.map((c) => ({ name: c.name, value: c.value })),
        typeScale: ds.tokens.typeScale,
        spacing: ds.tokens.spacing.map((s) => s.value),
        radii: ds.tokens.radii.map((r) => ({ name: r.name, value: r.value })),
        fonts: ds.tokens.fonts.map((f) => ({ name: f.name, value: f.value })),
        libraries: ds.libraries,
    };
}

export function saveProfile(input: Omit<DesignProfile, 'id' | 'createdAt' | 'updatedAt'>): DesignProfile | null {
    const now = new Date().toISOString();
    const profile: DesignProfile = { id: slug(input.label), createdAt: now, updatedAt: now, ...input };
    try {
        fs.mkdirSync(dir(), { recursive: true });
        // If a profile with this id exists, preserve its createdAt.
        const existing = readProfile(profile.id);
        if (existing) profile.createdAt = existing.createdAt;
        fs.writeFileSync(path.join(dir(), `${profile.id}.json`), JSON.stringify(profile, null, 2), 'utf8');
        return profile;
    } catch {
        return null;
    }
}

function readProfile(id: string): DesignProfile | null {
    try {
        const p = JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf8')) as DesignProfile;
        return p && typeof p === 'object' && typeof p.id === 'string' ? p : null;
    } catch {
        return null;
    }
}

export function listProfiles(): DesignProfile[] {
    try {
        return fs.readdirSync(dir())
            .filter((f) => f.endsWith('.json'))
            .map((f) => readProfile(f.replace(/\.json$/, '')))
            .filter((p): p is DesignProfile => p !== null)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
        return [];
    }
}

export function deleteProfile(id: string): boolean {
    try {
        fs.rmSync(path.join(dir(), `${slug(id)}.json`));
        return true;
    } catch {
        return false;
    }
}

export function compareProfiles(aId: string, bId: string): ProfileDiff | null {
    const a = readProfile(aId);
    const b = readProfile(bId);
    if (!a || !b) return null;
    const diffMaps = (an: { name: string; value: string }[], bn: { name: string; value: string }[]) => {
        const am = new Map(an.map((x) => [x.name, x.value]));
        const bm = new Map(bn.map((x) => [x.name, x.value]));
        const names = [...new Set([...am.keys(), ...bm.keys()])].sort();
        return names.map((name) => {
            const av = am.get(name); const bv = bm.get(name);
            const status = av == null ? 'onlyB' : bv == null ? 'onlyA' : av === bv ? 'same' : 'changed';
            return { name, a: av, b: bv, status: status as 'same' | 'changed' | 'onlyA' | 'onlyB' };
        });
    };
    const aTypes = new Map(a.typeScale.map((t) => [t.name, JSON.stringify(t)]));
    const bTypes = new Map(b.typeScale.map((t) => [t.name, JSON.stringify(t)]));
    const typeNames = [...new Set([...aTypes.keys(), ...bTypes.keys()])].sort();
    const aLib = new Set(a.libraries); const bLib = new Set(b.libraries);
    return {
        colors: diffMaps(a.palette, b.palette),
        fonts: diffMaps(a.fonts, b.fonts),
        typeScale: typeNames.map((name) => {
            const av = aTypes.get(name); const bv = bTypes.get(name);
            const status = av == null ? 'onlyB' : bv == null ? 'onlyA' : av === bv ? 'same' : 'changed';
            return { name, status: status as 'same' | 'changed' | 'onlyA' | 'onlyB' };
        }),
        libraries: {
            added: [...bLib].filter((l) => !aLib.has(l)),
            removed: [...aLib].filter((l) => !bLib.has(l)),
        },
    };
}
