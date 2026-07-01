// console-electron/src/main/ipc/hygiene.ts
//
// Project hygiene: cheap presence checks for the files a healthy repo carries -
// README, LICENSE (with type), .gitignore, a CI pipeline, a lockfile, tests, and
// a .env.example. Read-only filesystem look-ups, no network. Each missing item
// comes with a one-line suggestion the AI/report can act on.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface HygieneItem {
    id: string;
    label: string;
    present: boolean;
    detail?: string;
    suggestion?: string;
}
export interface HygieneReport {
    items: HygieneItem[];
    score: number; // 0-100, fraction of checks satisfied
    scannedAt: string;
}

function existsAny(root: string, names: string[]): string | null {
    for (const n of names) {
        try { if (fs.existsSync(path.join(root, n))) return n; } catch { /* ignore */ }
    }
    return null;
}

function detectLicense(text: string): string | undefined {
    const t = text.slice(0, 4000);
    if (/Apache License,?\s+Version 2\.0/i.test(t)) return 'Apache-2.0';
    if (/MIT License/i.test(t) || /Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
    if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0';
    if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return 'GPL';
    if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return 'LGPL';
    if (/Mozilla Public License Version 2\.0/i.test(t)) return 'MPL-2.0';
    if (/BSD 3-Clause/i.test(t) || /Redistribution and use in source and binary forms/i.test(t)) return 'BSD';
    if (/ISC License/i.test(t)) return 'ISC';
    if (/Business Source License/i.test(t)) return 'BSL';
    return undefined;
}

function detectCi(root: string): string | null {
    try {
        const wf = path.join(root, '.github', 'workflows');
        if (fs.existsSync(wf) && fs.statSync(wf).isDirectory() && fs.readdirSync(wf).some((f) => /\.ya?ml$/.test(f))) {
            return 'GitHub Actions';
        }
    } catch { /* ignore */ }
    const found = existsAny(root, ['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile', '.travis.yml', 'bitbucket-pipelines.yml']);
    if (found) {
        if (found.includes('gitlab')) return 'GitLab CI';
        if (found.includes('circle')) return 'CircleCI';
        if (found.includes('azure')) return 'Azure Pipelines';
        if (found === 'Jenkinsfile') return 'Jenkins';
        if (found.includes('travis')) return 'Travis CI';
        if (found.includes('bitbucket')) return 'Bitbucket Pipelines';
    }
    return null;
}

function detectTests(root: string): boolean {
    if (existsAny(root, ['tests', 'test', '__tests__', 'spec'])) {
        for (const d of ['tests', 'test', '__tests__', 'spec']) {
            try {
                const full = path.join(root, d);
                if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return true;
            } catch { /* ignore */ }
        }
    }
    try {
        const pkgPath = path.join(root, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
            const test = pkg.scripts?.test ?? '';
            if (test && !/no test specified/i.test(test)) return true;
            const dd = pkg.devDependencies ?? {};
            if (dd.vitest || dd.jest || dd.mocha || dd['@playwright/test'] || dd.ava || dd.jasmine) return true;
        }
    } catch { /* ignore */ }
    return false;
}

export function scanHygiene(root: string): HygieneReport {
    const base = path.resolve(root);
    const items: HygieneItem[] = [];

    const readme = existsAny(base, ['README.md', 'README', 'README.rst', 'readme.md', 'Readme.md']);
    items.push({ id: 'readme', label: 'README', present: !!readme, detail: readme ?? undefined, suggestion: readme ? undefined : 'Add a README so a newcomer knows what this is and how to run it.' });

    const license = existsAny(base, ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING']);
    let licType: string | undefined;
    if (license) { try { licType = detectLicense(fs.readFileSync(path.join(base, license), 'utf8')); } catch { /* ignore */ } }
    items.push({ id: 'license', label: 'License', present: !!license, detail: licType ?? (license ? 'present' : undefined), suggestion: license ? undefined : 'Add a LICENSE - without one, others legally cannot use your code.' });

    items.push({ id: 'gitignore', label: '.gitignore', present: !!existsAny(base, ['.gitignore']), suggestion: existsAny(base, ['.gitignore']) ? undefined : 'Add a .gitignore so build output and secrets do not get committed.' });

    const ci = detectCi(base);
    items.push({ id: 'ci', label: 'CI pipeline', present: !!ci, detail: ci ?? undefined, suggestion: ci ? undefined : 'No CI detected. A workflow that runs your tests on every push catches breakage before it ships.' });

    const lock = existsAny(base, ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock']);
    items.push({ id: 'lockfile', label: 'Lockfile', present: !!lock, detail: lock ?? undefined, suggestion: lock ? undefined : 'No lockfile - installs are not reproducible. Commit your lockfile.' });

    const tests = detectTests(base);
    items.push({ id: 'tests', label: 'Tests', present: tests, suggestion: tests ? undefined : 'No tests detected. Even a few covering the critical paths pay for themselves.' });

    const envExample = existsAny(base, ['.env.example', '.env.sample', '.env.template']);
    const envExists = existsAny(base, ['.env']);
    items.push({ id: 'env-example', label: '.env.example', present: !!envExample, suggestion: envExample || !envExists ? undefined : 'You have a .env but no .env.example - add one listing the required var NAMES so others know what to set.' });

    const present = items.filter((i) => i.present).length;
    return { items, score: Math.round((present / items.length) * 100), scannedAt: new Date().toISOString() };
}

export function registerHygieneHandlers(): void {
    ipcMain.handle('console:hygiene.scan', (_evt, projectRoot: string): HygieneReport => {
        try { return scanHygiene(projectRoot); }
        catch { return { items: [], score: 0, scannedAt: new Date().toISOString() }; }
    });
}
