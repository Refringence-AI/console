// console-electron/src/main/intel/profiler.ts
//
// Layer 1 of the Project Intelligence Engine: the DETERMINISTIC profiler. No
// AI. It runs ONE full walk of the tree (languages, LOC, bytes, file
// inventory, special-file flags, deps, env key NAMES, MCP servers) and composes
// the existing introspection builders (shape, summary, capabilities, hot files)
// + the cached dependency graph + service detection + a health rollup into a
// single ProjectProfile. ~85% of "understanding a project" lives here; only the
// narrative + semantic diagram + suggestions need AI (Layer 2).
//
// Everything is tolerant of missing files / non-git dirs / malformed JSON: a
// failed sub-step degrades to an empty/honest value rather than throwing.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as YAML from 'yaml';

import {
    buildShape, buildSummary, buildCapabilities, buildHotFiles,
} from '../ipc/repo-introspect';
import { getGraph, cacheSignature, pkgForRelPath } from '../ipc/architecture-graph';
import type { DependencyGraph } from '../ipc/architecture-graph';
import { detectServices } from './serviceCatalog';
import type {
    ProjectProfile, LanguageStat, StackInfo, ReadmeInfo, AiTooling,
    CicdInfo, InventoryInfo, GitInfo, HealthSummary, HealthSignal, HealthSeverity,
    PackageInfo, PackageKind, DetectedService, Contributor, CodeRatios,
    ProjectDetail, RunCommand, DataLayer, TestingInfo,
    Hotspot, ReadingStep, ContainerInfo, WorkflowDetail, EnvGroup, ReleaseInfo,
} from './types';

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.refringence-qa',
    '.refringence-console', '__pycache__', '.pio', '.cache', '.venv',
    'tools-src', 'vcpkg', 'src-qt', 'out', '.next', '.parcel-cache', 'target',
    'vendor', '.turbo', '.svelte-kit', 'coverage', '.nuxt', '.output',
]);

// Extensions that count as CODE: each maps to its language and contributes LOC
// + the language histogram. Config (json/yaml/toml) and docs (md) are tracked
// separately so they don't drown out "what this is written in".
const CODE_LANG: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.py': 'Python', '.pyi': 'Python',
    '.rs': 'Rust', '.go': 'Go',
    '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hh': 'C++',
    '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift',
    '.scala': 'Scala', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir',
    '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.ps1': 'PowerShell',
    '.lua': 'Lua', '.jl': 'Julia', '.r': 'R',
    '.vue': 'Vue', '.svelte': 'Svelte',
    '.html': 'HTML', '.htm': 'HTML',
    '.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS',
    '.sql': 'SQL', '.sol': 'Solidity', '.wgsl': 'Shader', '.glsl': 'Shader',
};

const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.xml', '.env']);
const MAX_FILES = 40000;
const MAX_DEPTH = 24;
const MAX_LOC_BYTES = 1_500_000;

interface TreeScan {
    langStats: Map<string, { files: number; loc: number; bytes: number }>;
    fileCount: number;
    totalBytes: number;
    totalLoc: number;
    docsCount: number;
    docsLoc: number;
    sourceLoc: number;
    testLoc: number;
    configFiles: number;
    todoCount: number;
    /** basenames present anywhere shallow (root + one level) for config detection. */
    rootFiles: Set<string>;
    /** repo-relative file paths seen (capped) for schema/config-file detection. */
    relFiles: Set<string>;
    truncated: boolean;
}

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|e2e|spec|specs)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/i;

// One pass over the tree. Dotfiles are skipped EXCEPT a small allow-list we need
// for detection (.github, .env*, .mcp.json, .gitignore, .cursor). Lockfiles are
// counted as files but never as a language.
function scanProject(root: string): TreeScan {
    const langStats = new Map<string, { files: number; loc: number; bytes: number }>();
    let fileCount = 0, totalBytes = 0, totalLoc = 0, docsCount = 0, docsLoc = 0;
    let sourceLoc = 0, testLoc = 0, configFiles = 0, todoCount = 0;
    const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;
    const rootFiles = new Set<string>();
    const relFiles = new Set<string>();
    let truncated = false;

    const DOT_ALLOW = new Set(['.github', '.gitignore', '.cursor', '.mcp.json', '.npmrc']);
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length > 0) {
        if (fileCount >= MAX_FILES) { truncated = true; break; }
        const { dir, depth } = stack.pop()!;
        if (depth > MAX_DEPTH) { truncated = true; continue; }
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const ent of entries) {
            if (SKIP_DIRS.has(ent.name)) continue;
            const isDotEnv = ent.name === '.env' || ent.name.startsWith('.env.');
            if (ent.name.startsWith('.') && !DOT_ALLOW.has(ent.name) && !isDotEnv) continue;
            const abs = path.join(dir, ent.name);
            if (depth <= 1) rootFiles.add(ent.name);
            if (ent.isDirectory()) {
                stack.push({ dir: abs, depth: depth + 1 });
                continue;
            }
            if (!ent.isFile()) continue;
            fileCount += 1;
            const rel = path.relative(root, abs).replace(/\\/g, '/');
            if (relFiles.size < 12000) relFiles.add(rel);
            let size = 0;
            try { size = fs.statSync(abs).size; } catch { /* keep 0 */ }
            totalBytes += size;
            const ext = path.extname(ent.name).toLowerCase();
            const lower = ent.name.toLowerCase();
            if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.rst')) {
                docsCount += 1;
                if (size <= MAX_LOC_BYTES) {
                    try { docsLoc += fs.readFileSync(abs, 'utf8').split('\n').length; } catch { /* keep */ }
                }
                continue;
            }
            if (CONFIG_EXTS.has(ext)) { configFiles += 1; continue; }
            const lang = CODE_LANG[ext];
            if (!lang) continue;
            let loc = 0;
            if (size <= MAX_LOC_BYTES) {
                try {
                    const body = fs.readFileSync(abs, 'utf8');
                    loc = body.split('\n').length;
                    const tm = body.match(TODO_RE);
                    if (tm) todoCount += tm.length;
                } catch { /* keep 0 */ }
            }
            totalLoc += loc;
            if (TEST_PATH_RE.test(rel)) testLoc += loc; else sourceLoc += loc;
            const cur = langStats.get(lang) ?? { files: 0, loc: 0, bytes: 0 };
            cur.files += 1; cur.loc += loc; cur.bytes += size;
            langStats.set(lang, cur);
        }
    }
    return {
        langStats, fileCount, totalBytes, totalLoc, docsCount, docsLoc,
        sourceLoc, testLoc, configFiles, todoCount, rootFiles, relFiles, truncated,
    };
}

function readJson(file: string): Record<string, unknown> | null {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

function readText(file: string, limit?: number): string {
    try {
        const body = fs.readFileSync(file, 'utf8');
        return typeof limit === 'number' ? body.slice(0, limit) : body;
    } catch { return ''; }
}

function addPkgDeps(out: Set<string>, pkg: Record<string, unknown> | null): void {
    if (!pkg) return;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const block = pkg[field];
        if (block && typeof block === 'object') {
            for (const name of Object.keys(block as Record<string, unknown>)) out.add(name);
        }
    }
}

// Find package.json files across the tree (bounded) so a monorepo's frameworks
// (react/vite in a sub-package) are detected, not just the root manifest's deps.
function findPackageJsons(root: string, cap: number): string[] {
    const found: string[] = [];
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length > 0 && found.length < cap) {
        const { dir, depth } = stack.pop()!;
        if (depth > 6) continue;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const ent of entries) {
            if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
            if (ent.isDirectory()) stack.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
            else if (ent.name === 'package.json') found.push(path.join(dir, ent.name));
        }
    }
    return found;
}

