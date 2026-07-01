// console-electron/src/main/ipc/secrets.ts
//
// "Keys in the open" scan: walks the project's source + config files looking for
// hardcoded secrets (well-known token formats + private keys). Read-only. The
// renderer only ever sees a REDACTED preview (first 6 + last 2 chars), never the
// full secret. .env files are skipped on purpose - secrets there are expected and
// gitignored; the risk is a secret committed into source.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SecretFinding {
    file: string;    // path relative to the project root
    line: number;
    type: string;
    preview: string; // redacted
}
export interface SecretScan {
    scanned: number;
    findings: SecretFinding[];
    truncated: boolean;
    scannedAt: string;
}

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo',
    '.cache', 'vendor', '.venv', 'venv', '__pycache__', '.refringence-console',
    '.refringence-qa', '.idea', '.vscode', 'target', 'bin', 'obj',
]);
// Code + config. .md/.txt are skipped (docs carry example keys); .env is skipped
// (expected secret store); lockfiles + .example files are skipped.
const SCAN_EXT = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.rs',
    '.java', '.kt', '.php', '.cs', '.json', '.yaml', '.yml', '.toml', '.sh', '.ini', '.cfg',
]);

const PATTERNS: { type: string; re: RegExp }[] = [
    { type: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
    { type: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
    { type: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { type: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
    { type: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
    { type: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
    { type: 'Stripe live key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
    { type: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
];

// AI-agent instruction files are normally .md (so skipped above), but they are
// exactly where a user pastes a key while wiring up Cursor / Claude / Copilot,
// and they are usually committed. Scan them regardless of extension.
const AGENT_CONFIG_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', 'copilot-instructions.md']);
const AGENT_CONFIG_DIRS = new Set(['.claude', '.cursor', '.windsurf']);
function isAgentConfig(rel: string, name: string): boolean {
    if (AGENT_CONFIG_NAMES.has(name)) return true;
    const segs = rel.split('/');
    if (segs.some((s) => AGENT_CONFIG_DIRS.has(s))) {
        const ext = path.extname(name).toLowerCase();
        return ext === '.md' || ext === '.mdc' || ext === '.txt' || ext === '' || ext === '.json';
    }
    if (segs.includes('.github') && (name.endsWith('.instructions.md') || name === 'copilot-instructions.md')) return true;
    return false;
}

const MAX_FILES = 4000;
const MAX_FINDINGS = 60;
const MAX_FILE_BYTES = 512 * 1024;

function redact(match: string): string {
    const m = match.trim();
    if (m.length <= 10) return '***';
    return `${m.slice(0, 6)}…${m.slice(-2)}`;
}

function scanFile(full: string, rel: string, findings: SecretFinding[]): void {
    let contents: string;
    try {
        if (fs.statSync(full).size > MAX_FILE_BYTES) return;
        contents = fs.readFileSync(full, 'utf8');
    } catch { return; }
    const lines = contents.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 1000) continue;
        for (const p of PATTERNS) {
            const m = p.re.exec(line);
            if (m) {
                findings.push({ file: rel, line: i + 1, type: p.type, preview: redact(m[0]) });
                if (findings.length >= MAX_FINDINGS) return;
                break; // one finding per line is enough
            }
        }
    }
}

export interface PromptLeak { type: string; preview: string; line: number }

// Scan arbitrary text - a prompt about to be handed to a dev tool - for the same
// secret formats, so a key pasted into an error log or prompt is caught before it
// leaves for Cursor / Claude. Returns redacted findings; never the raw secret.
export function scanText(text: string): PromptLeak[] {
    if (typeof text !== 'string' || text.length === 0) return [];
    const out: PromptLeak[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < MAX_FINDINGS; i++) {
        const line = lines[i];
        if (line.length > 2000) continue;
        for (const p of PATTERNS) {
            const m = p.re.exec(line);
            if (m) { out.push({ type: p.type, preview: redact(m[0]), line: i + 1 }); break; }
        }
    }
    return out;
}

export function scanSecrets(root: string): SecretScan {
    const base = path.resolve(root);
    const findings: SecretFinding[] = [];
    let scanned = 0;
    let truncated = false;

    function walk(dir: string, depth: number): void {
        if (truncated || depth > 8) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
            if (truncated) return;
            if (ent.isDirectory()) {
                if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.refringence')) continue;
                walk(path.join(dir, ent.name), depth + 1);
            } else if (ent.isFile()) {
                const name = ent.name;
                if (name.startsWith('.env') || name.endsWith('.example') || name.endsWith('.lock') || name === 'package-lock.json') continue;
                const full = path.join(dir, name);
                const rel = path.relative(base, full).replace(/\\/g, '/');
                if (!SCAN_EXT.has(path.extname(name).toLowerCase()) && !isAgentConfig(rel, name)) continue;
                if (scanned >= MAX_FILES) { truncated = true; return; }
                scanned++;
                scanFile(full, rel, findings);
                if (findings.length >= MAX_FINDINGS) { truncated = true; return; }
            }
        }
    }

    try { walk(base, 0); } catch { /* total */ }
    return { scanned, findings, truncated, scannedAt: new Date().toISOString() };
}

export function registerSecretsHandlers(): void {
    ipcMain.handle('console:secrets.scan', (_evt, projectRoot: string): SecretScan => {
        try { return scanSecrets(projectRoot); }
        catch { return { scanned: 0, findings: [], truncated: false, scannedAt: new Date().toISOString() }; }
    });
}
