// console-electron/src/main/ipc/observability.ts
//
// Observability panel IPC handler. v0.2-MVP: surfaces the existing
// .refringence-qa/runs/<runId>/ folders + their child JSONL files.
// Full OTel self-instrumentation lands in a later round.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RunEntry {
    runId: string;
    startedAt: string;
    artifactKinds: string[];
    totalFiles: number;
    totalBytes: number;
}

export interface ObsCounters {
    runs: number;
    runs_last_24h: number;
    errors: number;
    errors_last_24h: number;
}

export interface RunArtifactFile {
    relPath: string;
    kind: string;
    sizeBytes: number;
}

export interface RunDetail {
    runId: string;
    files: RunArtifactFile[];
    status: 'ok' | 'failed' | 'unknown';
    statusSource: 'manifest' | 'heuristic';
}

// Runs Console records for the PICKED project. None until the run-recorder
// lands, so a generic project honestly shows zero runs rather than a sibling
// repo's QA history.
function runsDir(root: string): string { return path.join(root, '.refringence-console', 'runs'); }
function validRoot(root: unknown): root is string { return typeof root === 'string' && root.length > 0; }

function listKindsAndSize(runDir: string): { kinds: string[]; files: number; bytes: number } {
    const kinds = new Set<string>();
    let files = 0;
    let bytes = 0;
    walk(runDir);
    return { kinds: Array.from(kinds).sort(), files, bytes };

    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const ent of entries) {
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                kinds.add(ent.name);
                walk(abs);
            } else if (ent.isFile()) {
                files++;
                try { bytes += fs.statSync(abs).size; }
                catch { /* skip */ }
            }
        }
    }
}

function parseRunTimestamp(runId: string): string {
    // qa run dir names look like local-2026-06-16T12-25-34-738Z.
    const m = runId.match(/^[a-zA-Z_-]*([\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}-[\d]{2}-[\d]{2}-[\d]{3}Z)/);
    if (!m) return '';
    // Convert hyphens back to colons for ISO.
    const iso = m[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3').replace(/-(\d{3}Z)$/, '.$1');
    return iso;
}

function walkRunFiles(runDir: string): RunArtifactFile[] {
    const out: RunArtifactFile[] = [];
    walk(runDir);
    out.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return out;

    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const ent of entries) {
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(abs);
            } else if (ent.isFile()) {
                const relPath = path.relative(runDir, abs).split(path.sep).join('/');
                const kind = relPath.includes('/') ? relPath.split('/')[0] : '(root)';
                let sizeBytes = 0;
                try { sizeBytes = fs.statSync(abs).size; }
                catch { /* skip */ }
                out.push({ relPath, kind, sizeBytes });
            }
        }
    }
}

// Look for a result/summary/status manifest in the run dir and read its
// real status (status/result/exit/exitCode field). Returns null if no
// manifest is found or it cannot be parsed.
function readManifestStatus(runDir: string): 'ok' | 'failed' | 'unknown' | null {
    const candidates = ['result.json', 'summary.json', 'status.json'];
    for (const name of candidates) {
        const abs = path.join(runDir, name);
        if (!fs.existsSync(abs)) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(fs.readFileSync(abs, 'utf8')); }
        catch { continue; }
        if (!parsed || typeof parsed !== 'object') continue;
        const obj = parsed as Record<string, unknown>;
        const statusVal = obj.status ?? obj.result;
        if (typeof statusVal === 'string') {
            const s = statusVal.toLowerCase();
            if (s === 'ok' || s === 'pass' || s === 'passed' || s === 'success' || s === 'succeeded') return 'ok';
            if (s === 'fail' || s === 'failed' || s === 'failure' || s === 'error') return 'failed';
        }
        if (typeof statusVal === 'boolean') return statusVal ? 'ok' : 'failed';
        const exitVal = obj.exit ?? obj.exitCode ?? obj.code;
        if (typeof exitVal === 'number') return exitVal === 0 ? 'ok' : 'failed';
    }
    return null;
}

function heuristicStatus(files: RunArtifactFile[]): 'ok' | 'failed' | 'unknown' {
    if (files.length === 0) return 'unknown';
    const hasFailure = files.some((f) => /fail|error/i.test(f.kind) || /fail|error/i.test(f.relPath));
    return hasFailure ? 'failed' : 'ok';
}

export function registerObservabilityHandlers(): void {
    ipcMain.handle('console:obs.runDetail', (_e, root: string, runId: unknown): RunDetail => {
        const empty: RunDetail = { runId: typeof runId === 'string' ? runId : '', files: [], status: 'unknown', statusSource: 'heuristic' };
        if (!validRoot(root)) return empty;
        if (typeof runId !== 'string' || runId.length === 0) return empty;
        // Guard against traversal: a runId is a single dir name.
        if (runId.includes('/') || runId.includes('\\') || runId.includes('..')) return empty;
        const runDir = path.join(runsDir(root), runId);
        try {
            if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) return empty;
            const files = walkRunFiles(runDir);
            const manifestStatus = readManifestStatus(runDir);
            if (manifestStatus !== null) {
                return { runId, files, status: manifestStatus, statusSource: 'manifest' };
            }
            return { runId, files, status: heuristicStatus(files), statusSource: 'heuristic' };
        } catch {
            return empty;
        }
    });


    ipcMain.handle('console:obs.runs', (_e, root: string): RunEntry[] => {
        if (!validRoot(root)) return [];
        const dir = runsDir(root);
        if (!fs.existsSync(dir)) return [];
        let runIds: string[];
        try {
            runIds = fs.readdirSync(dir).filter((d) => {
                try { return fs.statSync(path.join(dir, d)).isDirectory(); }
                catch { return false; }
            });
        } catch { return []; }
        runIds.sort((a, b) => b.localeCompare(a));
        const out: RunEntry[] = [];
        for (const runId of runIds.slice(0, 50)) {
            const info = listKindsAndSize(path.join(dir, runId));
            out.push({
                runId,
                startedAt: parseRunTimestamp(runId),
                artifactKinds: info.kinds,
                totalFiles: info.files,
                totalBytes: info.bytes,
            });
        }
        return out;
    });

    ipcMain.handle('console:obs.counters', (_e, root: string): ObsCounters => {
        const oneDayMs = 24 * 60 * 60 * 1000;
        const now = Date.now();
        let runs = 0;
        let runs24 = 0;
        let errors = 0;
        let errors24 = 0;
        if (!validRoot(root) || !fs.existsSync(runsDir(root))) {
            return { runs: 0, runs_last_24h: 0, errors: 0, errors_last_24h: 0 };
        }
        const dir = runsDir(root);
        try {
            const runIds = fs.readdirSync(dir);
            runs = runIds.length;
            for (const runId of runIds) {
                const ts = parseRunTimestamp(runId);
                if (ts && (now - Date.parse(ts)) < oneDayMs) runs24++;
                // Count error markers - Playwright + eval-harness write per-failure
                // -1.png screenshots under test-artifacts/.
                const artDir = path.join(dir, runId, 'test-artifacts');
                if (fs.existsSync(artDir)) {
                    try {
                        const sub = fs.readdirSync(artDir).filter((d) => d.endsWith('-failed') || d.includes('failed') || d.includes('error'));
                        errors += sub.length;
                        if (ts && (now - Date.parse(ts)) < oneDayMs) errors24 += sub.length;
                    } catch { /* skip */ }
                }
            }
        } catch { /* skip */ }
        return { runs, runs_last_24h: runs24, errors, errors_last_24h: errors24 };
    });
}
