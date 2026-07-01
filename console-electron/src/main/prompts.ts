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
import { BUILTIN_PROMPTS } from './prompts-catalog';

export type PromptVariableType = 'text' | 'multiline' | 'select';

export interface PromptVariable {
    name: string;
    type: PromptVariableType;
    label: string;
    options?: string[];
    default?: string;
    // A hint shown inside the empty field (not a prefilled value).
    placeholder?: string;
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
    // 'builtin' = curated, read-only, shipped in code. 'user' = in prompts.json.
    source: 'builtin' | 'user';
    // One-line "what it does / when to use", shown in the detail (built-ins).
    whatWhen?: string;
}

export interface PromptStore {
    version: number;
    prompts: PromptEntry[];
    // Built-in ids the user marked favorite (built-ins are read-only code, so
    // their favorite state lives here, not on the entry).
    builtinFavorites: string[];
}

export interface PromptInput {
    title: string;
    body: string;
    variables?: PromptVariable[];
    category?: string;
    tags?: string[];
    favorite?: boolean;
}

const STORE_VERSION = 2;
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

// The everyday-ask prompts that used to seed prompts.json now ship in code as
// the read-only BUILTIN_PROMPTS catalog (prompts-catalog.ts), merged into the
// list at read time. The per-project store holds ONLY user-authored prompts.

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
        // Everything persisted in prompts.json is user-authored; built-ins are
        // never written there.
        source: 'user',
        whatWhen: typeof o.whatWhen === 'string' ? o.whatWhen : undefined,
    };
}

function readStore(root: string): PromptStore {
    const file = storePath(root);
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as PromptStore).prompts)) {
            const p = parsed as Partial<PromptStore>;
            const prompts = (p.prompts ?? [])
                .map(coerceEntry)
                .filter((e): e is PromptEntry => e !== null);
            const builtinFavorites = Array.isArray(p.builtinFavorites)
                ? p.builtinFavorites.filter((s): s is string => typeof s === 'string')
                : [];
            return { version: STORE_VERSION, prompts, builtinFavorites };
        }
    } catch {
        // Missing or corrupt file: start from an empty user store. The built-in
        // catalog is merged in at list time, so there is nothing to seed; we do
        // not write a file until the user adds a prompt or favourites a built-in.
    }
    return { version: STORE_VERSION, prompts: [], builtinFavorites: [] };
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

// The curated catalog with the user's per-project favourite state applied.
function builtinsFor(store: PromptStore): PromptEntry[] {
    const favs = new Set(store.builtinFavorites);
    return BUILTIN_PROMPTS.map((p) => (favs.has(p.id) ? { ...p, favorite: true } : p));
}

export function listPrompts(projectRoot: string): PromptEntry[] {
    const root = resolveRoot(projectRoot);
    if (!root) return BUILTIN_PROMPTS;
    const store = readStore(root);
    // The user's own prompts first, then the curated catalog.
    return [...store.prompts, ...builtinsFor(store)];
}

export function getPrompt(projectRoot: string, id: string): PromptEntry | null {
    if (typeof id !== 'string') return null;
    const builtin = BUILTIN_PROMPTS.find((p) => p.id === id);
    const root = resolveRoot(projectRoot);
    if (!root) return builtin ?? null;
    const store = readStore(root);
    if (builtin) {
        return store.builtinFavorites.includes(id) ? { ...builtin, favorite: true } : builtin;
    }
    return store.prompts.find((p) => p.id === id) ?? null;
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
    const entry: PromptEntry = { id: newId(), ...clean, createdAt: ts, updatedAt: ts, source: 'user' };
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
    const root = resolveRoot(projectRoot);
    if (!root || typeof id !== 'string') return null;
    // Built-ins are read-only code, so their favourite state lives in the store's
    // builtinFavorites list rather than on the entry.
    const builtin = BUILTIN_PROMPTS.find((p) => p.id === id);
    if (builtin) {
        const store = readStore(root);
        const set = new Set(store.builtinFavorites);
        const nowFav = !set.has(id);
        if (nowFav) set.add(id); else set.delete(id);
        store.builtinFavorites = [...set];
        if (!writeStore(root, store)) return null;
        return { ...builtin, favorite: nowFav };
    }
    const cur = getPrompt(projectRoot, id);
    if (!cur) return null;
    return updatePrompt(projectRoot, id, { favorite: !cur.favorite });
}
