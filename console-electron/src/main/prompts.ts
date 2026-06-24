// console-electron/src/main/prompts.ts
//
// Prompt-library store. Lives per-project at
// <projectRoot>/.refringence-console/prompts.json so prompts travel with
// the repo (the dir is gitignored, so the user decides whether to commit).
//
// Writes are atomic (tmp file + rename) so a crash mid-write never leaves a
// half-written prompts.json that would wipe the user's library. The project
// root is traversal-guarded the same way the runner / library handlers do:
// we resolve it, confirm it is a directory, and only touch the
// .refringence-console subdir under it.
import * as fs from 'node:fs';
import * as path from 'node:path';

export type PromptVariableType = 'text' | 'multiline' | 'select';

export interface PromptVariable {
    name: string;
    type: PromptVariableType;
    label: string;
    options?: string[];
    default?: string;
}

export interface PromptEntry {
    id: string;
    title: string;
    body: string;
    variables: PromptVariable[];
    category: string;
    tags: string[];
    favorite: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface PromptStore {
    version: number;
    prompts: PromptEntry[];
}

export interface PromptInput {
    title: string;
    body: string;
    variables?: PromptVariable[];
    category?: string;
    tags?: string[];
    favorite?: boolean;
}

const STORE_VERSION = 1;
const STORE_DIR = '.refringence-console';
const STORE_FILE = 'prompts.json';

// The active project root is resolved + checked once per call. A renderer
// bug cannot point the store at an arbitrary path: a non-directory or a
// non-string falls back to null and every CRUD op returns an empty result.
function resolveRoot(projectRoot: string): string | null {
    if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) return null;
    const abs = path.resolve(projectRoot);
    try {
        if (!fs.statSync(abs).isDirectory()) return null;
    } catch {
        return null;
    }
    return abs;
}

function storePath(root: string): string {
    return path.join(root, STORE_DIR, STORE_FILE);
}

function newId(): string {
    const rand = Math.random().toString(36).slice(2, 8);
    return `p-${Date.now().toString(36)}-${rand}`;
}

function nowIso(): string {
    return new Date().toISOString();
}

// Seed prompts written on first read when no prompts.json exists yet. These
// are the everyday asks a newcomer reaches for, each with one variable so
// the form has something to render.
function seedPrompts(): PromptEntry[] {
    const ts = nowIso();
    const make = (
        id: string,
        title: string,
        body: string,
        variables: PromptVariable[],
        category: string,
        tags: string[],
    ): PromptEntry => ({
        id, title, body, variables, category, tags, favorite: false, createdAt: ts, updatedAt: ts,
    });
    return [
        make(
            'seed-explain-error',
            'Explain this error',
            'I hit this error and I do not understand it. Explain what it means in plain words, the likely cause, and the smallest fix.\n\n```\n{{error}}\n```',
            [{ name: 'error', type: 'multiline', label: 'Error message or stack trace' }],
            'Debugging',
            ['error', 'explain'],
        ),
        make(
            'seed-write-test',
            'Write a test',
            'Write a focused test for the code below using {{framework}}. Cover the happy path and one edge case. Return only the test file.\n\n```\n{{code}}\n```',
            [
                { name: 'framework', type: 'text', label: 'Test framework', default: 'vitest' },
                { name: 'code', type: 'multiline', label: 'Code under test' },
            ],
            'Testing',
            ['test'],
        ),
        make(
            'seed-deploy-ready',
            'Make deploy-ready',
            'Review this change for {{target}} and list what is missing before it can ship: build, env vars, migrations, and a rollback note. Be specific.\n\n{{notes}}',
            [
                { name: 'target', type: 'text', label: 'Deploy target', default: 'production' },
                { name: 'notes', type: 'multiline', label: 'What changed' },
            ],
            'Release',
            ['deploy', 'release'],
        ),
        make(
            'seed-security-review',
            'Review for security',
            'Review the code below for security problems: injection, secrets in source, missing authz, unsafe deserialization, path traversal. Rank findings by severity.\n\n```\n{{code}}\n```',
            [{ name: 'code', type: 'multiline', label: 'Code to review' }],
            'Security',
            ['security', 'review'],
        ),
        make(
            'seed-explain-repo',
            'Explain this repo',
            'Explain what this repository does at a {{depth}} level: its purpose, the main packages, and where I should start reading.',
            [
                {
                    name: 'depth', type: 'select', label: 'Detail level', default: 'high',
                    options: ['high', 'medium', 'deep'],
                },
            ],
            'Onboarding',
            ['repo', 'explain'],
        ),
    ];
}

function isVariable(v: unknown): v is PromptVariable {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    const typeOk = o.type === 'text' || o.type === 'multiline' || o.type === 'select';
    return typeof o.name === 'string' && typeof o.label === 'string' && typeOk;
}

