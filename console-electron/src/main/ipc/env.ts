// console-electron/src/main/ipc/env.ts
//
// Env-var name reconciliation IPC. Reads the project's local .env files
// and extracts ONLY the key names (left of '='). It NEVER reads, returns,
// or logs any values, since those are secrets.
//
// Channel:
//   console:env.localNames(projectRoot) -> { files, allNames }
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanConnectable, connectFromEnv, type EnvConnectable } from '../envConnect';

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.production'];

export interface EnvFileNames {
    file: string;
    names: string[];
}

export interface EnvLocalNames {
    files: EnvFileNames[];
    allNames: string[];
}

function extractNames(contents: string): string[] {
    const names: string[] = [];
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
        const eq = withoutExport.indexOf('=');
        if (eq <= 0) continue;
        const name = withoutExport.slice(0, eq).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            names.push(name);
        }
    }
    return names;
}

export function registerEnvHandlers(): void {
    ipcMain.handle('console:env.localNames', (_evt, projectRoot: string): EnvLocalNames => {
        const files: EnvFileNames[] = [];
        const allNames = new Set<string>();

        try {
            if (!projectRoot || typeof projectRoot !== 'string') {
                return { files, allNames: [] };
            }
            const root = path.resolve(projectRoot);
            for (const file of ENV_FILES) {
                const full = path.join(root, file);
                try {
                    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
                    const contents = fs.readFileSync(full, 'utf8');
                    const names = extractNames(contents);
                    files.push({ file, names });
                    for (const n of names) allNames.add(n);
                } catch {
                    /* skip unreadable file */
                }
            }
        } catch {
            return { files, allNames: Array.from(allNames) };
        }

        return { files, allNames: Array.from(allNames) };
    });

    // Services in this project's .env that Console can connect (NAMES only).
    ipcMain.handle('console:env.scanConnectable', (_evt, projectRoot: string): EnvConnectable[] => {
        try { return scanConnectable(projectRoot); } catch { return []; }
    });

    // Connect one detected service using its .env value, read transiently in the
    // main process. The value never crosses back to the renderer.
    ipcMain.handle('console:env.connect', async (_evt, projectRoot: string, serviceId: string): Promise<{ ok: boolean; detail?: string; error?: string }> => {
        try { return await connectFromEnv(projectRoot, serviceId); }
        catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });
}
