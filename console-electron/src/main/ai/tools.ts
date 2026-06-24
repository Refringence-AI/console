// console-electron/src/main/ai/tools.ts
//
// Agentic read-only tools the assistant can call to ground answers in the
// user's actual project: list a directory, read a file (capped), and search
// the code. Everything is scoped to the picked project root with a traversal
// guard - the assistant cannot read outside the project. Plus a compact
// project-context block injected into the system prompt.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SKIP = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache',
    '.venv', '__pycache__', '.refringence-qa', '.refringence-console',
]);

function inside(root: string, p: string): boolean {
    const rel = path.relative(root, p);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Lexical containment is bypassable via symlinks; canonicalise both root and
// target with realpath and confirm the real target still sits under the real
// root. Returns false on ENOENT, symlink loops, or any resolution failure.
function realInside(root: string, target: string): boolean {
    try {
        const realRoot = fs.realpathSync(root);
        const realTarget = fs.realpathSync(target);
        const rel = path.relative(realRoot, realTarget);
        return (rel === '' || !rel.startsWith('..')) && !path.isAbsolute(rel);
    } catch { return false; }
}

function listFiles(root: string, dir: string): string {
    const abs = path.resolve(root, dir || '.');
    if (!inside(root, abs)) return 'Path is outside the project.';
    if (!realInside(root, abs)) return 'Path is outside the project.';
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return 'Directory not found.'; }
    const names = ents
        .filter((e) => !(e.name.startsWith('.') && e.name !== '.github') && !SKIP.has(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .slice(0, 200);
    return names.length ? names.join('\n') : '(empty)';
}

function readFileCapped(root: string, rel: string): string {
    const abs = path.resolve(root, rel);
    if (!inside(root, abs)) return 'Path is outside the project.';
    if (!realInside(root, abs)) return 'Path is outside the project.';
    try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) return 'Not a file.';
        if (stat.size > 200_000) return 'File is too large to read (over 200KB).';
        const lines = fs.readFileSync(abs, 'utf8').split('\n');
        return lines.length > 400
            ? lines.slice(0, 400).join('\n') + `\n... (${lines.length - 400} more lines)`
            : lines.join('\n');
    } catch { return 'Could not read the file.'; }
}

async function searchCode(root: string, query: string): Promise<string> {
    // git grep is fast + respects .gitignore; fall back to a bounded JS walk.
    try {
        const { stdout } = await execFileAsync(
            'git', ['-C', root, 'grep', '-n', '-I', '--no-color', '-F', '-e', query, '--'],
            { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
        );
        const lines = stdout.split('\n').filter(Boolean).slice(0, 60);
        return lines.length ? lines.join('\n') : 'No matches.';
    } catch (e) {
        if (e && typeof e === 'object' && (e as { code?: number }).code === 1) return 'No matches.';
        return jsSearch(root, query);
    }
}

function jsSearch(root: string, query: string): string {
    const out: string[] = [];
    let scanned = 0;
    const stack = [root];
    const needle = query.toLowerCase();
    while (stack.length && out.length < 60 && scanned < 3000) {
        const dir = stack.pop() as string;
        let ents: fs.Dirent[];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
            if (e.name.startsWith('.') && e.name !== '.github') continue;
            if (SKIP.has(e.name)) continue;
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) { stack.push(abs); continue; }
            if (!/\.(ts|tsx|js|jsx|py|go|rs|java|c|cc|cpp|h|hpp|css|md|json|ya?ml|sh|html)$/i.test(e.name)) continue;
            scanned++;
            let body: string;
            try { if (fs.statSync(abs).size > 500_000) continue; body = fs.readFileSync(abs, 'utf8'); } catch { continue; }
            const ls = body.split('\n');
            for (let i = 0; i < ls.length && out.length < 60; i++) {
                if (ls[i].toLowerCase().includes(needle)) {
                    out.push(`${path.relative(root, abs).replace(/\\/g, '/')}:${i + 1}: ${ls[i].trim().slice(0, 160)}`);
                }
            }
        }
    }
    return out.length ? out.join('\n') : 'No matches.';
}

export function buildProjectTools(ai: typeof import('ai'), root: string): Record<string, unknown> {
    // JSON-schema (not zod) tool inputs: the v6 zod tool-type inference is what
    // OOMs the tsc build, and these three schemas are trivial.
    return {
        list_files: ai.tool({
            description: 'List files and folders in a directory of the project. Pass "" for the project root.',
            inputSchema: ai.jsonSchema<{ dir: string }>({
                type: 'object',
                properties: { dir: { type: 'string', description: 'Directory relative to the project root.' } },
                required: ['dir'], additionalProperties: false,
            }),
            execute: async ({ dir }) => listFiles(root, dir),
        }),
        read_file: ai.tool({
            description: 'Read a text file from the project by its path relative to the root. Returns up to ~400 lines.',
            inputSchema: ai.jsonSchema<{ path: string }>({
                type: 'object',
                properties: { path: { type: 'string', description: 'File path relative to the project root.' } },
                required: ['path'], additionalProperties: false,
            }),
            execute: async ({ path: p }) => readFileCapped(root, p),
        }),
        search_code: ai.tool({
            description: 'Search the project files for a literal string. Returns matching file:line snippets.',
            inputSchema: ai.jsonSchema<{ query: string }>({
                type: 'object',
                properties: { query: { type: 'string', description: 'The text to search for.' } },
                required: ['query'], additionalProperties: false,
            }),
            execute: async ({ query }) => searchCode(root, query),
        }),
    };
}

// A compact context block prepended to the chat system prompt so the assistant
// knows which project it is helping with and that it has tools to explore it.
export function buildProjectContext(root: string): string {
    const name = path.basename(root);
    let shape = 'No package.json at the project root.';
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: string; description?: string; scripts?: Record<string, string> };
        shape = `package.json name: ${pkg.name ?? name}${pkg.description ? `; description: ${pkg.description}` : ''}; scripts: ${Object.keys(pkg.scripts ?? {}).join(', ') || 'none'}.`;
    } catch { /* keep default */ }
    let topLevel = '';
    try {
        topLevel = fs.readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
            .map((e) => e.name).slice(0, 20).join(', ');
    } catch { /* none */ }
    return [
        'You are Console\'s assistant, helping with a software project the user has open in the app.',
        `Project root: ${root}`,
        shape,
        topLevel ? `Top-level folders: ${topLevel}.` : '',
        'You have read-only tools (list_files, read_file, search_code) to explore the project. Use them to ground your answers in the actual code before answering questions about this project; do not guess about files you have not read. Keep answers concise and concrete.',
    ].filter(Boolean).join('\n');
}
