// console-electron/src/main/devsessions.ts
//
// Read-only import of the user's own local AI coding-tool history, so a good
// prompt typed into Claude Code (or a plan it produced) can become a reusable
// Console library prompt. Everything here is local + read-only: nothing is
// written back to the tool's files, nothing is uploaded, and the cleaner never
// keeps the secret/path values it strips.
//
// Claude Code, Codex CLI, and VS Code Copilot are plain JSONL/JSON and link to a
// project by an encoded cwd or a workspace folder URI. Cursor stores its prompts
// in a SQLite db, read best-effort via node:sqlite (skipped if unavailable).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PromptVariable } from './prompts';

export type DevTool = 'claude-code' | 'codex' | 'copilot' | 'cursor';

export interface DevSession {
    tool: DevTool;
    id: string;
    title: string;
    path: string;
    turns: number;
    lastAt: string;
}

export interface DevTurn {
    role: 'user' | 'assistant';
    text: string;
    at: string;
}

export interface DevPlan {
    title: string;
    body: string;
}

export interface CleanedPrompt {
    body: string;
    variables: PromptVariable[];
}

// Claude encodes a project cwd into its dir name by replacing EACH
// non-alphanumeric char with a dash (so c:/X/Dev_Files -> c--X-Dev-Files); the
// drive-letter case can differ, so match case-insensitively.
function encodeCwd(root: string): string {
    return root.replace(/[^a-zA-Z0-9]/g, '-');
}

function claudeProjectsDir(): string {
    return path.join(os.homedir(), '.claude', 'projects');
}

function readLines(file: string): unknown[] {
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
    const out: unknown[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try { out.push(JSON.parse(t)); } catch { /* skip a garbage line */ }
    }
    return out;
}

// IDE-injected scaffolding (opened-file notices, hook output, reminders) is not
// a real user prompt, so it is skipped for titles and the import picker.
export function isScaffold(text: string): boolean {
    const t = text.trimStart();
    return /^<(ide_|system-reminder|command-|local-command|user-prompt-submit|persisted|session-start)/.test(t)
        || t.startsWith('Caveat:')
        || t.startsWith('[Request interrupted');
}

// The text of one transcript line: a plain-string content, or the concatenated
// text blocks of a block list (thinking / tool_use / tool_result are dropped).
function lineText(obj: Record<string, unknown>): string {
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) return '';
    const content = msg.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const parts: string[] = [];
    for (const b of content) {
        if (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text') {
            const t = (b as Record<string, unknown>).text;
            if (typeof t === 'string') parts.push(t);
        }
    }
    return parts.join('\n').trim();
}

// The project's Claude session dirs: the encoded-cwd match, plus any dir whose
// lines carry a matching cwd (the encoding can drift on drive-letter case).
function sessionDirsFor(root: string): string[] {
    const base = claudeProjectsDir();
    let entries: string[];
    try { entries = fs.readdirSync(base); } catch { return []; }
    const want = encodeCwd(root).toLowerCase();
    const out: string[] = [];
    for (const e of entries) {
        if (e.toLowerCase() === want) out.push(path.join(base, e));
    }
    return out;
}

export function listClaudeSessions(root: string): DevSession[] {
    if (!root) return [];
    const sessions: DevSession[] = [];
    for (const dir of sessionDirsFor(root)) {
        let files: string[];
        try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
        for (const f of files) {
            const full = path.join(dir, f);
            const lines = readLines(full);
            let title = '';
            let turns = 0;
            let firstUser = '';
            for (const ln of lines) {
                const o = ln as Record<string, unknown>;
                if (o.type === 'ai-title' && typeof o.title === 'string') title = o.title;
                if (o.type === 'user' || o.type === 'assistant') {
                    turns += 1;
                    if (o.type === 'user' && !firstUser) {
                        const t = lineText(o);
                        if (t && !isScaffold(t)) firstUser = t.slice(0, 80);
                    }
                }
            }
            if (turns === 0) continue; // an IDE-launch stub, not a real session
            let lastAt = '';
            try { lastAt = fs.statSync(full).mtime.toISOString(); } catch { /* keep empty */ }
            sessions.push({
                tool: 'claude-code',
                id: f.replace(/\.jsonl$/, ''),
                title: (title && !isScaffold(title) ? title : '') || firstUser || 'Untitled session',
                path: full,
                turns,
                lastAt,
            });
        }
    }
    sessions.sort((a, b) => (b.lastAt < a.lastAt ? -1 : 1));
    return sessions;
}