// Collect dependency NAMES from every package.json across the tree (monorepo-
// aware) + pyproject + cargo so the stack + service detection match real usage.
// Names only, never versions or values.
function collectDeps(root: string): string[] {
    const out = new Set<string>();
    for (const pj of findPackageJsons(root, 60)) addPkgDeps(out, readJson(pj));
    const py = readText(path.join(root, 'requirements.txt'));
    for (const line of py.split('\n')) {
        const name = line.trim().split(/[<>=!~ #[]/)[0].trim();
        if (name && !name.startsWith('-') && !name.startsWith('#')) out.add(name);
    }
    const pyproj = readText(path.join(root, 'pyproject.toml'), 8000);
    for (const m of pyproj.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*[>=<~]/gm)) out.add(m[1]);
    const cargo = readText(path.join(root, 'Cargo.toml'), 8000);
    const depBlock = cargo.match(/\[dependencies\]([\s\S]*?)(\n\[|$)/);
    if (depBlock) {
        for (const m of depBlock[1].matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)) out.add(m[1]);
    }
    return Array.from(out);
}

function cleanVersion(range: string): string {
    const s = String(range);
    const m = s.match(/(\d+\.\d+\.\d+|\d+\.\d+|\d+)/);
    return m ? m[1] : s.replace(/^[\^~>=<\s]+/, '').trim();
}

// Resolve dependency NAME -> version. Declared ranges from every package.json,
// overridden by the installed versions in the root lockfile when present.
function collectDepVersions(root: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const pj of findPackageJsons(root, 60)) {
        const pkg = readJson(pj);
        if (!pkg) continue;
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            const block = pkg[field];
            if (block && typeof block === 'object') {
                for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
                    const k = name.toLowerCase();
                    if (!out.has(k) && typeof range === 'string') out.set(k, cleanVersion(range));
                }
            }
        }
    }
    const lock = readJson(path.join(root, 'package-lock.json'));
    const pkgs = lock?.packages;
    if (pkgs && typeof pkgs === 'object') {
        for (const [p, meta] of Object.entries(pkgs as Record<string, { version?: string }>)) {
            const m = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
            if (m && meta && typeof meta.version === 'string') out.set(m[1].toLowerCase(), meta.version);
        }
    }
    return out;
}

// Curated frameworks worth a version chip, with the display name. Matched
// case-insensitively against the resolved version map.
const NOTABLE_FRAMEWORKS: { dep: string; name: string }[] = [
    { dep: 'react', name: 'React' }, { dep: 'next', name: 'Next.js' },
    { dep: 'vue', name: 'Vue' }, { dep: 'nuxt', name: 'Nuxt' },
    { dep: 'svelte', name: 'Svelte' }, { dep: '@angular/core', name: 'Angular' },
    { dep: 'solid-js', name: 'SolidJS' }, { dep: 'astro', name: 'Astro' },
    { dep: 'react-native', name: 'React Native' }, { dep: 'expo', name: 'Expo' },
    { dep: 'electron', name: 'Electron' }, { dep: '@tauri-apps/api', name: 'Tauri' },
    { dep: 'typescript', name: 'TypeScript' }, { dep: 'vite', name: 'Vite' },
    { dep: 'webpack', name: 'Webpack' }, { dep: 'turbo', name: 'Turborepo' },
    { dep: 'tailwindcss', name: 'Tailwind' }, { dep: 'express', name: 'Express' },
    { dep: '@nestjs/core', name: 'NestJS' }, { dep: 'fastify', name: 'Fastify' },
    { dep: 'hono', name: 'Hono' }, { dep: 'django', name: 'Django' },
    { dep: 'flask', name: 'Flask' }, { dep: 'fastapi', name: 'FastAPI' },
];

function deriveNotableFrameworks(versions: Map<string, string>): { name: string; version: string }[] {
    const out: { name: string; version: string }[] = [];
    for (const fw of NOTABLE_FRAMEWORKS) {
        const v = versions.get(fw.dep.toLowerCase());
        if (v) out.push({ name: fw.name, version: v });
    }
    return out;
}

// MCP server names from .mcp.json (Claude) or .cursor/mcp.json. The strongest
// "this project really uses service X" signal.
function collectMcpServers(root: string): string[] {
    const out = new Set<string>();
    for (const rel of ['.mcp.json', path.join('.cursor', 'mcp.json'), path.join('.vscode', 'mcp.json')]) {
        const cfg = readJson(path.join(root, rel));
        const servers = cfg?.mcpServers ?? cfg?.servers;
        if (servers && typeof servers === 'object') {
            for (const name of Object.keys(servers as Record<string, unknown>)) out.add(name);
        }
    }
    return Array.from(out);
}

// Env key NAMES only, never values. Reads the common .env file variants.
function collectEnvNames(root: string): string[] {
    const out = new Set<string>();
    const files = ['.env', '.env.local', '.env.development', '.env.production', '.env.example', '.env.sample'];
    for (const file of files) {
        const body = readText(path.join(root, file));
        if (!body) continue;
        for (const rawLine of body.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const noExport = line.startsWith('export ') ? line.slice(7).trim() : line;
            const eq = noExport.indexOf('=');
            const name = (eq > 0 ? noExport.slice(0, eq) : noExport).trim();
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) out.add(name);
        }
    }
    return Array.from(out);
}

interface DepMatch { id: string; deps: RegExp[]; }

function anyDep(deps: string[], patterns: RegExp[]): boolean {
    return deps.some((d) => patterns.some((p) => p.test(d)));
}

