// console-electron/src/main/generators.ts
//
// Deterministic project-file generators - the "fix" side of the hygiene check.
// Each writes a sensible template only when the file is absent (never clobbers),
// filling names from package.json / git where it can. No AI, no network.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GenResult { ok: boolean; path?: string; error?: string }

function writeIfAbsent(file: string, content: string): GenResult {
    try {
        if (fs.existsSync(file)) return { ok: false, error: `${path.basename(file)} already exists.` };
        fs.writeFileSync(file, content, 'utf8');
        return { ok: true, path: path.basename(file) };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

function readPkg(root: string): Record<string, unknown> {
    try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return {}; }
}

function hasFile(root: string, names: string[]): boolean {
    return names.some((n) => { try { return fs.existsSync(path.join(root, n)); } catch { return false; } });
}

const GITIGNORE_BASE = `# Dependencies
node_modules/

# Build output
dist/
build/
out/
.next/
.nuxt/
.turbo/
.vite/

# Caches + coverage
.cache/
.parcel-cache/
coverage/
*.tsbuildinfo

# Environment (never commit secrets)
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
yarn-error.log*

# Editor + OS
.DS_Store
Thumbs.db
.idea/
`;

const GITIGNORE_PY = `
# Python
__pycache__/
*.py[cod]
.venv/
venv/
.pytest_cache/
.mypy_cache/
*.egg-info/
`;

export function generateGitignore(root: string): GenResult {
    let content = GITIGNORE_BASE;
    if (hasFile(root, ['pyproject.toml', 'requirements.txt', 'setup.py'])) content += GITIGNORE_PY;
    return writeIfAbsent(path.join(root, '.gitignore'), content);
}

function holderName(root: string): string {
    const pkg = readPkg(root);
    if (typeof pkg.author === 'string' && pkg.author) return pkg.author.replace(/<[^>]*>/, '').replace(/\([^)]*\)/, '').trim();
    const author = pkg.author as { name?: unknown } | undefined;
    if (author && typeof author.name === 'string') return author.name;
    return 'the project authors';
}

const MIT = (year: number, holder: string): string => `MIT License

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

export function generateLicense(root: string): GenResult {
    return writeIfAbsent(path.join(root, 'LICENSE'), MIT(new Date().getFullYear(), holderName(root)));
}

export function generateReadme(root: string): GenResult {
    const pkg = readPkg(root);
    const name = typeof pkg.name === 'string' && pkg.name ? pkg.name : path.basename(root);
    const desc = typeof pkg.description === 'string' && pkg.description ? pkg.description : `A short description of what ${name} does.`;
    const content = `# ${name}

${desc}

## Install

\`\`\`bash
npm install
\`\`\`

## Usage

\`\`\`bash
npm run dev
\`\`\`

## License

MIT
`;
    return writeIfAbsent(path.join(root, 'README.md'), content);
}

export function generateFile(root: string, kind: 'gitignore' | 'license' | 'readme'): GenResult {
    if (kind === 'gitignore') return generateGitignore(root);
    if (kind === 'license') return generateLicense(root);
    if (kind === 'readme') return generateReadme(root);
    return { ok: false, error: 'Unknown file kind.' };
}
