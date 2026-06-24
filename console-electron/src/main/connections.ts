// console-electron/src/main/connections.ts
//
// The connection store for the Phase 3 deploy wedge. Two kinds of state:
//
//   1. Non-secret metadata (connected flag, login/username, timestamp)
//      lives in plaintext at <userData>/connections.json. Plain fs + JSON,
//      NOT electron-store (which crashed here on an ESM mismatch).
//
//   2. Secret API tokens live encrypted, one file per provider, under
//      <userData>/connections/<provider>.token, written via Electron's
//      safeStorage (OS keychain / DPAPI). Tokens NEVER touch
//      connections.json, are NEVER logged, and are NEVER returned to the
//      renderer — only the data fetched with them is.
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ConnectionProvider = 'github' | 'vercel' | 'sentry' | 'slack';

export type SlackTeam = 'tech' | 'nontech' | 'test';

export interface GithubMeta {
    connected: boolean;
    login?: string;
    connectedAt?: string;
}

export interface VercelMeta {
    connected: boolean;
    user?: string;
    connectedAt?: string;
}

export interface SentryMeta {
    connected: boolean;
    user?: string;
    org?: string;
    connectedAt?: string;
}

export interface SlackMeta {
    connected: boolean;
    team?: string;
    user?: string;
    connectedAt?: string;
    // channelId -> team bucket. A non-secret map so the Workboard knows
    // which pulled channels belong to Tech / Non-tech / Test.
    channelTeams?: Record<string, SlackTeam>;
}

export interface ConnectionsMeta {
    github?: GithubMeta;
    vercel?: VercelMeta;
    sentry?: SentryMeta;
    slack?: SlackMeta;
}

function metaFile(): string {
    return path.join(app.getPath('userData'), 'connections.json');
}

function tokenDir(): string {
    return path.join(app.getPath('userData'), 'connections');
}

function tokenFile(provider: ConnectionProvider): string {
    return path.join(tokenDir(), `${provider}.token`);
}

export function loadMeta(): ConnectionsMeta {
    try {
        const raw = fs.readFileSync(metaFile(), 'utf8');
        const parsed = JSON.parse(raw) as ConnectionsMeta;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function saveMeta(provider: 'github', meta: GithubMeta): void;
export function saveMeta(provider: 'vercel', meta: VercelMeta): void;
export function saveMeta(provider: 'sentry', meta: SentryMeta): void;
export function saveMeta(provider: 'slack', meta: SlackMeta): void;
export function saveMeta(provider: ConnectionProvider, meta: GithubMeta | VercelMeta | SentryMeta | SlackMeta): void {
    const current = loadMeta();
    const next: ConnectionsMeta = { ...current, [provider]: meta };
    try {
        fs.mkdirSync(path.dirname(metaFile()), { recursive: true });
        fs.writeFileSync(metaFile(), JSON.stringify(next, null, 2), 'utf8');
    } catch (err) {
        console.error(`[connections] failed to write meta for ${provider}:`, err);
    }
}

export function clearMeta(provider: ConnectionProvider): void {
    const current = loadMeta();
    if (!(provider in current)) return;
    delete current[provider];
    try {
        fs.writeFileSync(metaFile(), JSON.stringify(current, null, 2), 'utf8');
    } catch (err) {
        console.error(`[connections] failed to clear meta for ${provider}:`, err);
    }
}

/**
 * Encrypt + persist a provider token. Throws if OS-level encryption is
 * unavailable so the caller can surface an honest error instead of writing
 * a plaintext secret. The plaintext token never leaves this function.
 */
export function setToken(provider: ConnectionProvider, token: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
            'Encryption is unavailable on this system, so the token cannot be stored securely. ' +
            'Connection aborted.',
        );
    }
    const encrypted = safeStorage.encryptString(token);
    const dir = tokenDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = tokenFile(provider);
    fs.writeFileSync(file, encrypted);
    // Best-effort owner-only permissions; a no-op / silent fail on Windows.
    try {
        fs.chmodSync(file, 0o600);
    } catch {
        /* not fatal — Windows ACLs differ from POSIX modes */
    }
}

/**
 * Read + decrypt a provider token. Returns null (never throws) when the
 * file is missing, unreadable, or can't be decrypted.
 */
export function getToken(provider: ConnectionProvider): string | null {
    try {
        const file = tokenFile(provider);
        if (!fs.existsSync(file)) return null;
        if (!safeStorage.isEncryptionAvailable()) return null;
        const encrypted = fs.readFileSync(file);
        const token = safeStorage.decryptString(encrypted);
        return token.length > 0 ? token : null;
    } catch (err) {
        console.error(`[connections] failed to read token for ${provider}:`, err);
        return null;
    }
}

export function clearToken(provider: ConnectionProvider): void {
    try {
        const file = tokenFile(provider);
        if (fs.existsSync(file)) fs.rmSync(file);
    } catch (err) {
        console.error(`[connections] failed to clear token for ${provider}:`, err);
    }
}
