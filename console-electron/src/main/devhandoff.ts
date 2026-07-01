// console-electron/src/main/devhandoff.ts
//
// Dev-tool router. Console writes a prompt the user drafted into the file
// the dev tool reads (.cursorrules for Cursor/Windsurf, AGENTS.md for the
// Claude CLI and others), or hands it straight to `claude` on the command
// line. Everything here is "fix MCP, don't go around it" in spirit: the
// prompt leaves Console through the dev tool's OWN documented entry point.
//
// Two hard properties:
//   1. Idempotent managed block. We only ever rewrite the text BETWEEN our
//      markers, so a user's hand edits above/below survive a re-write.
//   2. shell:false everywhere. `claude` is spawned with an argv array and a
//      traversal-guarded cwd, never a shell string (same rule as runner.ts).
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { shell, BrowserWindow } from 'electron';

const isWin = process.platform === 'win32';

const BLOCK_START = '# --- Console (managed) ---';
const BLOCK_END = '# --- end Console ---';

export type WriteMode = 'replace' | 'append';

export interface DevToolDetect {
    cursor: boolean;
    claudeCli: boolean;
    windsurf: boolean;
}

export interface WriteResult {
    ok: boolean;
    path?: string;
    error?: string;
}

export interface ClaudeRunResult {
    ok: boolean;
    runId?: string;
    error?: string;
}

// Resolve a project root the same way the runner does: an explicit dir that
// is inside (or equal to) the active root, else the active root itself. The
// inside() check is authoritative: an explicit root that resolves OUTSIDE the
// active root is rejected (we fall back to base), so a renderer bug or hostile
// renderer cannot point a write at an arbitrary parent path.
function resolveRoot(root?: string): string {
    const base = fallbackRoot();
    if (root && root.trim().length > 0) {
        const abs = path.resolve(root);
        const rel = path.relative(base, abs);
        const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        if (inside) {
            try {
                if (fs.statSync(abs).isDirectory()) return abs;
            } catch {
                /* fall through to base */
            }
        }
    }
    return base;
}

function fallbackRoot(): string {
    const fromEnv = process.env.REFRINGENCE_CONSOLE_PROJECT_ROOT;
    if (fromEnv && fromEnv.trim().length > 0) {
        const abs = path.resolve(fromEnv);
        try {
            if (fs.statSync(abs).isDirectory()) return abs;
        } catch {
            /* fall through */
        }
    }
    return process.cwd();
}

// PATH probe with no spawn: scan PATH dirs for the binary (plus Windows
// PATHEXT variants). Cheaper and safer than launching `which`/`where`.
function onPath(binary: string): boolean {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const exts = isWin
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
        : [''];
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = path.join(dir, isWin ? `${binary}${ext}` : binary);
            try {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
            } catch {
                /* unreadable PATH entry */
            }
        }
    }
    return false;
}

export function detect(): DevToolDetect {
    try {
        return {
            cursor: onPath('cursor'),
            claudeCli: onPath('claude'),
            windsurf: onPath('windsurf'),
        };
    } catch {
        return { cursor: false, claudeCli: false, windsurf: false };
    }
}

// Splice our managed block into existing file text. 'replace' rewrites the
// block in place (or appends it if absent); 'append' always appends a fresh
// block. Text outside the markers is preserved verbatim either way.
export function spliceBlock(existing: string, content: string, mode: WriteMode): string {
    const block = `${BLOCK_START}\n${content.trim()}\n${BLOCK_END}`;
    const startIdx = existing.indexOf(BLOCK_START);
    const endIdx = existing.indexOf(BLOCK_END);

    if (mode === 'replace' && startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const before = existing.slice(0, startIdx);
        const after = existing.slice(endIdx + BLOCK_END.length);
        return `${before.replace(/\s+$/, '')}\n\n${block}\n${after.replace(/^\s+/, '')}`.trimEnd() + '\n';
    }

    const base = existing.trimEnd();
    if (base.length === 0) return `${block}\n`;
    return `${base}\n\n${block}\n`;
}

