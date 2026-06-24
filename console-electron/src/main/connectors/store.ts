// console-electron/src/main/connectors/store.ts
//
// Storage for the generic connector platform (the usage-dashboard layer that
// sits on top of the four bespoke connections in ../connections.ts).
//
//   - SECRET tokens are encrypted one file per connector under
//     <userData>/connectors/<id>.token via safeStorage (same pattern as
//     connections.ts). A token NEVER returns to the renderer and is NEVER logged.
//   - NON-secret metadata (connected flag, account label, and any extra fields
//     like an org slug / project ref / self-host URL) lives in plaintext at
//     <userData>/connectors-meta.json. Extra fields are identifiers, not
//     credentials, so plaintext is correct.
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ConnectorMetaEntry {
    connected: boolean;
    account?: string;
    connectedAt?: string;
    extra?: Record<string, string>;
}

type ConnectorMetaStore = Record<string, ConnectorMetaEntry>;

function tokenDir(): string {
    return path.join(app.getPath('userData'), 'connectors');
}

function tokenFile(id: string): string {
    return path.join(tokenDir(), `${id}.token`);
}

function metaFile(): string {
    return path.join(app.getPath('userData'), 'connectors-meta.json');
}

export function loadConnectorMeta(): ConnectorMetaStore {
    try {
        const parsed = JSON.parse(fs.readFileSync(metaFile(), 'utf8')) as ConnectorMetaStore;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function saveConnectorMeta(id: string, entry: ConnectorMetaEntry): void {
    const current = loadConnectorMeta();
    try {
        fs.writeFileSync(metaFile(), JSON.stringify({ ...current, [id]: entry }, null, 2), 'utf8');
    } catch (err) {
        console.error(`[connectors] failed to write meta for ${id}:`, err);
    }
}

export function clearConnectorMeta(id: string): void {
    const current = loadConnectorMeta();
    if (!(id in current)) return;
    delete current[id];
    try {
        fs.writeFileSync(metaFile(), JSON.stringify(current, null, 2), 'utf8');
    } catch (err) {
        console.error(`[connectors] failed to clear meta for ${id}:`, err);
    }
}

export function setConnectorToken(id: string, token: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is unavailable on this system, so the token cannot be stored securely.');
    }
    const dir = tokenDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = tokenFile(id);
    fs.writeFileSync(file, safeStorage.encryptString(token));
    try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs differ */ }
}

export function getConnectorToken(id: string): string | null {
    try {
        const file = tokenFile(id);
        if (!fs.existsSync(file)) return null;
        if (!safeStorage.isEncryptionAvailable()) return null;
        const token = safeStorage.decryptString(fs.readFileSync(file));
        return token.length > 0 ? token : null;
    } catch (err) {
        console.error(`[connectors] failed to read token for ${id}:`, err);
        return null;
    }
}

export function clearConnectorToken(id: string): void {
    try {
        const file = tokenFile(id);
        if (fs.existsSync(file)) fs.rmSync(file);
    } catch (err) {
        console.error(`[connectors] failed to clear token for ${id}:`, err);
    }
}
