// console-electron/src/main/ai/writeGate.ts
//
// Primitives for the assistant's gated write capability: path validation with
// the same traversal guards the read tools use, a display diff for the approval
// card, and an apply that backs up the prior content first so a write is
// recoverable. The approval itself lives in ipc/ai.ts (a blocking gate); this
// module is pure file logic.
import * as fs from 'node:fs';
import * as path from 'node:path';

export const MAX_WRITE_BYTES = 2_000_000;
const SKIP = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache',
    '.venv', '__pycache__', '.refringence-qa', '.refringence-console',
]);

function inside(root: string, abs: string): boolean {
    const rel = path.relative(root, abs);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Realpath-canonicalise the nearest existing ancestor so a symlinked parent
// cannot escape the project even when the target file does not exist yet.
function realInsideAllowingNew(root: string, abs: string): boolean {
    try {
        const realRoot = fs.realpathSync(root);
        let probe = abs;
        for (let i = 0; i < 40; i++) {
            if (fs.existsSync(probe)) {
                const realProbe = fs.realpathSync(probe);
                return realProbe === realRoot || realProbe.startsWith(realRoot + path.sep);
            }
            const parent = path.dirname(probe);
            if (parent === probe) return false;
            probe = parent;
        }
        return false;
    } catch { return false; }
}

export interface WriteTarget { absPath: string; rel: string; existing: string | null; }

export function validateWriteTarget(root: string, rel: string): WriteTarget | { error: string } {
    if (!rel || !rel.trim()) return { error: 'A file path is required.' };
    const abs = path.resolve(root, rel);
    if (!inside(root, abs)) return { error: 'Path is outside the project.' };
    if (!realInsideAllowingNew(root, abs)) return { error: 'Path is outside the project.' };
    const parts = path.relative(root, abs).split(path.sep);
    if (parts.some((p) => SKIP.has(p))) return { error: 'That directory is protected; pick another path.' };
    let existing: string | null = null;
    try {
        const st = fs.statSync(abs);
        if (st.isDirectory()) return { error: 'Path is a directory, not a file.' };
        if (st.size > MAX_WRITE_BYTES) return { error: 'The existing file is too large to edit safely.' };
        existing = fs.readFileSync(abs, 'utf8');
    } catch { /* new file */ }
    return { absPath: abs, rel: path.relative(root, abs).replace(/\\/g, '/'), existing };
}

// Full-file unified diff for display in the approval card (not a patch to apply).
export function makeDiff(oldText: string | null, newText: string, rel: string): string {
    const oldLines = oldText === null ? [] : oldText.split('\n');
    const newLines = newText.split('\n');
    const header = oldText === null ? `--- /dev/null\n+++ b/${rel}` : `--- a/${rel}\n+++ b/${rel}`;
    const body = [`@@ -1,${oldLines.length} +1,${newLines.length} @@`];
    for (const l of oldLines) body.push(`-${l}`);
    for (const l of newLines) body.push(`+${l}`);
    return header + '\n' + body.join('\n');
}

// Back up the prior content (if any) under .refringence-console/.ai-backups so
// the write is recoverable, then write the new content. Returns the backup path.
export function applyWrite(root: string, target: WriteTarget, content: string): { ok: boolean; backupPath?: string; error?: string } {
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) return { ok: false, error: 'Content is too large to write.' };
    try {
        let backupPath: string | undefined;
        if (target.existing !== null) {
            const dir = path.join(root, '.refringence-console', '.ai-backups');
            fs.mkdirSync(dir, { recursive: true });
            const stamp = target.rel.replace(/[\\/]/g, '__');
            backupPath = path.join(dir, `${stamp}.${process.hrtime.bigint()}.bak`);
            fs.writeFileSync(backupPath, target.existing, 'utf8');
        }
        fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
        fs.writeFileSync(target.absPath, content, 'utf8');
        return { ok: true, backupPath };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