function writeManaged(root: string, fileName: string, content: string, mode: WriteMode): WriteResult {
    if (typeof content !== 'string') return { ok: false, error: 'No content provided' };
    const target = path.join(root, fileName);
    let existing = '';
    try {
        if (fs.existsSync(target)) existing = fs.readFileSync(target, 'utf8');
    } catch {
        existing = '';
    }
    const next = spliceBlock(existing, content, mode === 'append' ? 'append' : 'replace');
    const tmp = `${target}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, next, 'utf8');
        fs.renameSync(tmp, target);
        return { ok: true, path: target };
    } catch (err) {
        try { if (fs.existsSync(tmp)) fs.rmSync(tmp); } catch { /* noop */ }
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export function writeCursorRules(root: string, content: string, mode: WriteMode = 'replace'): WriteResult {
    try {
        return writeManaged(resolveRoot(root), '.cursorrules', content, mode);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export function writeAgentsMd(root: string, content: string, mode: WriteMode = 'replace'): WriteResult {
    try {
        return writeManaged(resolveRoot(root), 'AGENTS.md', content, mode);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// One in-flight `claude` invocation per runId. The renderer subscribes to
// console:devhandoff.claude.output / .complete, mirroring runner.ts so the
// existing streaming UI substrate can render the transcript.
interface RunningClaude {
    proc: ChildProcess;
    startedAt: number;
}
const claudeRuns = new Map<string, RunningClaude>();

function newRunId(): string {
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    return `claude-${iso}`;
}

function send(win: BrowserWindow | null, channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

export function invokeClaudeCli(
    win: BrowserWindow | null,
    opts: { prompt: string; cwd?: string },
): ClaudeRunResult {
    if (!opts || typeof opts.prompt !== 'string' || opts.prompt.trim().length === 0) {
        return { ok: false, error: 'No prompt provided' };
    }
    if (!detect().claudeCli) {
        return { ok: false, error: 'The claude CLI was not found on PATH' };
    }

    const cwd = resolveRoot(opts.cwd);
    const runId = newRunId();
    // `claude -p <prompt>` runs one non-interactive turn and prints to stdout.
    const cmd = isWin ? 'claude.cmd' : 'claude';
    let proc: ChildProcess;
    try {
        proc = spawn(cmd, ['-p', opts.prompt], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
        });
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    claudeRuns.set(runId, { proc, startedAt: Date.now() });

    const onData = (stream: 'stdout' | 'stderr') => (b: Buffer) => {
        const text = b.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
            if (line.length === 0) continue;
            send(win, 'console:devhandoff.claude.output', { runId, line, stream, ts: Date.now() });
        }
    };
    proc.stdout?.on('data', onData('stdout'));
    proc.stderr?.on('data', onData('stderr'));

    const finish = (exitCode: number | null) => {
        const entry = claudeRuns.get(runId);
        claudeRuns.delete(runId);
        send(win, 'console:devhandoff.claude.complete', {
            runId,
            exitCode,
            durationMs: entry ? Date.now() - entry.startedAt : 0,
        });
    };
    proc.on('error', (err) => {
        send(win, 'console:devhandoff.claude.output', {
            runId, line: `process error: ${err.message}`, stream: 'stderr', ts: Date.now(),
        });
        finish(-1);
    });
    proc.on('exit', (code) => finish(code));

    return { ok: true, runId };
}

// Open the project in Cursor: prefer its CLI when present, else fall back to
// the OS handler (Cursor registers a folder handler on install).
export async function openInCursor(root?: string): Promise<WriteResult> {
    const dir = resolveRoot(root);
    try {
        if (detect().cursor) {
            const cmd = isWin ? 'cursor.cmd' : 'cursor';
            try {
                const proc = spawn(cmd, [dir], { stdio: 'ignore', shell: false, windowsHide: true, detached: false });
                proc.on('error', () => { /* fall back below on async failure */ });
                return { ok: true, path: dir };
            } catch {
                /* fall through to shell.openPath */
            }
        }
        const error = await shell.openPath(dir);
        return error ? { ok: false, error } : { ok: true, path: dir };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
