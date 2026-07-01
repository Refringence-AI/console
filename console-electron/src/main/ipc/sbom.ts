// console-electron/src/main/ipc/sbom.ts
//
// IPC handler: console:sbom.write
// Wraps sbom.buildSbom and persists the result; deterministic, no network.
// The caller passes generatedAt so build timestamps are reproducible in tests.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSbom } from '../sbom';

export interface SbomWriteResult { ok: boolean; path?: string; componentCount?: number; error?: string }

export function registerSbomHandlers(): void {
    // Build the SBOM and persist it to <root>/sbom.cdx.json so the supply-chain
    // inventory is a committable artifact, not just an AI-tool side effect.
    ipcMain.handle(
        'console:sbom.write',
        (_evt, root: string, generatedAt: string): SbomWriteResult => {
            if (typeof root !== 'string' || root.length === 0) return { ok: false, error: 'No project is open.' };
            const ts = typeof generatedAt === 'string' && generatedAt ? generatedAt : new Date().toISOString();
            try {
                const res = buildSbom(root, ts);
                if (!res.ok || !res.bom) return { ok: false, error: res.error ?? 'Could not build the SBOM.' };
                fs.writeFileSync(path.join(root, 'sbom.cdx.json'), JSON.stringify(res.bom, null, 2), 'utf8');
                return { ok: true, path: 'sbom.cdx.json', componentCount: res.componentCount };
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );
}
