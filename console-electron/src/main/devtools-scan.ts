// console-electron/src/main/devtools-scan.ts
//
// Deterministic (no-AI) reader for the AI coding-tool config files in a repo.
// It DETECTS and PARSES the files each tool reads (Claude Code, Cursor, Copilot,
// Windsurf, Codex, Gemini) and returns one normalised shape per tool so the UI
// can show them side by side: permissions, MCP servers, hooks, and instruction
// bodies. Read-only and traversal-guarded; it only ever reads the enumerated
// config files, never arbitrary .env / credential files, and never returns a
// secret VALUE (env is reported as key names only).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';

export type ToolId = 'claude-code' | 'cursor' | 'copilot' | 'windsurf' | 'codex' | 'gemini-cli';

export type FileKind = 'memory' | 'settings' | 'rule' | 'command' | 'agent' | 'skill' | 'workflow';

export interface DetectedFile {
    relPath: string;
    kind: FileKind;
    format: 'json' | 'yaml-frontmatter' | 'markdown';
    scope: 'project' | 'local' | 'subtree';
    bytes: number;
    parseError?: string;
    parseWarning?: string;
}

export interface PermissionSet {
    allow: string[];
    ask: string[];
    deny: string[];
    defaultMode?: string;
    source: 'project' | 'local';
}

export interface McpServerEntry {
    name: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    envKeys?: string[];
}

export interface HookEntry {
    event: string;
    matcher?: string;
    command: string;
}

export interface InstructionDoc {
    relPath: string;
    kind: FileKind;
    title?: string;
    description?: string;
    globs?: string[];
    applyTo?: string;
    alwaysApply?: boolean;
    trigger?: string;
    model?: string;
    tools?: string[];
    body: string;
}

export interface DetectedToolConfig {
    tool: ToolId;
    present: boolean;
    files: DetectedFile[];
    permissions?: PermissionSet[];
    mcpServers?: McpServerEntry[];
    hooks?: HookEntry[];
    instructions?: InstructionDoc[];
    model?: string;
    env?: string[];
    errors?: string[];
}

export interface DevToolsScan {
    root: string;
    scannedAt: string;
    tools: DetectedToolConfig[];
    presentCount: number;
}

const MAX_BYTES = 256 * 1024;

function resolveRoot(input: string): string | null {
    if (typeof input !== 'string' || input.trim().length === 0) return null;
    const abs = path.resolve(input);
    try {
        if (!fs.statSync(abs).isDirectory()) return null;
    } catch {
        return null;
    }
    return abs;
}

function rel(root: string, file: string): string {
    return path.relative(root, file).replace(/\\/g, '/');
}

function exists(file: string): boolean {
    try { return fs.statSync(file).isFile(); } catch { return false; }
}

function read(file: string): string | null {
    try { return fs.readFileSync(file, 'utf8').slice(0, MAX_BYTES); } catch { return null; }
}

function bytesOf(file: string): number {
    try { return fs.statSync(file).size; } catch { return 0; }
}

// List files under a dir matching a predicate, bounded in depth + count.
function listFiles(dir: string, match: (name: string) => boolean, maxDepth = 4, cap = 200): string[] {
    const out: string[] = [];
    const walk = (d: string, depth: number) => {
        if (depth > maxDepth || out.length >= cap) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (out.length >= cap) return;
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full, depth + 1);
            else if (e.isFile() && match(e.name)) out.push(full);
        }
    };
    walk(dir, 0);
    return out;
}

function splitFrontmatter(text: string): { fm: Record<string, unknown> | null; body: string; warning?: string } {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (!m) return { fm: null, body: text, warning: 'no frontmatter' };
    try {
        const fm = YAML.parse(m[1]) as Record<string, unknown>;
        return { fm: fm && typeof fm === 'object' ? fm : null, body: m[2] };
    } catch {
        return { fm: null, body: m[2], warning: 'malformed frontmatter' };
    }
}

// Normalise a field that may be a comma-string or an array into string[].
function toList(v: unknown): string[] {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
}

function firstHeading(body: string): string | undefined {
    const m = /^#\s+(.+)$/m.exec(body);
    return m ? m[1].trim() : undefined;
}

// --- Claude Code ----------------------------------------------------------

