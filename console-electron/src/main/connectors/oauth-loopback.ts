// console-electron/src/main/connectors/oauth-loopback.ts
//
// OAuth 2.0 authorization-code + PKCE for a desktop app, via a loopback redirect.
// A short-lived http server on 127.0.0.1 catches the provider's redirect, then
// the code is exchanged for a token. Provider-agnostic: a connector supplies the
// endpoints + client id. The token never touches the renderer; the caller stores
// it. openUrl is injectable so a test can drive the redirect without a browser.
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { shell } from 'electron';

export interface OAuthConfig {
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    scopes?: string[];
    usePkce?: boolean; // default true (public desktop client)
    extraAuthParams?: Record<string, string>;
}
export interface OAuthResult { ok: boolean; accessToken?: string; refreshToken?: string; error?: string }

function b64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function exchangeCode(config: OAuthConfig, code: string, verifier: string, redirectUri: string): Promise<OAuthResult> {
    try {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: config.clientId,
        });
        if (config.usePkce !== false) body.set('code_verifier', verifier);
        const res = await fetch(config.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body,
        });
        if (!res.ok) return { ok: false, error: `Token exchange failed (${res.status}).` };
        const data = (await res.json()) as { access_token?: string; refresh_token?: string };
        if (!data.access_token) return { ok: false, error: 'The provider returned no access token.' };
        return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export function runOAuthLoopback(config: OAuthConfig, opts?: { openUrl?: (url: string) => void; timeoutMs?: number }): Promise<OAuthResult> {
    return new Promise((resolve) => {
        const state = b64url(crypto.randomBytes(16));
        const verifier = b64url(crypto.randomBytes(32));
        const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
        let settled = false;
        let redirectUri = '';

        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<!doctype html><meta charset="utf-8"><body style="font:14px sans-serif;padding:2rem">You can close this tab and return to Console.</body>');
            const code = url.searchParams.get('code');
            const retState = url.searchParams.get('state');
            if (!code || retState !== state) { finish({ ok: false, error: 'OAuth callback was missing a code or its state did not match.' }); return; }
            void exchangeCode(config, code, verifier, redirectUri).then(finish);
        });

        const timer = setTimeout(() => finish({ ok: false, error: 'OAuth timed out waiting for authorization.' }), opts?.timeoutMs ?? 180_000);
        function finish(r: OAuthResult): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { server.close(); } catch { /* already closed */ }
            resolve(r);
        }

        server.on('error', (e) => finish({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            redirectUri = `http://127.0.0.1:${port}/callback`;
            const authUrl = new URL(config.authUrl);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('client_id', config.clientId);
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('state', state);
            if (config.usePkce !== false) {
                authUrl.searchParams.set('code_challenge', challenge);
                authUrl.searchParams.set('code_challenge_method', 'S256');
            }
            if (config.scopes?.length) authUrl.searchParams.set('scope', config.scopes.join(' '));
            for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) authUrl.searchParams.set(k, v);
            const open = opts?.openUrl ?? ((u: string) => { void shell.openExternal(u); });
            open(authUrl.toString());
        });
    });
}