export function readClaudeSession(file: string): { turns: DevTurn[]; plans: DevPlan[] } {
    const turns: DevTurn[] = [];
    const plans: DevPlan[] = [];
    for (const ln of readLines(file)) {
        const o = ln as Record<string, unknown>;
        const at = typeof o.timestamp === 'string' ? o.timestamp : '';
        if (o.type === 'user' || o.type === 'assistant') {
            const text = lineText(o);
            if (text) turns.push({ role: o.type as 'user' | 'assistant', text, at });
        }
        // Inline plan: an assistant ExitPlanMode tool_use carries the markdown.
        const msg = o.message as Record<string, unknown> | undefined;
        const content = msg?.content;
        if (Array.isArray(content)) {
            for (const b of content) {
                const blk = b as Record<string, unknown>;
                if (blk?.type === 'tool_use' && blk.name === 'ExitPlanMode') {
                    const input = blk.input as Record<string, unknown> | undefined;
                    if (input && typeof input.plan === 'string' && input.plan.trim()) {
                        const firstLine = input.plan.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);
                        plans.push({ title: firstLine || 'Plan', body: input.plan.trim() });
                    }
                }
            }
        }
    }
    return { turns, plans };
}

// --- shared path matching ---------------------------------------------------

function normPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function matchesRoot(cwd: string, root: string): boolean {
    return Boolean(cwd) && normPath(cwd) === normPath(root);
}
function appDataDir(): string {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

// --- Codex CLI (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) ----------------

function codexText(payload: Record<string, unknown>): string {
    const content = payload.content;
    if (!Array.isArray(content)) return '';
    return content
        .filter((b) => b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string')
        .map((b) => (b as Record<string, unknown>).text as string)
        .join('\n')
        .trim();
}

function walkCodexFiles(base: string, cap: number): string[] {
    const out: string[] = [];
    const stack: string[] = [base];
    while (stack.length > 0 && out.length < cap) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            if (e.isDirectory()) stack.push(path.join(dir, e.name));
            else if (e.name.endsWith('.jsonl')) out.push(path.join(dir, e.name));
        }
    }
    return out;
}

export function listCodexSessions(root: string): DevSession[] {
    const base = path.join(os.homedir(), '.codex', 'sessions');
    const out: DevSession[] = [];
    for (const f of walkCodexFiles(base, 3000)) {
        const lines = readLines(f);
        if (lines.length === 0) continue;
        const meta = lines[0] as Record<string, unknown>;
        const cwd = (meta.payload as Record<string, unknown> | undefined)?.cwd;
        if (typeof cwd !== 'string' || !matchesRoot(cwd, root)) continue;
        let turns = 0;
        let firstUser = '';
        for (const ln of lines) {
            const o = ln as Record<string, unknown>;
            const payload = o.payload as Record<string, unknown> | undefined;
            if (o.type === 'response_item' && payload?.type === 'message') {
                turns += 1;
                if (payload.role === 'user' && !firstUser) {
                    const t = codexText(payload);
                    if (t && !isScaffold(t) && !/<environment_context>|<permissions/.test(t)) firstUser = t.slice(0, 80);
                }
            }
        }
        if (turns === 0) continue;
        let lastAt = '';
        try { lastAt = fs.statSync(f).mtime.toISOString(); } catch { /* keep empty */ }
        out.push({ tool: 'codex', id: path.basename(f, '.jsonl'), title: firstUser || 'Codex session', path: f, turns, lastAt });
    }
    return out;
}