function parseClaudeSettings(file: string, scope: 'project' | 'local', cfg: DetectedToolConfig, root: string): void {
    const raw = read(file);
    if (raw == null) return;
    const f: DetectedFile = { relPath: rel(root, file), kind: 'settings', format: 'json', scope, bytes: bytesOf(file) };
    cfg.files.push(f);
    let json: Record<string, unknown>;
    try { json = JSON.parse(raw) as Record<string, unknown>; } catch (err) {
        f.parseError = err instanceof Error ? err.message : 'invalid JSON';
        return;
    }
    const perms = json.permissions as Record<string, unknown> | undefined;
    if (perms && typeof perms === 'object') {
        (cfg.permissions ??= []).push({
            allow: toList(perms.allow),
            ask: toList(perms.ask),
            deny: toList(perms.deny),
            defaultMode: typeof perms.defaultMode === 'string' ? perms.defaultMode : undefined,
            source: scope,
        });
    }
    if (typeof json.model === 'string') cfg.model = json.model;
    const env = json.env as Record<string, unknown> | undefined;
    if (env && typeof env === 'object') cfg.env = [...(cfg.env ?? []), ...Object.keys(env)];
    const mcp = json.mcpServers as Record<string, unknown> | undefined;
    if (mcp && typeof mcp === 'object') {
        cfg.mcpServers ??= [];
        for (const [name, sv] of Object.entries(mcp)) {
            const s = sv as Record<string, unknown>;
            const url = typeof s.url === 'string' ? s.url : undefined;
            const transport = s.type === 'http' || s.type === 'sse' ? s.type : url ? 'http' : 'stdio';
            cfg.mcpServers.push({
                name,
                transport: transport as McpServerEntry['transport'],
                command: typeof s.command === 'string' ? s.command : undefined,
                args: toList(s.args),
                url,
                envKeys: s.env && typeof s.env === 'object' ? Object.keys(s.env as object) : undefined,
            });
        }
    }
    const hooks = json.hooks as Record<string, unknown> | undefined;
    if (hooks && typeof hooks === 'object') {
        cfg.hooks ??= [];
        for (const [event, arr] of Object.entries(hooks)) {
            if (!Array.isArray(arr)) continue;
            for (const grp of arr) {
                const g = grp as Record<string, unknown>;
                const matcher = typeof g.matcher === 'string' ? g.matcher : undefined;
                for (const h of toHookList(g.hooks)) cfg.hooks.push({ event, matcher, command: h });
            }
        }
    }
}

function toHookList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((h) => (h && typeof h === 'object' && typeof (h as Record<string, unknown>).command === 'string'
        ? (h as Record<string, string>).command : '')).filter(Boolean);
}

function pushInstructionFile(
    cfg: DetectedToolConfig, root: string, file: string, kind: FileKind,
    scope: DetectedFile['scope'], extra?: Partial<InstructionDoc>,
): void {
    const raw = read(file);
    if (raw == null) return;
    const { fm, body, warning } = kind === 'memory' || kind === 'command'
        ? splitFrontmatterSoft(raw)
        : splitFrontmatter(raw);
    const f: DetectedFile = {
        relPath: rel(root, file), kind,
        format: fm ? 'yaml-frontmatter' : 'markdown',
        scope, bytes: bytesOf(file), parseWarning: fm ? undefined : warning,
    };
    cfg.files.push(f);
    const doc: InstructionDoc = {
        relPath: f.relPath,
        kind,
        title: (fm && typeof fm.name === 'string' ? fm.name : undefined) ?? firstHeading(body) ?? path.basename(file),
        description: fm && typeof fm.description === 'string' ? fm.description : undefined,
        globs: fm ? toList(fm.globs) : undefined,
        applyTo: fm && typeof fm.applyTo === 'string' ? fm.applyTo : undefined,
        alwaysApply: fm && typeof fm.alwaysApply === 'boolean' ? fm.alwaysApply : undefined,
        trigger: fm && typeof fm.trigger === 'string' ? fm.trigger : undefined,
        model: fm && typeof fm.model === 'string' ? fm.model : undefined,
        tools: fm ? toList(fm.tools) : undefined,
        body: body.trim(),
        ...extra,
    };
    (cfg.instructions ??= []).push(doc);
}

// Memory/command files often have no frontmatter; treat the whole file as body.
function splitFrontmatterSoft(text: string): { fm: Record<string, unknown> | null; body: string; warning?: string } {
    if (!/^---\r?\n/.test(text)) return { fm: null, body: text };
    return splitFrontmatter(text);
}

function scanClaude(root: string): DetectedToolConfig {
    const cfg: DetectedToolConfig = { tool: 'claude-code', present: false, files: [] };
    for (const [p, scope] of [['CLAUDE.md', 'project'], ['.claude/CLAUDE.md', 'project'], ['CLAUDE.local.md', 'local']] as const) {
        const file = path.join(root, p);
        if (exists(file)) pushInstructionFile(cfg, root, file, 'memory', scope);
    }
    for (const [p, scope] of [['.claude/settings.json', 'project'], ['.claude/settings.local.json', 'local']] as const) {
        const file = path.join(root, p);
        if (exists(file)) parseClaudeSettings(file, scope, cfg, root);
    }
    for (const file of listFiles(path.join(root, '.claude', 'commands'), (n) => n.endsWith('.md')))
        pushInstructionFile(cfg, root, file, 'command', 'project');
    for (const file of listFiles(path.join(root, '.claude', 'agents'), (n) => n.endsWith('.md')))
        pushInstructionFile(cfg, root, file, 'agent', 'project');
    for (const file of listFiles(path.join(root, '.claude', 'skills'), (n) => n === 'SKILL.md'))
        pushInstructionFile(cfg, root, file, 'skill', 'project');
    cfg.present = cfg.files.length > 0;
    return cfg;
}