// Coerce one parsed object into a PromptEntry, dropping anything malformed so
// a hand-edited prompts.json never crashes the store.
function coerceEntry(raw: unknown): PromptEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.title !== 'string' || typeof o.body !== 'string') {
        return null;
    }
    const variables = Array.isArray(o.variables) ? o.variables.filter(isVariable) : [];
    const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : [];
    return {
        id: o.id,
        title: o.title,
        body: o.body,
        variables,
        category: typeof o.category === 'string' ? o.category : 'General',
        tags,
        favorite: o.favorite === true,
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : nowIso(),
        updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : nowIso(),
    };
}

function readStore(root: string): PromptStore {
    const file = storePath(root);
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as PromptStore).prompts)) {
            const prompts = (parsed as PromptStore).prompts
                .map(coerceEntry)
                .filter((e): e is PromptEntry => e !== null);
            return { version: STORE_VERSION, prompts };
        }
    } catch {
        // Missing file -> seed below. A corrupt file also falls through to a
        // fresh seed rather than throwing across IPC.
    }
    const seeded: PromptStore = { version: STORE_VERSION, prompts: seedPrompts() };
    writeStore(root, seeded);
    return seeded;
}

function writeStore(root: string, store: PromptStore): boolean {
    const dir = path.join(root, STORE_DIR);
    const file = storePath(root);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
        fs.renameSync(tmp, file);
        return true;
    } catch {
        try { if (fs.existsSync(tmp)) fs.rmSync(tmp); } catch { /* noop */ }
        return false;
    }
}

export function listPrompts(projectRoot: string): PromptEntry[] {
    const root = resolveRoot(projectRoot);
    if (!root) return [];
    return readStore(root).prompts;
}

export function getPrompt(projectRoot: string, id: string): PromptEntry | null {
    const root = resolveRoot(projectRoot);
    if (!root || typeof id !== 'string') return null;
    return readStore(root).prompts.find((p) => p.id === id) ?? null;
}

function sanitizeInput(input: PromptInput): {
    title: string; body: string; variables: PromptVariable[]; category: string; tags: string[]; favorite: boolean;
} | null {
    if (!input || typeof input !== 'object') return null;
    if (typeof input.title !== 'string' || typeof input.body !== 'string') return null;
    const variables = Array.isArray(input.variables) ? input.variables.filter(isVariable) : [];
    const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string') : [];
    return {
        title: input.title,
        body: input.body,
        variables,
        category: typeof input.category === 'string' && input.category.trim() ? input.category : 'General',
        tags,
        favorite: input.favorite === true,
    };
}

export function createPrompt(projectRoot: string, input: PromptInput): PromptEntry | null {
    const root = resolveRoot(projectRoot);
    if (!root) return null;
    const clean = sanitizeInput(input);
    if (!clean) return null;
    const store = readStore(root);
    const ts = nowIso();
    const entry: PromptEntry = { id: newId(), ...clean, createdAt: ts, updatedAt: ts };
    store.prompts.unshift(entry);
    return writeStore(root, store) ? entry : null;
}

export function updatePrompt(
    projectRoot: string,
    id: string,
    input: Partial<PromptInput>,
): PromptEntry | null {
    const root = resolveRoot(projectRoot);
    if (!root || typeof id !== 'string') return null;
    const store = readStore(root);
    const idx = store.prompts.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const cur = store.prompts[idx];
    const next: PromptEntry = {
        ...cur,
        title: typeof input.title === 'string' ? input.title : cur.title,
        body: typeof input.body === 'string' ? input.body : cur.body,
        variables: Array.isArray(input.variables) ? input.variables.filter(isVariable) : cur.variables,
        category: typeof input.category === 'string' && input.category.trim() ? input.category : cur.category,
        tags: Array.isArray(input.tags)
            ? input.tags.filter((t): t is string => typeof t === 'string')
            : cur.tags,
        favorite: typeof input.favorite === 'boolean' ? input.favorite : cur.favorite,
        updatedAt: nowIso(),
    };
    store.prompts[idx] = next;
    return writeStore(root, store) ? next : null;
}

export function deletePrompt(projectRoot: string, id: string): boolean {
    const root = resolveRoot(projectRoot);
    if (!root || typeof id !== 'string') return false;
    const store = readStore(root);
    const before = store.prompts.length;
    store.prompts = store.prompts.filter((p) => p.id !== id);
    if (store.prompts.length === before) return false;
    return writeStore(root, store);
}

export function toggleFavorite(projectRoot: string, id: string): PromptEntry | null {
    const cur = getPrompt(projectRoot, id);
    if (!cur) return null;
    return updatePrompt(projectRoot, id, { favorite: !cur.favorite });
}