function deriveStack(root: string, scan: TreeScan, deps: string[], versions: Map<string, string>): StackInfo {
    const totalLoc = Math.max(1, scan.totalLoc);
    const languages: LanguageStat[] = Array.from(scan.langStats.entries())
        .map(([language, s]) => ({ language, files: s.files, loc: s.loc, bytes: s.bytes, share: s.loc / totalLoc }))
        .sort((a, b) => b.loc - a.loc);
    const primaryLanguage = languages[0]?.language ?? 'Unknown';

    const lc = deps.map((d) => d.toLowerCase());
    const has = (...names: string[]) => names.some((n) => lc.includes(n));
    const hasPat = (...pats: RegExp[]) => anyDep(lc, pats);

    const frontend: string[] = [];
    if (hasPat(/^next$/)) frontend.push('Next.js');
    if (hasPat(/^react$/) && !hasPat(/^next$/)) frontend.push('React');
    if (hasPat(/^vue$/, /^nuxt$/)) frontend.push(has('nuxt') ? 'Nuxt' : 'Vue');
    if (hasPat(/^svelte$/, /^@sveltejs\/kit$/)) frontend.push(has('@sveltejs/kit') ? 'SvelteKit' : 'Svelte');
    if (hasPat(/^@angular\/core$/)) frontend.push('Angular');
    if (hasPat(/^solid-js$/)) frontend.push('SolidJS');
    if (hasPat(/^astro$/)) frontend.push('Astro');
    if (hasPat(/^@remix-run\//)) frontend.push('Remix');
    if (hasPat(/^react-native$/, /^expo$/)) frontend.push('React Native');
    if (hasPat(/^tailwindcss$/)) frontend.push('Tailwind');

    const backend: string[] = [];
    if (hasPat(/^express$/)) backend.push('Express');
    if (hasPat(/^fastify$/)) backend.push('Fastify');
    if (hasPat(/^@nestjs\/core$/)) backend.push('NestJS');
    if (hasPat(/^koa$/)) backend.push('Koa');
    if (hasPat(/^hono$/)) backend.push('Hono');
    if (hasPat(/^flask$/)) backend.push('Flask');
    if (hasPat(/^django$/)) backend.push('Django');
    if (hasPat(/^fastapi$/)) backend.push('FastAPI');
    if (hasPat(/^rails$/, /^railties$/)) backend.push('Rails');
    if (hasPat(/^gin-gonic\/gin$/)) backend.push('Gin');
    if (hasPat(/^axum$/, /^actix-web$/)) backend.push(has('axum') ? 'Axum' : 'Actix');

    // A language is a "runtime" of the project when its manifest is present OR
    // it makes up a real share of the code (>=8% of LOC), so a polyglot monorepo
    // reports every runtime it actually carries, not just the root manifest's.
    const runtimes: string[] = [];
    const langShare = (l: string) => scan.langStats.get(l)?.loc ?? 0;
    const sharePct = (l: string) => langShare(l) / Math.max(1, scan.totalLoc);
    if (scan.rootFiles.has('package.json') || sharePct('TypeScript') + sharePct('JavaScript') >= 0.08) runtimes.push('Node.js');
    if (scan.rootFiles.has('deno.json') || scan.rootFiles.has('deno.jsonc')) runtimes.push('Deno');
    if (scan.rootFiles.has('bun.lockb')) runtimes.push('Bun');
    if (scan.rootFiles.has('pyproject.toml') || scan.rootFiles.has('requirements.txt') || scan.rootFiles.has('setup.py') || sharePct('Python') >= 0.08) runtimes.push('Python');
    if (scan.rootFiles.has('go.mod') || sharePct('Go') >= 0.08) runtimes.push('Go');
    if (scan.rootFiles.has('Cargo.toml') || sharePct('Rust') >= 0.08) runtimes.push('Rust');

    const buildTools: string[] = [];
    if (hasPat(/^vite$/)) buildTools.push('Vite');
    if (hasPat(/^webpack$/)) buildTools.push('Webpack');
    if (hasPat(/^rollup$/)) buildTools.push('Rollup');
    if (hasPat(/^esbuild$/)) buildTools.push('esbuild');
    if (hasPat(/^turbo$/) || scan.rootFiles.has('turbo.json')) buildTools.push('Turborepo');
    if (hasPat(/^nx$/) || scan.rootFiles.has('nx.json')) buildTools.push('Nx');
    if (scan.rootFiles.has('Cargo.toml')) buildTools.push('Cargo');
    if (scan.rootFiles.has('Makefile')) buildTools.push('Make');
    if (hasPat(/^electron-builder$/) || scan.rootFiles.has('electron-builder.yml')) buildTools.push('electron-builder');

    // Electron / Tauri are desktop runtimes worth surfacing alongside Node.
    if (has('electron')) runtimes.push('Electron');
    if (hasPat(/^@tauri-apps\//)) runtimes.push('Tauri');

    let packageManager: string | null = null;
    if (scan.rootFiles.has('pnpm-lock.yaml')) packageManager = 'pnpm';
    else if (scan.rootFiles.has('yarn.lock')) packageManager = 'yarn';
    else if (scan.rootFiles.has('bun.lockb')) packageManager = 'bun';
    else if (scan.rootFiles.has('package-lock.json')) packageManager = 'npm';
    else if (scan.rootFiles.has('poetry.lock')) packageManager = 'poetry';
    else if (scan.rootFiles.has('Cargo.lock')) packageManager = 'cargo';
    else if (scan.rootFiles.has('go.sum')) packageManager = 'go modules';

    return {
        primaryLanguage, languages, frontend: Array.from(new Set(frontend)),
        backend: Array.from(new Set(backend)), runtimes: Array.from(new Set(runtimes)),
        buildTools: Array.from(new Set(buildTools)), packageManager,
        notableFrameworks: deriveNotableFrameworks(versions),
    };
}

function parseReadme(root: string): ReadmeInfo {
    const body = readText(path.join(root, 'README.md')) || readText(path.join(root, 'readme.md'));
    if (!body) {
        return { present: false, title: '', description: '', sections: [], wordCount: 0 };
    }
    const lines = body.split('\n');
    // Title: prefer an ATX `# ` or Setext heading, OR an HTML <h1>. Skip lines
    // inside code fences (a bash comment `# build` is not the title).
    let title = '';
    {
        let inFence = false;
        for (let i = 0; i < lines.length; i += 1) {
            const raw = lines[i];
            if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
            if (inFence) continue;
            const html = raw.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i);
            if (html) { title = html[1].replace(/[*_`]/g, '').trim(); break; }
            const atx = raw.match(/^#\s+(.+)/);
            if (atx) { title = atx[1].replace(/[*_`]/g, '').trim(); break; }
            const next = lines[i + 1] ?? '';
            if (raw.trim() && /^=+\s*$/.test(next)) { title = raw.replace(/[*_`]/g, '').trim(); break; }
        }
    }
    const sections: string[] = [];
    {
        let inFence = false;
        for (const l of lines) {
            if (/^\s*```/.test(l)) { inFence = !inFence; continue; }
            if (inFence) continue;
            const m = l.match(/^#{2,3}\s+(.+)/);
            if (m) sections.push(m[1].replace(/[*_`]/g, '').trim());
        }
    }
    // Description: the first substantial prose PARAGRAPH (not a heading/badge/
    // HTML/table/fence/rule), joined and taken to a sentence boundary so it does
    // not clip mid-sentence.
    let description = '';
    {
        let inFence = false;
        const para: string[] = [];
        for (const l of lines) {
            if (/^\s*```/.test(l)) { inFence = !inFence; if (para.length) break; continue; }
            if (inFence) continue;
            const t = l.trim();
            const skip = !t || t.startsWith('#') || t.startsWith('![') || t.startsWith('<')
                || t.startsWith('[!') || t.startsWith('|') || t.startsWith('>') || /^[-=*_~]{2,}$/.test(t);
            if (skip) { if (para.length) break; continue; }
            para.push(t.replace(/[*_`]/g, '').trim());
            if (para.join(' ').length > 240) break;
        }
        const joined = para.join(' ').trim();
        if (joined.length >= 3) {
            // Cut at the last sentence end within ~300 chars, else hard cap.
            const capped = joined.slice(0, 300);
            const lastDot = capped.lastIndexOf('. ');
            description = (lastDot > 60 ? capped.slice(0, lastDot + 1) : capped).trim();
        }
    }
    return {
        present: true, title, description, sections: sections.slice(0, 20),
        wordCount: body.split(/\s+/).filter(Boolean).length,
    };
}

function deriveAiTooling(root: string, deps: string[], mcpServers: string[]): AiTooling {
    const lc = deps.map((d) => d.toLowerCase());
    const aiSdks = lc.filter((d) =>
        /^@ai-sdk\//.test(d) || d === 'ai' || d === 'openai' || /^@anthropic-ai\//.test(d)
        || /^@google\/genai$/.test(d) || /^@google\/generative-ai$/.test(d)
        || /^langchain/.test(d) || d === '@langchain/core' || /^llamaindex/.test(d)
        || d === 'ollama' || /^@mistralai\//.test(d) || /^cohere-ai$/.test(d));
    const evalFrameworks = lc.filter((d) =>
        d === 'langsmith' || d === 'promptfoo' || d === 'braintrust' || /^@traceloop\//.test(d)
        || /^autoevals$/.test(d) || d === 'ragas');
    const agentConfigs: string[] = [];
    if (fs.existsSync(path.join(root, '.claude'))) agentConfigs.push('.claude');
    if (fs.existsSync(path.join(root, 'CLAUDE.md'))) agentConfigs.push('CLAUDE.md');
    if (fs.existsSync(path.join(root, 'AGENTS.md'))) agentConfigs.push('AGENTS.md');
    if (fs.existsSync(path.join(root, '.cursorrules')) || fs.existsSync(path.join(root, '.cursor'))) agentConfigs.push('.cursor');
    if (fs.existsSync(path.join(root, '.github', 'copilot-instructions.md'))) agentConfigs.push('copilot');
    return {
        mcpServers, aiSdks: Array.from(new Set(aiSdks)),
        evalFrameworks: Array.from(new Set(evalFrameworks)), agentConfigs,
    };
}

function listWorkflows(root: string): string[] {
    const dir = path.join(root, '.github', 'workflows');
    try {
        return fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).slice(0, 20);
    } catch { return []; }
}

function deriveCicd(root: string, scan: TreeScan): CicdInfo {
    const workflows = listWorkflows(root);
    let provider: string | null = null;
    if (workflows.length > 0) provider = 'GitHub Actions';
    else if (scan.rootFiles.has('.gitlab-ci.yml')) provider = 'GitLab CI';
    else if (scan.rootFiles.has('.circleci')) provider = 'CircleCI';
    else if (scan.rootFiles.has('azure-pipelines.yml')) provider = 'Azure Pipelines';
    else if (scan.rootFiles.has('Jenkinsfile')) provider = 'Jenkins';
    return { hasCi: provider !== null, provider, workflows };
}

const EMPTY_GIT: GitInfo = {
    isRepo: false, branch: null, commitCount: 0, contributors: 0,
    lastCommitIso: null, firstCommitIso: null, commitsLast90d: 0,
    cadencePerWeek: 0, activity: 'unknown', busFactor: 0, topContributors: [], hotFiles: [],
};

function deriveGit(root: string, nowIso: string): GitInfo {
    const isRepo = fs.existsSync(path.join(root, '.git'));
    if (!isRepo) return { ...EMPTY_GIT };
    const run = (args: string[]): string => {
        try {
            return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).trim();
        } catch { return ''; }
    };
    const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']) || null;
    const commitCount = parseInt(run(['rev-list', '--count', 'HEAD']) || '0', 10) || 0;
    const lastCommitIso = run(['log', '-1', '--format=%cI']) || null;
    const firstCommitIso = run(['log', '--reverse', '--format=%cI', '--max-parents=0']).split('\n').filter(Boolean)[0]
        || run(['log', '--reverse', '--format=%cI']).split('\n').filter(Boolean)[0] || null;

    // Contributors with commit counts -> top list + bus factor.
    const shortlog = run(['shortlog', '-sn', 'HEAD']).split('\n').filter(Boolean);
    const parsed = shortlog.map((line) => {
        const m = line.trim().match(/^(\d+)\s+(.+)$/);
        return m ? { name: m[2].trim(), commits: parseInt(m[1], 10) } : null;
    }).filter((x): x is { name: string; commits: number } => x !== null);
    const totalC = parsed.reduce((a, c) => a + c.commits, 0) || 1;
    const topContributors: Contributor[] = parsed.slice(0, 8).map((c) => ({ name: c.name, commits: c.commits, share: c.commits / totalC }));
    let cum = 0, busFactor = 0;
    for (const c of parsed) { cum += c.commits; busFactor += 1; if (cum / totalC >= 0.5) break; }

    // Activity: commits in the last 90 days + cadence + a bucket from recency.
    const since90 = new Date(new Date(nowIso).getTime() - 90 * 86400000).toISOString();
    const commitsLast90d = parseInt(run(['rev-list', '--count', `--since=${since90}`, 'HEAD']) || '0', 10) || 0;
    const cadencePerWeek = Math.round((commitsLast90d / 90) * 7 * 10) / 10;
    let activity: GitInfo['activity'] = 'unknown';
    if (lastCommitIso) {
        const days = (new Date(nowIso).getTime() - new Date(lastCommitIso).getTime()) / 86400000;
        activity = days < 30 ? 'active' : days < 90 ? 'slowing' : days < 365 ? 'dormant' : 'abandoned';
    }

    let hotFiles: GitInfo['hotFiles'] = [];
    try { hotFiles = buildHotFiles(root, 365); } catch { hotFiles = []; }

    return {
        isRepo, branch, commitCount, contributors: parsed.length, lastCommitIso,
        firstCommitIso, commitsLast90d, cadencePerWeek, activity, busFactor,
        topContributors, hotFiles,
    };
}

function deriveInventory(root: string, scan: TreeScan, testing: TestingInfo, aiTooling: AiTooling): InventoryInfo {
    const cap = buildCapabilities(root);
    const hasLockfile = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'go.sum', 'requirements.txt'].some((f) => scan.rootFiles.has(f));
    // hasTests / hasEvals now come from the deep detectors (nested test files +
    // frameworks), not just the root-only capability check, so a monorepo with
    // tests under packages/ is not reported as "no tests".
    const hasTests = testing.frameworks.length > 0 || scan.testLoc > 0 || cap.hasTests;
    const hasEvals = aiTooling.evalFrameworks.length > 0 || testing.frameworks.includes('promptfoo') || cap.hasEvals;
    return {
        hasTests, hasEvals, hasDocs: cap.hasDocs,
        hasReleaseChecklists: cap.hasReleaseChecklists, docsCount: scan.docsCount,
        hasDockerfile: scan.rootFiles.has('Dockerfile') || scan.rootFiles.has('dockerfile') || scan.rootFiles.has('compose.yaml') || scan.rootFiles.has('docker-compose.yml'),
        hasLockfile,
        hasLicense: scan.rootFiles.has('LICENSE') || scan.rootFiles.has('LICENSE.md') || scan.rootFiles.has('LICENSE.txt') || scan.rootFiles.has('COPYING'),
        hasGitignore: scan.rootFiles.has('.gitignore'),
    };
}

// Health rollup. This is a DISCRIMINATOR, not a presence checklist: practices
// that exist add to the score, but real risk signals (no tests, a thin test
// ratio, bus factor of 1, dependency cycles, dormancy) subtract, so a repo with
// a broken README + zero tests can't sit at 100. The full Health suite (Phase 4)
// deepens it with OSV vuln data + secret scanning.
function deriveHealth(
    readme: ReadmeInfo, inv: InventoryInfo, cicd: CicdInfo, git: GitInfo,
    ratios: CodeRatios, graph: DependencyGraph,
): HealthSummary {
    const signals: HealthSignal[] = [];
    let score = 0;
    const add = (cond: boolean, id: string, label: string, weight: number, goodDetail: string, badDetail: string, badSev: HealthSeverity = 'warn') => {
        if (cond) { score += weight; signals.push({ id, label, severity: 'good', detail: goodDetail }); }
        else { signals.push({ id, label, severity: badSev, detail: badDetail }); }
    };
    add(readme.present && readme.wordCount > 60, 'readme', 'README', 16, 'A README documents the project.', 'No README, or it is very thin.', 'warn');
    add(inv.hasLicense, 'license', 'License', 12, 'A LICENSE file is present.', 'No LICENSE file, so reuse terms are unclear.', 'warn');
    add(inv.hasTests, 'tests', 'Tests', 16, 'The project has tests.', 'No tests detected.', 'risk');
    add(cicd.hasCi, 'ci', 'CI', 12, `CI is configured (${cicd.provider}).`, 'No CI workflow detected.', 'info');
    add(inv.hasGitignore, 'gitignore', '.gitignore', 6, 'A .gitignore is present.', 'No .gitignore, so build noise may be tracked.', 'warn');
    add(inv.hasLockfile, 'lockfile', 'Lockfile', 8, 'A dependency lockfile pins versions.', 'No lockfile, so dependency versions are unpinned.', 'warn');
    add(inv.hasDocs, 'docs', 'Docs', 6, 'Documentation is present.', 'No docs beyond the README.', 'info');
    add(git.isRepo, 'git', 'Version control', 8, 'The project is a git repository.', 'Not a git repository.', 'risk');

    // Discriminating signals: test depth, bus factor, cycles, activity.
    if (inv.hasTests) {
        const thin = ratios.testToSource < 0.1;
        if (thin) signals.push({ id: 'test-ratio', label: 'Test depth', severity: 'warn', detail: `Test code is only ${Math.round(ratios.testToSource * 100)}% of source; coverage is likely thin.` });
        else { score += 8; signals.push({ id: 'test-ratio', label: 'Test depth', severity: 'good', detail: `Test code is ${Math.round(ratios.testToSource * 100)}% of source.` }); }
    }
    if (git.isRepo && git.busFactor === 1 && git.commitCount > 20) {
        signals.push({ id: 'bus-factor', label: 'Bus factor', severity: 'warn', detail: 'One author wrote the majority of commits (bus factor 1).' });
    } else if (git.busFactor >= 2) {
        score += 4; signals.push({ id: 'bus-factor', label: 'Bus factor', severity: 'good', detail: `${git.busFactor} authors share the majority of work.` });
    }
    if (graph.cycles.length > 0) {
        score -= Math.min(10, graph.cycles.length * 3);
        signals.push({ id: 'cycles', label: 'Dependency cycles', severity: 'risk', detail: `${graph.cycles.length} circular dependency chain${graph.cycles.length === 1 ? '' : 's'} between packages.` });
    }
    if (git.isRepo && (git.activity === 'dormant' || git.activity === 'abandoned')) {
        signals.push({ id: 'activity', label: 'Activity', severity: 'warn', detail: `No commits recently; the project looks ${git.activity}.` });
    }
    return { score: Math.max(0, Math.min(100, score)), signals };
}

const dedupe = (a: string[]): string[] => Array.from(new Set(a));

// --- license SPDX ----------------------------------------------------------

function detectSpdx(root: string, pkgLicense: string): string {
    if (pkgLicense && /^[A-Za-z0-9.+-]+$/.test(pkgLicense) && !/^see\b/i.test(pkgLicense)) return pkgLicense;
    const body = readText(path.join(root, 'LICENSE')) || readText(path.join(root, 'LICENSE.md'))
        || readText(path.join(root, 'LICENSE.txt')) || readText(path.join(root, 'COPYING'));
    if (!body) return '';
    const h = body.slice(0, 3000);
    if (/functional source license/i.test(h)) return /apache[\s-]?2\.0/i.test(h) ? 'FSL-1.1-Apache-2.0' : 'FSL-1.1-MIT';
    if (/apache license,?\s+version 2\.0/i.test(h)) return 'Apache-2.0';
    if (/gnu affero general public/i.test(h)) return 'AGPL-3.0';
    if (/gnu lesser general public/i.test(h)) return 'LGPL-3.0';
    if (/gnu general public license[\s\S]{0,40}version 3/i.test(h)) return 'GPL-3.0';
    if (/gnu general public license[\s\S]{0,40}version 2/i.test(h)) return 'GPL-2.0';
    if (/mozilla public license version 2\.0/i.test(h)) return 'MPL-2.0';
    if (/permission is hereby granted, free of charge/i.test(h)) return 'MIT';
    if (/redistribution and use in source and binary/i.test(h)) return /neither the name/i.test(h) ? 'BSD-3-Clause' : 'BSD-2-Clause';
    if (/permission to use, copy, modify, and(\/or)? distribute/i.test(h)) return 'ISC';
    if (/this is free and unencumbered software released into the public domain/i.test(h)) return 'Unlicense';
    return '';
}

// --- run/build/test/deploy commands ---------------------------------------

const CMD_GROUPS: { re: RegExp; group: RunCommand['group'] }[] = [
    { re: /^(dev|start|serve|preview|watch|electron)/i, group: 'run' },
    { re: /(deploy|release|publish|ship)/i, group: 'deploy' },
    { re: /(test|e2e|coverage|spec|jest|vitest|playwright|pytest)/i, group: 'test' },
    { re: /(lint|format|fmt|typecheck|check|prettier|eslint|ruff|biome)/i, group: 'quality' },
    { re: /(db|migrate|seed|prisma|drizzle|generate)/i, group: 'data' },
    { re: /(build|compile|bundle|tsc|dist|package|make)/i, group: 'build' },
];
function groupForScript(name: string): RunCommand['group'] {
    for (const g of CMD_GROUPS) if (g.re.test(name)) return g.group;
    return 'other';
}
function deriveCommands(root: string): RunCommand[] {
    const out: RunCommand[] = [];
    const seen = new Set<string>();
    for (const pj of findPackageJsons(root, 60)) {
        const pkg = readJson(pj);
        const scripts = pkg?.scripts;
        if (!scripts || typeof scripts !== 'object') continue;
        const rel = path.relative(root, path.dirname(pj)).replace(/\\/g, '/') || '.';
        for (const [name, cmd] of Object.entries(scripts as Record<string, unknown>)) {
            if (typeof cmd !== 'string' || out.length >= 80) continue;
            const key = `${rel}:${name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ group: groupForScript(name), name, cmd: cmd.slice(0, 200), pkg: rel });
        }
    }
    const mk = readText(path.join(root, 'Makefile'), 8000);
    for (const m of mk.matchAll(/^([a-zA-Z][a-zA-Z0-9_-]*):/gm)) {
        if (out.length >= 90) break;
        out.push({ group: groupForScript(m[1]), name: m[1], cmd: `make ${m[1]}`, pkg: '.' });
    }
    return out;
}

// --- data layer / testing / API style -------------------------------------

function deriveDataLayer(deps: string[]): DataLayer {
    const lc = new Set(deps.map((d) => d.toLowerCase()));
    const any = (...n: string[]) => n.some((x) => lc.has(x));
    const orm: string[] = [];
    if (any('prisma', '@prisma/client')) orm.push('Prisma');
    if (any('drizzle-orm')) orm.push('Drizzle');
    if (any('typeorm')) orm.push('TypeORM');
    if (any('mongoose')) orm.push('Mongoose');
    if (any('sequelize')) orm.push('Sequelize');
    if (any('knex')) orm.push('Knex');
    if (any('kysely')) orm.push('Kysely');
    if (any('sqlalchemy')) orm.push('SQLAlchemy');
    if (any('alembic')) orm.push('Alembic');
    if (any('diesel', 'sqlx')) orm.push(any('diesel') ? 'Diesel' : 'sqlx');
    const engines: string[] = [];
    if (any('pg', 'postgres', 'psycopg2', 'asyncpg', '@supabase/supabase-js')) engines.push('Postgres');
    if (any('mysql2', 'mysql')) engines.push('MySQL');
    if (any('better-sqlite3', 'sqlite3')) engines.push('SQLite');
    if (any('redis', 'ioredis', '@upstash/redis')) engines.push('Redis');
    if (any('mongodb', 'pymongo')) engines.push('MongoDB');
    return { orm: dedupe(orm), engines: dedupe(engines) };
}

function deriveTesting(deps: string[], scan: TreeScan): TestingInfo {
    const lc = new Set(deps.map((d) => d.toLowerCase()));
    const any = (...n: string[]) => n.some((x) => lc.has(x));
    const frameworks: string[] = [];
    if (any('vitest')) frameworks.push('Vitest');
    if (any('jest', '@jest/core', 'ts-jest')) frameworks.push('Jest');
    if (any('@playwright/test', 'playwright')) frameworks.push('Playwright');
    if (any('cypress')) frameworks.push('Cypress');
    if (any('mocha')) frameworks.push('Mocha');
    if (any('pytest')) frameworks.push('pytest');
    if (any('promptfoo')) frameworks.push('promptfoo');
    if (frameworks.length === 0 && scan.testLoc > 0) frameworks.push('tests present');
    const linters: string[] = [];
    if (any('eslint')) linters.push('ESLint');
    if (any('@biomejs/biome')) linters.push('Biome');
    if (any('oxlint')) linters.push('oxlint');
    if (any('ruff')) linters.push('Ruff');
    if (any('pylint')) linters.push('Pylint');
    const formatters: string[] = [];
    if (any('prettier')) formatters.push('Prettier');
    if (any('black')) formatters.push('Black');
    const typecheck: string[] = [];
    if (any('typescript')) typecheck.push('tsc');
    if (any('mypy')) typecheck.push('mypy');
    if (any('pyright')) typecheck.push('Pyright');
    return { frameworks: dedupe(frameworks), linters: dedupe(linters), formatters: dedupe(formatters), typecheck: dedupe(typecheck) };
}

function deriveApiStyle(deps: string[], scan: TreeScan): string[] {
    const lc = deps.map((d) => d.toLowerCase());
    const any = (...n: string[]) => n.some((x) => lc.some((d) => d === x || d.startsWith(x)));
    const out: string[] = [];
    if (any('@trpc/server', '@trpc/client')) out.push('tRPC');
    if (any('graphql', '@apollo/server', '@apollo/client', 'apollo-server')) out.push('GraphQL');
    if (any('@grpc/grpc-js', 'grpc')) out.push('gRPC');
    if (any('@nestjs/swagger', 'swagger-ui-express', 'swagger') || [...scan.relFiles].some((f) => /openapi|swagger/i.test(f))) out.push('OpenAPI');
    if (any('socket.io', 'ws')) out.push('WebSocket');
    if (out.length === 0 && any('express', 'fastify', 'koa', '@nestjs/core', 'hono', 'flask', 'fastapi')) out.push('REST');
    return dedupe(out);
}

// --- hotspots + reading order (deterministic; AI refines the rationale) ----

function deriveHotspots(graph: DependencyGraph, hotFiles: GitInfo['hotFiles']): Hotspot[] {
    const inDeg = new Map<string, number>();
    for (const e of graph.edges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    const churnByPkg = new Map<string, number>();
    for (const hf of hotFiles) {
        const pkg = pkgForRelPath(hf.path);
        churnByPkg.set(pkg, (churnByPkg.get(pkg) ?? 0) + hf.changes);
    }
    return graph.nodes.filter((n) => !n.external && n.loc > 0).map((n) => {
        const churn = churnByPkg.get(n.id) ?? 0;
        const dep = inDeg.get(n.id) ?? 0;
        // Risk grows with size (log), change frequency, and how many things depend on it.
        const score = Math.round(Math.log2(n.loc + 1) * (1 + churn / 200) * (1 + dep) * 10) / 10;
        return { path: n.id, loc: n.loc, churn, dependedOnBy: dep, score };
    }).sort((a, b) => b.score - a.score).slice(0, 6);
}

function deriveReadingOrder(graph: DependencyGraph, packages: PackageInfo[], hotFiles: GitInfo['hotFiles']): ReadingStep[] {
    const steps: ReadingStep[] = [];
    const seen = new Set<string>();
    const push = (p: string | undefined, reason: string) => {
        if (p && !seen.has(p)) { seen.add(p); steps.push({ path: p, reason }); }
    };
    const app = packages.find((p) => p.role === 'shell') ?? packages.find((p) => p.kind === 'app');
    push(app?.relPath, 'entry point');
    const inDeg = new Map<string, number>();
    for (const e of graph.edges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    const ranked = [...graph.nodes].filter((n) => !n.external).sort((a, b) => (inDeg.get(b.id) ?? 0) - (inDeg.get(a.id) ?? 0));
    for (const n of ranked.slice(0, 3)) if ((inDeg.get(n.id) ?? 0) > 0) push(n.id, 'most depended-upon');
    if (hotFiles[0]) push(hotFiles[0].path, 'changes most often');
    const largest = [...graph.nodes].filter((n) => !n.external).sort((a, b) => b.loc - a.loc)[0];
    push(largest?.id, 'largest by code');
    return steps.slice(0, 8);
}

// --- containers / CI workflows / env groups / release ---------------------

function deriveContainers(root: string, scan: TreeScan): ContainerInfo {
    const dockerfiles: ContainerInfo['dockerfiles'] = [];
    for (const f of scan.relFiles) {
        if (!/(^|\/)dockerfile(\.[\w-]+)?$/i.test(f)) continue;
        const body = readText(path.join(root, f), 6000);
        dockerfiles.push({
            path: f,
            baseImages: [...body.matchAll(/^\s*FROM\s+(\S+)/gim)].map((m) => m[1]).slice(0, 4),
            ports: [...body.matchAll(/^\s*EXPOSE\s+(\d+)/gim)].map((m) => parseInt(m[1], 10)).slice(0, 6),
        });
        if (dockerfiles.length >= 6) break;
    }
    const composeServices: ContainerInfo['composeServices'] = [];
    for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
        if (!scan.rootFiles.has(name)) continue;
        try {
            const doc = YAML.parse(readText(path.join(root, name), 40000)) as { services?: Record<string, { image?: string; ports?: unknown[]; depends_on?: unknown }> };
            const svcs = doc?.services ?? {};
            for (const [svc, def] of Object.entries(svcs)) {
                composeServices.push({
                    name: svc, image: typeof def?.image === 'string' ? def.image : '',
                    ports: Array.isArray(def?.ports) ? def.ports.map(String).slice(0, 4) : [],
                    dependsOn: Array.isArray(def?.depends_on) ? def.depends_on.map(String) : (def?.depends_on && typeof def.depends_on === 'object' ? Object.keys(def.depends_on) : []),
                });
                if (composeServices.length >= 12) break;
            }
        } catch { /* skip */ }
        break;
    }
    return { dockerfiles, composeServices };
}

function deriveWorkflows(root: string): WorkflowDetail[] {
    const dir = path.join(root, '.github', 'workflows');
    let files: string[];
    try { files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).slice(0, 12); } catch { return []; }
    const out: WorkflowDetail[] = [];
    for (const f of files) {
        try {
            const doc = YAML.parse(readText(path.join(dir, f), 40000)) as { on?: unknown; jobs?: Record<string, { needs?: unknown; steps?: { uses?: string }[] }> };
            if (!doc) continue;
            const on = doc.on;
            const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : (on && typeof on === 'object' ? Object.keys(on) : []);
            const jobsObj = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
            const needs: WorkflowDetail['needs'] = [];
            const deploys: string[] = [];
            for (const [jn, jv] of Object.entries(jobsObj)) {
                if (jv?.needs) needs.push({ job: jn, on: Array.isArray(jv.needs) ? jv.needs.map(String) : [String(jv.needs)] });
                for (const s of Array.isArray(jv?.steps) ? jv.steps : []) {
                    if (s?.uses && /deploy|vercel|netlify|fly|railway|pages|cloudflare/i.test(String(s.uses))) deploys.push(String(s.uses).split('@')[0]);
                }
            }
            out.push({ file: f, triggers: triggers.slice(0, 6), jobs: Object.keys(jobsObj).slice(0, 12), needs, deploys: dedupe(deploys).slice(0, 6) });
        } catch { /* skip */ }
    }
    return out;
}

function deriveEnvGroups(envNames: string[]): EnvGroup[] {
    const byPrefix = new Map<string, string[]>();
    for (const n of envNames) {
        const prefix = n.split('_')[0] || n;
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix)!.push(n);
    }
    const out: EnvGroup[] = [];
    for (const [prefix, names] of byPrefix) {
        const clientExposed = names.some((n) => /^(NEXT_PUBLIC|VITE|PUBLIC|REACT_APP|EXPO_PUBLIC|GATSBY)_/.test(n));
        out.push({ prefix, names: names.slice(0, 12), clientExposed });
    }
    return out.sort((a, b) => b.names.length - a.names.length).slice(0, 12);
}

function deriveRelease(root: string, scan: TreeScan): ReleaseInfo {
    let latestTag: string | null = null;
    let tagCount = 0;
    if (fs.existsSync(path.join(root, '.git'))) {
        try {
            const tags = execFileSync('git', ['-C', root, 'tag', '--sort=-creatordate'], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
                .split('\n').filter(Boolean);
            tagCount = tags.length;
            latestTag = tags[0] ?? null;
        } catch { /* none */ }
    }
    const hasChangelog = [...scan.rootFiles].some((f) => /^changelog(\.md|\.rst|\.txt)?$/i.test(f))
        || [...scan.relFiles].some((f) => /(^|\/)CHANGELOG(\.md)?$/i.test(f));
    return { latestTag, tagCount, hasChangelog };
}

// --- packages joined with their own manifests -----------------------------

function localDepNames(pkg: Record<string, unknown> | null): string[] {
    if (!pkg) return [];
    const out: string[] = [];
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const block = pkg[field];
        if (block && typeof block === 'object') out.push(...Object.keys(block as Record<string, unknown>));
    }
    return out;
}

function kindOf(id: string, pkg: Record<string, unknown> | null, frameworks: string[]): PackageKind {
    if (RE_DOCS.test(id)) return 'docs';
    if (/(^|[-/_])(qa|tests?|e2e|specs?|evals?|benchmarks?)(\b|[-/_]|$)/i.test(id)) return 'test';
    if (frameworks.some((f) => /react|vue|svelte|angular|electron|next|astro|solid/i.test(f))) return 'app';
    if (pkg && (pkg.bin || (typeof pkg.main === 'string'))) {
        return pkg.bin ? 'app' : 'lib';
    }
    if (/(^|[-/_])(scripts?|config|tooling|tokens|build|setup|cli)(\b|[-/_]|$)/i.test(id)) return 'tooling';
    return 'unknown';
}
const RE_DOCS = /(^|[-/_])docs?(\b|[-/_]|$)/i;

function roleForKind(kind: PackageKind, id: string, fallback: string): string {
    if (kind === 'test') return 'test';
    if (kind === 'docs') return 'infra';
    if (kind === 'tooling') return 'infra';
    if (kind === 'app') {
        // electron main vs renderer: a package whose name says electron/main is the
        // process shell; an app with a UI framework is presentation.
        return /(^|[-/_])(electron|main|server|host|backend)(\b|[-/_]|$)/i.test(id) ? 'shell' : 'presentation';
    }
    if (kind === 'lib') return 'domain';
    return fallback;
}

function perPackageFrameworks(deps: string[]): string[] {
    const lc = new Set(deps.map((d) => d.toLowerCase()));
    // Reuse the curated framework table so display names stay in one place.
    return NOTABLE_FRAMEWORKS.filter((fw) => lc.has(fw.dep.toLowerCase())).map((fw) => fw.name);
}

// Enumerate every package manifest (package.json / pyproject.toml / Cargo.toml),
// join it with its graph node (loc/fileCount), classify kind + role, and detect
// its own frameworks. This is what turns "console-shell: shell" into
// "console-shell: React renderer (presentation)" and surfaces empty-but-real
// packages like design-tokens and tool-wrapper packages.
function derivePackages(graph: DependencyGraph, root: string): PackageInfo[] {
    const nodeById = new Map<string, { loc: number; fileCount: number; tier: string }>();
    for (const n of graph.nodes) {
        if (!n.external) nodeById.set(n.id, { loc: n.loc, fileCount: n.fileCount, tier: n.tier });
    }
    const byId = new Map<string, PackageInfo>();

    const addManifest = (file: string, parse: 'json' | 'py' | 'cargo') => {
        const rel = path.relative(root, path.dirname(file)).replace(/\\/g, '/');
        if (rel === '') return;
        const id = pkgForRelPath(rel);
        if (byId.has(id)) return;
        let name = id.split('/').pop() ?? id, description, version, isPrivate, deps: string[] = [];
        let pkg: Record<string, unknown> | null = null;
        if (parse === 'json') {
            pkg = readJson(file);
            if (pkg) {
                if (typeof pkg.name === 'string') name = pkg.name;
                if (typeof pkg.description === 'string') description = pkg.description;
                if (typeof pkg.version === 'string') version = pkg.version;
                if (typeof pkg.private === 'boolean') isPrivate = pkg.private;
                deps = localDepNames(pkg);
            }
        } else {
            const body = readText(file, 6000);
            const nm = body.match(/^\s*name\s*=\s*"([^"]+)"/m); if (nm) name = nm[1];
            const dm = body.match(/^\s*description\s*=\s*"([^"]+)"/m); if (dm) description = dm[1];
            const vm = body.match(/^\s*version\s*=\s*"([^"]+)"/m); if (vm) version = vm[1];
        }
        const frameworks = perPackageFrameworks(deps);
        const kind = kindOf(id, pkg, frameworks);
        const node = nodeById.get(id);
        byId.set(id, {
            name, relPath: id, kind, frameworks, description, version, private: isPrivate,
            role: roleForKind(kind, id, node?.tier ?? 'domain'),
            loc: node?.loc ?? 0, fileCount: node?.fileCount ?? 0,
        });
    };

    for (const pj of findPackageJsons(root, 60)) addManifest(pj, 'json');
    for (const f of findFilesNamed(root, ['pyproject.toml', 'Cargo.toml'], 60)) {
        addManifest(f, f.endsWith('Cargo.toml') ? 'cargo' : 'py');
    }

    // Source-only graph nodes with no manifest (docs/, scripts/) still listed.
    for (const [id, node] of nodeById) {
        if (byId.has(id)) continue;
        const kind = kindOf(id, null, []);
        byId.set(id, {
            name: id.split('/').pop() ?? id, relPath: id, kind, frameworks: [],
            role: roleForKind(kind, id, node.tier), loc: node.loc, fileCount: node.fileCount,
        });
    }

    return Array.from(byId.values()).sort((a, b) => b.loc - a.loc).slice(0, 60);
}

// Find files with a given basename across the tree (bounded), for non-JS manifests.
function findFilesNamed(root: string, names: string[], cap: number): string[] {
    const want = new Set(names);
    const found: string[] = [];
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length > 0 && found.length < cap) {
        const { dir, depth } = stack.pop()!;
        if (depth > 6) continue;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const ent of entries) {
            if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
            if (ent.isDirectory()) stack.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
            else if (want.has(ent.name)) found.push(path.join(dir, ent.name));
        }
    }
    return found;
}

function titleFromName(name: string): string {
    const base = name.includes('/') ? name.split('/').pop()! : name;
    return base
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

function sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface MountStep {
    id: string;
    label: string;
}

// Ordered steps the mount UI shows; each maps to a stage below.
export const MOUNT_STEPS: MountStep[] = [
    { id: 'scan', label: 'Reading the file tree' },
    { id: 'deps', label: 'Mapping dependencies' },
    { id: 'meta', label: 'Reading project metadata' },
    { id: 'stack', label: 'Detecting the tech stack' },
    { id: 'services', label: 'Finding connected services' },
    { id: 'graph', label: 'Mapping the architecture' },
    { id: 'git', label: 'Reading git history' },
    { id: 'health', label: 'Scoring project health' },
];

const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Build the full deterministic profile. `nowIso` is passed in so the caller
 * controls the timestamp (no Date.now() surprises in tests). When `onStep` is
 * given, the builder reports each stage and yields to the event loop before it,
 * so the mount screen shows real progress and the main process stays responsive
 * on a large repo; without it the build runs straight through. The dependency
 * graph is computed via the cached arch-graph path.
 */
export async function buildProfile(
    root: string,
    nowIso: string,
    onStep?: (id: string, label: string) => void,
): Promise<ProjectProfile> {
    const startedAt = Date.now();
    const step = async (id: string, label: string): Promise<void> => {
        if (onStep) { onStep(id, label); await yieldToLoop(); }
    };

    await step('scan', 'Reading the file tree');
    const scan = scanProject(root);

    await step('deps', 'Mapping dependencies');
    const deps = collectDeps(root);
    const versions = collectDepVersions(root);
    const mcpServers = collectMcpServers(root);
    const envNames = collectEnvNames(root);

    await step('meta', 'Reading project metadata');
    const rootPkg = readJson(path.join(root, 'package.json'));
    const summary = buildSummary(root);
    const shapeRaw = buildShape(root);
    const readme = parseReadme(root);
    const commands = deriveCommands(root);

    await step('stack', 'Detecting the tech stack');
    const stack = deriveStack(root, scan, deps, versions);
    const aiTooling = deriveAiTooling(root, deps, mcpServers);

    await step('services', 'Finding connected services');
    const services: DetectedService[] = detectServices({
        envNames, deps, configFiles: Array.from(scan.rootFiles), mcpNames: mcpServers,
    });

    await step('graph', 'Mapping the architecture');
    let depGraph: DependencyGraph;
    try {
        // Same options as the Architecture panel's default so the profiler warms
        // the cache the panel reads (rather than thrashing a second cache entry).
        depGraph = getGraph(root, { includeExternal: false, allLanguages: false }, false);
    } catch {
        depGraph = { nodes: [], edges: [], cycles: [], truncated: false, fileCount: 0 };
    }
    const packages = derivePackages(depGraph, root);

    // Corrected shape: monorepo + package count from the real package list,
    // projectType from deps (Electron/Tauri/mobile), runnable + start from the
    // grouped commands, primaryLanguage in sync with the LOC histogram. One
    // source of truth, so shape never contradicts the rest of the profile.
    const workspace = detectWorkspace(root, scan, packages.length);
    const runCmd = commands.find((c) => /^(start|dev)$/i.test(c.name)) ?? commands.find((c) => c.group === 'run');
    const shape = {
        ...shapeRaw,
        primaryLanguage: stack.primaryLanguage,
        isMonorepo: workspace.isMonorepo,
        packageCount: workspace.isMonorepo ? Math.max(shapeRaw.packageCount, packages.length) : shapeRaw.packageCount,
        projectType: classifyProjectType(shapeRaw.projectType, deps, workspace.isMonorepo),
        runnable: shapeRaw.runnable || !!runCmd,
        startCommand: shapeRaw.startCommand
            ?? (runCmd ? (runCmd.pkg === '.' ? `npm run ${runCmd.name}` : `npm run ${runCmd.name} (in ${runCmd.pkg})`) : undefined),
        workspaceTool: workspace.tool,
        workspaceGlobs: workspace.globs,
    };

    await step('git', 'Reading git history');
    const git = deriveGit(root, nowIso);

    await step('health', 'Scoring project health');
    const cicd = deriveCicd(root, scan);
    const testing = deriveTesting(deps, scan);
    const inventory = deriveInventory(root, scan, testing, aiTooling);
    const dataLayer = deriveDataLayer(deps);
    const apiStyle = deriveApiStyle(deps, scan);
    const ratios: CodeRatios = {
        sourceLoc: scan.sourceLoc, testLoc: scan.testLoc, docsLoc: scan.docsLoc, configFiles: scan.configFiles,
        testToSource: scan.sourceLoc ? Math.round((scan.testLoc / scan.sourceLoc) * 100) / 100 : 0,
        docsToSource: scan.sourceLoc ? Math.round((scan.docsLoc / scan.sourceLoc) * 100) / 100 : 0,
    };
    const detail: ProjectDetail = {
        commands, dataLayer, testing, apiStyle,
        readingOrder: deriveReadingOrder(depGraph, packages, git.hotFiles),
        hotspots: deriveHotspots(depGraph, git.hotFiles),
        containers: deriveContainers(root, scan),
        workflows: deriveWorkflows(root),
        envGroups: deriveEnvGroups(envNames),
        todoCount: scan.todoCount,
        release: deriveRelease(root, scan),
    };
    const health = deriveHealth(readme, inventory, cicd, git, ratios, depGraph);

    // Prefer the README's first prose line for the description: a monorepo root's
    // package.json often describes the BUILD, not the product (Desktop), whereas
    // the README opens with what the project IS.
    const description = readme.description || summary.description || '';
    const name = (typeof rootPkg?.name === 'string' ? rootPkg.name : '') || summary.name || path.basename(root);
    const repo = rootPkg?.repository;
    const repositoryUrl = typeof repo === 'string' ? repo
        : (repo && typeof repo === 'object' && typeof (repo as { url?: string }).url === 'string'
            ? (repo as { url: string }).url.replace(/^git\+/, '').replace(/\.git$/, '') : undefined);

    return {
        identity: {
            name, title: titleFromName(name), description, root,
            license: detectSpdx(root, typeof rootPkg?.license === 'string' ? rootPkg.license : ''),
            repositoryUrl,
            homepage: typeof rootPkg?.homepage === 'string' ? rootPkg.homepage : undefined,
            keywords: Array.isArray(rootPkg?.keywords) ? (rootPkg!.keywords as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 12) : [],
            version: typeof rootPkg?.version === 'string' ? rootPkg.version : undefined,
            private: typeof rootPkg?.private === 'boolean' ? rootPkg.private : undefined,
        },
        stack, shape, packages,
        metrics: {
            fileCount: scan.fileCount, totalBytes: scan.totalBytes, totalLoc: scan.totalLoc,
            sizeLabel: sizeLabel(scan.totalBytes), truncated: scan.truncated, ratios,
        },
        readme, services, aiTooling, cicd, inventory, git, health, detail, depGraph,
        ai: null,
        generatedAt: nowIso,
        signature: cacheSignature(root),
        durationMs: Date.now() - startedAt,
    };
}

// --- shape correction helpers ---------------------------------------------

interface WorkspaceInfo { isMonorepo: boolean; tool: string | null; globs: string[]; }

function detectWorkspace(root: string, scan: TreeScan, packageCount: number): WorkspaceInfo {
    const pkg = readJson(path.join(root, 'package.json'));
    const ws = pkg?.workspaces;
    let globs: string[] = [];
    if (Array.isArray(ws)) globs = ws.filter((g): g is string => typeof g === 'string');
    else if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages)) {
        globs = (ws as { packages: unknown[] }).packages.filter((g): g is string => typeof g === 'string');
    }
    let tool: string | null = null;
    if (scan.rootFiles.has('pnpm-workspace.yaml')) tool = 'pnpm';
    else if (scan.rootFiles.has('turbo.json')) tool = 'turbo';
    else if (scan.rootFiles.has('nx.json')) tool = 'nx';
    else if (scan.rootFiles.has('lerna.json')) tool = 'lerna';
    else if (globs.length > 0) tool = 'npm workspaces';
    else if (packageCount >= 2) tool = 'npm --prefix';
    // A monorepo if a workspace tool is declared OR there are >=2 real packages.
    const isMonorepo = tool !== null && tool !== 'npm --prefix' ? true : packageCount >= 2;
    return { isMonorepo, tool, globs };
}

function classifyProjectType(fallback: string, deps: string[], isMonorepo: boolean): string {
    const lc = new Set(deps.map((d) => d.toLowerCase()));
    const suffix = isMonorepo ? ' (multi-package)' : '';
    if (lc.has('electron')) return `Electron desktop app${suffix}`;
    if ([...lc].some((d) => d.startsWith('@tauri-apps/'))) return `Tauri desktop app${suffix}`;
    if (lc.has('react-native') || lc.has('expo')) return `React Native mobile app${suffix}`;
    if (lc.has('next') || lc.has('nuxt') || lc.has('@remix-run/react') || lc.has('astro')) return `Web app${suffix}`;
    if (isMonorepo && !/monorepo/i.test(fallback)) return `Monorepo (${fallback})`;
    return fallback;
}