function readCodexSession(file: string): { turns: DevTurn[]; plans: DevPlan[] } {
    const turns: DevTurn[] = [];
    for (const ln of readLines(file)) {
        const o = ln as Record<string, unknown>;
        const payload = o.payload as Record<string, unknown> | undefined;
        if (o.type === 'response_item' && payload?.type === 'message') {
            const role = payload.role === 'assistant' ? 'assistant' : 'user';
            const text = codexText(payload);
            if (text && !/<environment_context>|<permissions/.test(text)) {
                turns.push({ role, text, at: typeof o.timestamp === 'string' ? o.timestamp : '' });
            }
        }
    }
    return { turns, plans: [] };
}

// --- VS Code workspaces (Copilot chat) + Cursor share workspaceStorage ------

function decodeFolderUri(uri: string): string {
    let p = uri.replace(/^file:\/\/\//, '');
    try { p = decodeURIComponent(p); } catch { /* keep raw */ }
    return p;
}

function vscodeWorkspacesMatching(base: string, root: string): string[] {
    let dirs: string[];
    try { dirs = fs.readdirSync(base); } catch { return []; }
    const out: string[] = [];
    for (const d of dirs) {
        try {
            const wj = JSON.parse(fs.readFileSync(path.join(base, d, 'workspace.json'), 'utf8')) as { folder?: unknown };
            const folder = typeof wj.folder === 'string' ? decodeFolderUri(wj.folder) : '';
            if (matchesRoot(folder, root)) out.push(path.join(base, d));
        } catch { /* no workspace.json or unreadable */ }
    }
    return out;
}

export function listCopilotSessions(root: string): DevSession[] {
    const base = path.join(appDataDir(), 'Code', 'User', 'workspaceStorage');
    const out: DevSession[] = [];
    for (const wsDir of vscodeWorkspacesMatching(base, root)) {
        const chatDir = path.join(wsDir, 'chatSessions');
        let files: string[];
        try { files = fs.readdirSync(chatDir).filter((f) => f.endsWith('.json')); } catch { continue; }
        for (const f of files) {
            const full = path.join(chatDir, f);
            let data: { requests?: unknown[]; customTitle?: unknown };
            try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
            const requests = Array.isArray(data.requests) ? data.requests : [];
            if (requests.length === 0) continue;
            const first = requests.find((r) => typeof (r as Record<string, unknown>)?.message === 'object');
            const firstText = first ? String(((first as Record<string, unknown>).message as Record<string, unknown>)?.text ?? '') : '';
            let lastAt = '';
            try { lastAt = fs.statSync(full).mtime.toISOString(); } catch { /* keep empty */ }
            out.push({
                tool: 'copilot',
                id: f.replace(/\.json$/, ''),
                title: (typeof data.customTitle === 'string' && data.customTitle) || firstText.slice(0, 80) || 'Copilot session',
                path: full,
                turns: requests.length,
                lastAt,
            });
        }
    }
    return out;
}

function readCopilotSession(file: string): { turns: DevTurn[]; plans: DevPlan[] } {
    const turns: DevTurn[] = [];
    let data: { requests?: unknown[] };
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { turns, plans: [] }; }
    for (const r of Array.isArray(data.requests) ? data.requests : []) {
        const req = r as Record<string, unknown>;
        const userText = String((req.message as Record<string, unknown> | undefined)?.text ?? '').trim();
        if (userText) turns.push({ role: 'user', text: userText, at: '' });
        const resp = Array.isArray(req.response) ? req.response : [];
        const aText = resp.map((b) => String((b as Record<string, unknown>)?.value ?? '')).join('').trim();
        if (aText) turns.push({ role: 'assistant', text: aText, at: '' });
    }
    return { turns, plans: [] };
}

// --- Cursor (state.vscdb, SQLite, best-effort via node:sqlite) --------------

