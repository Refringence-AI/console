// console-electron/src/main/ai/keystore.ts
//
// Per-provider API-key storage, generalized from connections.ts. Keys are
// encrypted one file per provider under <userData>/ai-keys/<id>.key via
// Electron safeStorage (OS keychain / DPAPI). A raw key NEVER returns to
// the renderer and is NEVER logged: the registry reads it back in-process
// to build a provider client, and only booleans cross the bridge.
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ProviderId } from './ModelProvider';

// Providers that require a stored key. Ollama is local + keyless, so it is
// not part of the keystore surface.
export const KEYED_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google', 'kimi'];

function keyDir(): string {
    return path.join(app.getPath('userData'), 'ai-keys');
}

// `id` is a string so the same encrypted store also holds non-AI service keys
// (e.g. 'langsmith'); the typed KEYED_PROVIDERS surface below stays AI-only.
function keyFile(id: string): string {
    return path.join(keyDir(), `${id}.key`);
}

/**
 * Encrypt + persist a provider key. Returns false (never throws) when OS
 * encryption is unavailable, so the caller surfaces an honest failure
 * instead of writing a plaintext secret.
 */
export function setKey(id: string, key: string): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    try {
        const encrypted = safeStorage.encryptString(key);
        fs.mkdirSync(keyDir(), { recursive: true });
        const file = keyFile(id);
        fs.writeFileSync(file, encrypted);
        // Best-effort owner-only mode; a no-op on Windows where ACLs differ.
        try { fs.chmodSync(file, 0o600); } catch { /* not fatal */ }
        return true;
    } catch {
        return false;
    }
}

/**
 * Read + decrypt a provider key. Main-process internal only: never call
 * this from an IPC handler that returns to the renderer. Returns null when
 * the file is missing, unreadable, or can't be decrypted.
 */
export function getKey(id: string): string | null {
    try {
        const file = keyFile(id);
        if (!fs.existsSync(file)) return null;
        if (!safeStorage.isEncryptionAvailable()) return null;
        const decrypted = safeStorage.decryptString(fs.readFileSync(file));
        return decrypted.length > 0 ? decrypted : null;
    } catch {
        return null;
    }
}

export function clearKey(id: string): void {
    try {
        const file = keyFile(id);
        if (fs.existsSync(file)) fs.rmSync(file);
    } catch {
        /* never throw across IPC */
    }
}

export function hasKey(id: string): boolean {
    try {
        return fs.existsSync(keyFile(id));
    } catch {
        return false;
    }
}

/** Booleans-only status for every keyed provider. */
export function keyStatus(): Record<ProviderId, boolean> {
    const out = {} as Record<ProviderId, boolean>;
    for (const id of KEYED_PROVIDERS) out[id] = hasKey(id);
    return out;
}
