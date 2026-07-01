// console-electron/src/main/ai-config.ts
//
// Deterministic detection and parsing of AI coding-tool config files in a repo.
// No network. No secrets returned (env values omitted; only key names).
//
// Supported tools:
//   Claude Code  - CLAUDE.md, .claude/settings.json, .claude/settings.local.json,
//                  .claude/commands/*.md, .claude/agents/*.md, .claude/skills/*/SKILL.md
//   Cursor       - .cursor/rules/*.mdc (+ frontmatter), .cursorrules (legacy)
//   Copilot      - .github/copilot-instructions.md, .github/instructions/*.instructions.md
//   Windsurf     - .windsurf/rules/, .windsurfrules
//   Codex        - AGENTS.md
//   Gemini       - GEMINI.md
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type AiTool =
    | 'claude-code'
    | 'cursor'
    | 'copilot'
    | 'windsurf'
    | 'codex'
    | 'gemini';

export interface AiToolConfig {
    tool: AiTool;
    present: boolean;
    files: string[];
    // Claude Code only
    permissions?: { allow: string[]; deny: string[]; ask: string[] };
    mcpServers?: string[];
    model?: string;
    commandCount?: number;
    agentCount?: number;
    skillNames?: string[];
    // File size in bytes for instruction files (Copilot, Cursor, Windsurf rules)
    instructionsBytes?: number;
}

