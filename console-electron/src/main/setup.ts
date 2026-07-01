// console-electron/src/main/setup.ts
//
// Keyless, deterministic project-readiness scaffolding. The AI tool can already
// generate these via a conversation; this is the one-click, no-key path for the
// common boilerplate a project needs before it ships. Reuses buildConfig for the
// Docker / CI configs and ships small templates for LICENSE / .gitignore / env.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildConfig } from './ai/config-gen';
import type { ConfigKind } from './config-templates';

export interface SetupItem { id: string; label: string; path: string; present: boolean; detail: string }
export interface SetupScaffoldResult { ok: boolean; path?: string; error?: string }

const CONFIG_ITEMS: { id: string; label: string; kind: ConfigKind; path: string; detail: string }[] = [
    { id: 'dockerfile', label: 'Dockerfile', kind: 'Dockerfile', path: 'Dockerfile', detail: 'Containerize the app so any host can run it.' },
    { id: 'compose', label: 'docker-compose.yaml', kind: 'docker-compose.yaml', path: 'docker-compose.yaml', detail: 'Run the app and its services together locally.' },
    { id: 'ci', label: 'GitHub Actions CI', kind: 'github-actions-ci.yml', path: '.github/workflows/ci.yml', detail: 'Build and test on every push.' },
];

const GITIGNORE_NODE = [
    'node_modules/', 'dist/', 'build/', '.next/', 'out/', 'coverage/',
    '*.log', '.DS_Store', '.cache/', '.turbo/', '.vercel/',
    '', '# Secrets', '.env', '.env.*', '!.env.example', '',
].join('\n') + '\n';

function existsAny(root: string, ...rels: string[]): boolean {
    return rels.some((r) => fs.existsSync(path.join(root, r)));
}

function holderFor(root: string): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { author?: unknown; name?: unknown };
        if (typeof pkg.author === 'string' && pkg.author.trim()) return pkg.author.trim();
        if (pkg.author && typeof pkg.author === 'object' && typeof (pkg.author as { name?: unknown }).name === 'string') return String((pkg.author as { name: string }).name);
        if (typeof pkg.name === 'string' && pkg.name.trim()) return `The ${pkg.name.trim()} authors`;
    } catch { /* no package.json */ }
    return 'The authors';
}

function mitLicense(year: string, holder: string): string {
    return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

// Mirror the real .env keys (names only, no values) so the example documents
// what is needed without leaking secrets. Falls back to a short template.
function buildEnvExample(root: string): string {
    const keys = new Set<string>();
    for (const name of ['.env', '.env.local', '.env.development']) {
        try {
            const raw = fs.readFileSync(path.join(root, name), 'utf8');
            for (const line of raw.split('\n')) {
                const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
                if (m) keys.add(m[1]);
            }
        } catch { /* file absent */ }
    }
    if (keys.size === 0) return '# Environment variables this project needs.\n# Copy to .env and fill in the values.\n\n# EXAMPLE_API_KEY=\n';
    return '# Copy to .env and fill in the values. Never commit the real .env.\n\n' + [...keys].sort().map((k) => `${k}=`).join('\n') + '\n';
}

export function detectSetup(root: string): SetupItem[] {
    if (typeof root !== 'string' || root.length === 0) return [];
    const items: SetupItem[] = [
        { id: 'license', label: 'LICENSE (MIT)', path: 'LICENSE', present: existsAny(root, 'LICENSE', 'LICENSE.md', 'LICENSE.txt'), detail: 'State the terms so others can use the code.' },
        { id: 'gitignore', label: '.gitignore', path: '.gitignore', present: existsAny(root, '.gitignore'), detail: 'Keep build output and secrets out of git.' },
        { id: 'env-example', label: '.env.example', path: '.env.example', present: existsAny(root, '.env.example'), detail: 'Document required env vars without leaking values.' },
    ];
    for (const c of CONFIG_ITEMS) items.push({ id: c.id, label: c.label, path: c.path, present: existsAny(root, c.path), detail: c.detail });
    return items;
}

export function scaffoldSetup(root: string, id: string): SetupScaffoldResult {
    if (typeof root !== 'string' || root.length === 0) return { ok: false, error: 'No project is open.' };
    try {
        const cfg = CONFIG_ITEMS.find((c) => c.id === id);
        if (cfg) {
            const built = buildConfig(root, cfg.kind);
            const dest = path.join(root, built.destPath);
            if (fs.existsSync(dest)) return { ok: false, error: `${built.destPath} already exists.` };
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, built.content, 'utf8');
            return { ok: true, path: built.destPath };
        }
        const simple: Record<string, { rel: string; content: () => string }> = {
            license: { rel: 'LICENSE', content: () => mitLicense(String(new Date().getFullYear()), holderFor(root)) },
            gitignore: { rel: '.gitignore', content: () => GITIGNORE_NODE },
            'env-example': { rel: '.env.example', content: () => buildEnvExample(root) },
        };
        const s = simple[id];
        if (!s) return { ok: false, error: 'Unknown setup item.' };
        const dest = path.join(root, s.rel);
        if (fs.existsSync(dest)) return { ok: false, error: `${s.rel} already exists.` };
        fs.writeFileSync(dest, s.content(), 'utf8');
        return { ok: true, path: s.rel };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
