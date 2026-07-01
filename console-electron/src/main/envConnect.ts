// console-electron/src/main/envConnect.ts
//
// .env auto-connect. Detects services from the project's .env key NAMES (only
// names ever cross to the renderer), and connects a chosen service by reading
// its value TRANSIENTLY in-process, validating + storing it via the same path
// the manual connect uses, then dropping the value. This is exactly what the UI
// disclaimer promises: names-only detection; the value is parsed transiently to
// test + store the connection, never recorded, never sent to AI.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setKey as setAiKey } from './ai/keystore';
import { connectVercel, connectSentry, connectSlack } from './ipc/connections';

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.production'];

interface EnvConnector {
    id: string;
    name: string;
    category: string;
    keyNames: string[];
}

const ENV_CONNECTORS: EnvConnector[] = [
    { id: 'openai', name: 'OpenAI', category: 'ai', keyNames: ['OPENAI_API_KEY'] },
    { id: 'anthropic', name: 'Anthropic', category: 'ai', keyNames: ['ANTHROPIC_API_KEY'] },
    { id: 'google', name: 'Google AI', category: 'ai', keyNames: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'] },
    { id: 'vercel', name: 'Vercel', category: 'host', keyNames: ['VERCEL_TOKEN', 'VERCEL_API_TOKEN'] },
    { id: 'sentry', name: 'Sentry', category: 'observability', keyNames: ['SENTRY_AUTH_TOKEN'] },
    { id: 'slack', name: 'Slack', category: 'messaging', keyNames: ['SLACK_BOT_TOKEN', 'SLACK_TOKEN'] },
];

// Parse .env files into a name->value map. MAIN-PROCESS INTERNAL ONLY: this map
// holds secrets and must never cross the IPC boundary or be logged.
function readEnvMap(root: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!root || typeof root !== 'string') return map;
    const base = path.resolve(root);
    for (const file of ENV_FILES) {
        let contents: string;
        try {
            const full = path.join(base, file);
            if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
            contents = fs.readFileSync(full, 'utf8');
        } catch { continue; }
        for (const rawLine of contents.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const noExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
            const eq = noExport.indexOf('=');
            if (eq <= 0) continue;
            const name = noExport.slice(0, eq).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
            let value = noExport.slice(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (!map.has(name)) map.set(name, value); // .env precedence: first file wins
        }
    }
    return map;
}

export interface EnvConnectable {
    id: string;
    name: string;
    category: string;
    keyName: string; // NAME only - safe to show
}

// Scan .env for services that have a connector and a non-empty value. Returns
// NAMES only; never returns or logs any value.
export function scanConnectable(root: string): EnvConnectable[] {
    const map = readEnvMap(root);
    const out: EnvConnectable[] = [];
    for (const c of ENV_CONNECTORS) {
        const keyName = c.keyNames.find((n) => (map.get(n) ?? '').length > 0);
        if (keyName) out.push({ id: c.id, name: c.name, category: c.category, keyName });
    }
    return out;
}

// Connect one service using its .env value, read transiently in-process. Never
// returns the value. Dispatches to the same validate+store path the manual
// connect uses (AI keystore for providers; the token connectors otherwise).
export async function connectFromEnv(root: string, serviceId: string): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const c = ENV_CONNECTORS.find((x) => x.id === serviceId);
    if (!c) return { ok: false, error: 'Unknown service.' };
    const map = readEnvMap(root);
    const keyName = c.keyNames.find((n) => (map.get(n) ?? '').length > 0);
    if (!keyName) return { ok: false, error: `No ${c.name} key found in .env.` };
    const value = (map.get(keyName) ?? '').trim(); // transient
    try {
        if (c.id === 'openai' || c.id === 'anthropic' || c.id === 'google') {
            return setAiKey(c.id, value) ? { ok: true, detail: c.name } : { ok: false, error: 'OS encryption is unavailable.' };
        }
        if (c.id === 'vercel') { const r = await connectVercel(value); return { ok: r.ok, detail: r.user, error: r.error }; }
        if (c.id === 'slack') { const r = await connectSlack(value); return { ok: r.ok, detail: r.team, error: r.error }; }
        if (c.id === 'sentry') { const r = await connectSentry(value, (map.get('SENTRY_ORG') ?? '').trim()); return { ok: r.ok, detail: r.org, error: r.error }; }
        return { ok: false, error: 'No connector for this service.' };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