export interface AiConfigReport {
    ok: boolean;
    tools: AiToolConfig[];
    error?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function safeReadText(filePath: string): string | null {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return null;
        if (stat.size > 2 * 1024 * 1024) return null; // skip files > 2 MB
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function isFile(p: string): boolean {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function listFiles(dir: string, ext?: string): string[] {
    if (!isDir(dir)) return [];
    try {
        return fs.readdirSync(dir)
            .filter((f) => ext ? f.endsWith(ext) : true)
            .map((f) => path.join(dir, f))
            .filter(isFile);
    } catch {
        return [];
    }
}

function listSubdirFiles(dir: string, filename: string): string[] {
    if (!isDir(dir)) return [];
    const results: string[] = [];
    try {
        for (const entry of fs.readdirSync(dir)) {
            const sub = path.join(dir, entry);
            if (isDir(sub)) {
                const target = path.join(sub, filename);
                if (isFile(target)) results.push(target);
            }
        }
    } catch { /* ignore */ }
    return results;
}

// Minimal JSON parse that never throws.
function tryParseJson(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
}

// Extract YAML-style frontmatter from a .mdc or .md file.
// Returns null if none present; otherwise the raw frontmatter string.
function extractFrontmatter(text: string): string | null {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : null;
}

// Sum byte sizes of files that exist.
function totalBytes(files: string[]): number {
    let total = 0;
    for (const f of files) {
        try { total += fs.statSync(f).size; } catch { /* ignore */ }
    }
    return total;
}

// ── Claude Code parser ────────────────────────────────────────────────────────

interface ClaudePermissions {
    allow: string[];
    deny: string[];
    ask: string[];
}

function parseClaudeSettings(settingsPath: string): {
    permissions: ClaudePermissions;
    mcpServers: string[];
    model?: string;
    hooks: string[];
    envKeys: string[];
} {
    const empty: ClaudePermissions = { allow: [], deny: [], ask: [] };
    const text = safeReadText(settingsPath);
    if (!text) return { permissions: empty, mcpServers: [], hooks: [] , envKeys: [] };

    const obj = tryParseJson(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { permissions: empty, mcpServers: [], hooks: [], envKeys: [] };
    }

    const raw = obj as Record<string, unknown>;

    // permissions
    const perms = raw['permissions'];
    const allow: string[] = [];
    const deny: string[] = [];
    const ask: string[] = [];
    if (perms && typeof perms === 'object' && !Array.isArray(perms)) {
        const p = perms as Record<string, unknown>;
        if (Array.isArray(p['allow'])) allow.push(...p['allow'].filter((x): x is string => typeof x === 'string'));
        if (Array.isArray(p['deny']))  deny.push(...p['deny'].filter((x): x is string => typeof x === 'string'));
        if (Array.isArray(p['ask']))   ask.push(...p['ask'].filter((x): x is string => typeof x === 'string'));
    }

    // mcpServers - collect names only
    const mcpServers: string[] = [];
    const mcp = raw['mcpServers'];
    if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
        mcpServers.push(...Object.keys(mcp as object));
    }

    // model
    let model: string | undefined;
    if (typeof raw['model'] === 'string' && raw['model'].length > 0) {
        model = raw['model'];
    }

    // hooks - collect top-level keys (e.g. PreToolUse, PostToolUse)
    const hooks: string[] = [];
    const hooksRaw = raw['hooks'];
    if (hooksRaw && typeof hooksRaw === 'object' && !Array.isArray(hooksRaw)) {
        hooks.push(...Object.keys(hooksRaw as object));
    }

    // env - key names only, no values
    const envKeys: string[] = [];
    const envRaw = raw['env'];
    if (envRaw && typeof envRaw === 'object' && !Array.isArray(envRaw)) {
        envKeys.push(...Object.keys(envRaw as object));
    }

    return { permissions: { allow, deny, ask }, mcpServers, model, hooks, envKeys };
}

function detectClaudeCode(root: string): AiToolConfig {
    const found: string[] = [];
    const tool: AiTool = 'claude-code';

    const claudeMd = path.join(root, 'CLAUDE.md');
    if (isFile(claudeMd)) found.push(claudeMd);

    const clauDir = path.join(root, '.claude');
    const settingsJson = path.join(clauDir, 'settings.json');
    const settingsLocal = path.join(clauDir, 'settings.local.json');
    const commandsDir = path.join(clauDir, 'commands');
    const agentsDir = path.join(clauDir, 'agents');
    const skillsDir = path.join(clauDir, 'skills');

    if (isFile(settingsJson)) found.push(settingsJson);
    if (isFile(settingsLocal)) found.push(settingsLocal);

    const commandFiles = listFiles(commandsDir, '.md');
    const agentFiles = listFiles(agentsDir, '.md');
    const skillMds = listSubdirFiles(skillsDir, 'SKILL.md');

    found.push(...commandFiles, ...agentFiles, ...skillMds);

    const present = found.length > 0;
    if (!present) {
        return { tool, present: false, files: [] };
    }

    // Merge settings from settings.json (primary) and settings.local.json (override)
    const base = parseClaudeSettings(settingsJson);
    const local = parseClaudeSettings(settingsLocal);

    const permissions: ClaudePermissions = {
        allow: [...base.permissions.allow, ...local.permissions.allow],
        deny:  [...base.permissions.deny,  ...local.permissions.deny],
        ask:   [...base.permissions.ask,   ...local.permissions.ask],
    };
    const mcpServers = Array.from(new Set([...base.mcpServers, ...local.mcpServers]));
    const model = local.model ?? base.model;

    const skillNames: string[] = [];
    for (const md of skillMds) {
        // skill name = parent directory name
        skillNames.push(path.basename(path.dirname(md)));
    }

    return {
        tool,
        present: true,
        files: found,
        permissions,
        mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
        model,
        commandCount: commandFiles.length,
        agentCount: agentFiles.length,
        skillNames: skillNames.length > 0 ? skillNames : undefined,
    };
}

// ── Cursor parser ─────────────────────────────────────────────────────────────

function detectCursor(root: string): AiToolConfig {
    const found: string[] = [];
    const tool: AiTool = 'cursor';

    const legacyRules = path.join(root, '.cursorrules');
    if (isFile(legacyRules)) found.push(legacyRules);

    const mdcFiles = listFiles(path.join(root, '.cursor', 'rules'), '.mdc');
    found.push(...mdcFiles);

    const present = found.length > 0;
    if (!present) return { tool, present: false, files: [] };

    let instructionsBytes = 0;
    instructionsBytes += totalBytes([legacyRules]);
    instructionsBytes += totalBytes(mdcFiles);

    return { tool, present: true, files: found, instructionsBytes };
}

// ── Copilot parser ────────────────────────────────────────────────────────────

function detectCopilot(root: string): AiToolConfig {
    const found: string[] = [];
    const tool: AiTool = 'copilot';

    const ghDir = path.join(root, '.github');
    const main = path.join(ghDir, 'copilot-instructions.md');
    if (isFile(main)) found.push(main);

    const instrFiles = listFiles(path.join(ghDir, 'instructions'), '.instructions.md');
    found.push(...instrFiles);

    const present = found.length > 0;
    if (!present) return { tool, present: false, files: [] };

    return { tool, present: true, files: found, instructionsBytes: totalBytes(found) };
}

// ── Windsurf parser ───────────────────────────────────────────────────────────

function detectWindsurf(root: string): AiToolConfig {
    const found: string[] = [];
    const tool: AiTool = 'windsurf';

    const legacy = path.join(root, '.windsurfrules');
    if (isFile(legacy)) found.push(legacy);

    const wsDir = path.join(root, '.windsurf', 'rules');
    const ruleFiles = listFiles(wsDir);
    found.push(...ruleFiles);

    const present = found.length > 0;
    if (!present) return { tool, present: false, files: [] };

    return { tool, present: true, files: found, instructionsBytes: totalBytes(found) };
}

// ── Codex parser ──────────────────────────────────────────────────────────────

function detectCodex(root: string): AiToolConfig {
    const tool: AiTool = 'codex';
    const agentsMd = path.join(root, 'AGENTS.md');
    if (!isFile(agentsMd)) return { tool, present: false, files: [] };
    return { tool, present: true, files: [agentsMd], instructionsBytes: totalBytes([agentsMd]) };
}

// ── Gemini parser ─────────────────────────────────────────────────────────────

function detectGemini(root: string): AiToolConfig {
    const tool: AiTool = 'gemini';
    const geminiMd = path.join(root, 'GEMINI.md');
    if (!isFile(geminiMd)) return { tool, present: false, files: [] };
    return { tool, present: true, files: [geminiMd], instructionsBytes: totalBytes([geminiMd]) };
}

// ── Public entry point ────────────────────────────────────────────────────────

export function detectAiConfigs(root: string): AiConfigReport {
    if (typeof root !== 'string' || root.trim().length === 0) {
        return { ok: false, tools: [], error: 'root must be a non-empty string' };
    }

    const absRoot = path.resolve(root);
    if (!isDir(absRoot)) {
        return { ok: false, tools: [], error: `not a directory: ${absRoot}` };
    }

    try {
        const tools: AiToolConfig[] = [
            detectClaudeCode(absRoot),
            detectCursor(absRoot),
            detectCopilot(absRoot),
            detectWindsurf(absRoot),
            detectCodex(absRoot),
            detectGemini(absRoot),
        ];
        return { ok: true, tools };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, tools: [], error: msg };
    }
}