// --- Cursor ---------------------------------------------------------------

function scanCursor(root: string): DetectedToolConfig {
    const cfg: DetectedToolConfig = { tool: 'cursor', present: false, files: [] };
    for (const file of listFiles(path.join(root, '.cursor', 'rules'), (n) => n.endsWith('.mdc')))
        pushInstructionFile(cfg, root, file, 'rule', 'project');
    const legacy = path.join(root, '.cursorrules');
    if (exists(legacy)) pushInstructionFile(cfg, root, legacy, 'rule', 'project');
    cfg.present = cfg.files.length > 0;
    return cfg;
}

// --- Copilot --------------------------------------------------------------

function scanCopilot(root: string): DetectedToolConfig {
    const cfg: DetectedToolConfig = { tool: 'copilot', present: false, files: [] };
    const main = path.join(root, '.github', 'copilot-instructions.md');
    if (exists(main)) pushInstructionFile(cfg, root, main, 'memory', 'project');
    for (const file of listFiles(path.join(root, '.github', 'instructions'), (n) => n.endsWith('.instructions.md')))
        pushInstructionFile(cfg, root, file, 'rule', 'project');
    cfg.present = cfg.files.length > 0;
    return cfg;
}

// --- Windsurf -------------------------------------------------------------

function scanWindsurf(root: string): DetectedToolConfig {
    const cfg: DetectedToolConfig = { tool: 'windsurf', present: false, files: [] };
    for (const file of listFiles(path.join(root, '.windsurf', 'rules'), (n) => n.endsWith('.md')))
        pushInstructionFile(cfg, root, file, 'rule', 'project');
    for (const file of listFiles(path.join(root, '.windsurf', 'workflows'), (n) => n.endsWith('.md')))
        pushInstructionFile(cfg, root, file, 'workflow', 'project');
    const legacy = path.join(root, '.windsurfrules');
    if (exists(legacy)) pushInstructionFile(cfg, root, legacy, 'rule', 'project');
    cfg.present = cfg.files.length > 0;
    return cfg;
}

// --- Codex ----------------------------------------------------------------

function scanCodex(root: string): DetectedToolConfig {
    const cfg: DetectedToolConfig = { tool: 'codex', present: false, files: [] };
    const main = path.join(root, 'AGENTS.md');
    if (exists(main)) pushInstructionFile(cfg, root, main, 'memory', 'project');
    cfg.present = cfg.files.length > 0;
    return cfg;
}

// --- Gemini ---------------------------------------------------------------

function scanGemini(root: string): DetectedToolConfig {
    const cfg: DetectedToolConfig = { tool: 'gemini-cli', present: false, files: [] };
    const main = path.join(root, 'GEMINI.md');
    if (exists(main)) pushInstructionFile(cfg, root, main, 'memory', 'project');
    const settings = path.join(root, '.gemini', 'settings.json');
    if (exists(settings)) {
        const raw = read(settings);
        const f: DetectedFile = { relPath: rel(root, settings), kind: 'settings', format: 'json', scope: 'project', bytes: bytesOf(settings) };
        cfg.files.push(f);
        if (raw != null) {
            try {
                const json = JSON.parse(raw) as Record<string, unknown>;
                if (typeof json.model === 'string') cfg.model = json.model;
                const mcp = json.mcpServers as Record<string, unknown> | undefined;
                if (mcp && typeof mcp === 'object') {
                    cfg.mcpServers = Object.entries(mcp).map(([name, sv]) => {
                        const s = sv as Record<string, unknown>;
                        return {
                            name,
                            transport: (typeof s.url === 'string' ? 'http' : 'stdio') as McpServerEntry['transport'],
                            command: typeof s.command === 'string' ? s.command : undefined,
                            args: toList(s.args),
                            url: typeof s.url === 'string' ? s.url : undefined,
                        };
                    });
                }
            } catch (err) {
                f.parseError = err instanceof Error ? err.message : 'invalid JSON';
            }
        }
    }
    cfg.present = cfg.files.length > 0;
    return cfg;
}

export function scanDevtools(projectRoot: string): DevToolsScan {
    const root = resolveRoot(projectRoot);
    const scannedAt = new Date().toISOString();
    if (!root) return { root: '', scannedAt, tools: [], presentCount: 0 };
    const tools = [scanClaude(root), scanCursor(root), scanCopilot(root), scanWindsurf(root), scanCodex(root), scanGemini(root)];
    return { root, scannedAt, tools, presentCount: tools.filter((t) => t.present).length };
}