function readCursorPrompts(vscdbPath: string): DevTurn[] {
    try {
        // node:sqlite is experimental and may be absent in some Node builds; the
        // whole read is best-effort, so a failure just yields no Cursor prompts.
        const sqlite = require('node:sqlite') as { DatabaseSync: new (p: string, o?: unknown) => { prepare(q: string): { get(): unknown }; close(): void } };
        const tmp = path.join(os.tmpdir(), `cursor-${process.pid}-${Math.round(fs.statSync(vscdbPath).mtimeMs)}.vscdb`);
        fs.copyFileSync(vscdbPath, tmp); // Cursor locks the live db; read a copy
        const db = new sqlite.DatabaseSync(tmp, { readonly: true });
        let value: unknown;
        try {
            const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'aiService.prompts'").get() as { value?: unknown } | undefined;
            value = row?.value;
        } finally {
            db.close();
            try { fs.unlinkSync(tmp); } catch { /* best effort */ }
        }
        if (typeof value !== 'string') return [];
        const arr = JSON.parse(value) as Array<{ text?: unknown }>;
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((p) => p && typeof p.text === 'string' && p.text.trim().length > 0)
            .map((p) => ({ role: 'user' as const, text: p.text as string, at: '' }));
    } catch {
        return [];
    }
}

export function listCursorSessions(root: string): DevSession[] {
    const base = path.join(appDataDir(), 'Cursor', 'User', 'workspaceStorage');
    const out: DevSession[] = [];
    for (const wsDir of vscodeWorkspacesMatching(base, root)) {
        const vscdb = path.join(wsDir, 'state.vscdb');
        if (!fs.existsSync(vscdb)) continue;
        const prompts = readCursorPrompts(vscdb);
        if (prompts.length === 0) continue;
        let lastAt = '';
        try { lastAt = fs.statSync(vscdb).mtime.toISOString(); } catch { /* keep empty */ }
        out.push({
            tool: 'cursor',
            id: path.basename(wsDir),
            title: prompts[0]?.text.slice(0, 80) || 'Cursor prompts',
            path: vscdb,
            turns: prompts.length,
            lastAt,
        });
    }
    return out;
}

// --- unified aggregator + dispatcher ----------------------------------------

export function listSessions(root: string): DevSession[] {
    if (!root) return [];
    const all: DevSession[] = [];
    for (const fn of [listClaudeSessions, listCodexSessions, listCopilotSessions, listCursorSessions]) {
        try { all.push(...fn(root)); } catch { /* one tool failing must not break the rest */ }
    }
    all.sort((a, b) => (b.lastAt < a.lastAt ? -1 : 1));
    return all;
}

export function readSession(file: string): { turns: DevTurn[]; plans: DevPlan[] } {
    const n = normPath(file);
    if (n.includes('/.codex/')) return readCodexSession(file);
    if (n.endsWith('state.vscdb')) return { turns: readCursorPrompts(file), plans: [] };
    if (n.includes('/code/user/workspacestorage/')) return readCopilotSession(file);
    return readClaudeSession(file);
}

// Secret shapes redacted before any captured text is reused. The values are
// replaced in place and never stored.
const SECRET_PATTERNS: RegExp[] = [
    /sk-ant-[A-Za-z0-9_-]{16,}/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /ghp_[A-Za-z0-9]{30,}/g,
    /gh[osu]_[A-Za-z0-9]{30,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /AIza[0-9A-Za-z_-]{35}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
    /\bBearer\s+[A-Za-z0-9._-]{16,}/gi,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email
];

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VAR_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

// Turn a captured chunk of chat/plan text into a reusable template: redact
// secrets, de-personalize the home dir, parameterize the project path as
// {{project}}, and return the {{vars}} found so the editor can refine them.
export function cleanPromptText(text: string, projectRoot?: string): CleanedPrompt {
    let body = text;
    for (const re of SECRET_PATTERNS) body = body.replace(re, '[redacted]');

    if (projectRoot) {
        for (const variant of [projectRoot, projectRoot.replace(/\//g, '\\'), projectRoot.replace(/\\/g, '/')]) {
            if (variant) body = body.replace(new RegExp(escapeRe(variant), 'g'), '{{project}}');
        }
    }
    const home = os.homedir();
    for (const variant of [home, home.replace(/\//g, '\\'), home.replace(/\\/g, '/')]) {
        if (variant) body = body.replace(new RegExp(escapeRe(variant), 'g'), '~');
    }

    const names = new Set<string>();
    let m: RegExpExecArray | null;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(body)) !== null) names.add(m[1]);
    const variables: PromptVariable[] = [...names].map((name) => ({
        name,
        type: 'text',
        label: name.replace(/[_.-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));
    return { body: body.trim(), variables };
}
