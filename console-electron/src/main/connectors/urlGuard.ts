// console-electron/src/main/connectors/urlGuard.ts
//
// SSRF guard for renderer-controlled URLs in connector "extra" fields. A
// connector's API key is sent to whatever host the extra names (e.g. PostHog's
// 'host'), so an unvalidated free-text URL is a credential-exfiltration and
// SSRF vector: point it at an attacker host to steal the key, or at a private /
// link-local / cloud-metadata address to reach internal services from main.
//
// Policy: require https:, reject everything that resolves to loopback, private,
// link-local, or the cloud-metadata IP. We reject (throw / return an error)
// rather than coercing, so the user sees an honest failure.

// Thrown by assertSafeExternalUrl so callers can surface a clean message.
export class UnsafeUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsafeUrlError';
    }
}

// Extra-field keys whose values are URLs and must pass the SSRF guard. Keep
// this in one place so future URL extras inherit the check by naming.
export const URL_EXTRA_KEYS: ReadonlySet<string> = new Set(['host', 'url', 'endpoint', 'baseUrl', 'base_url']);

function isPrivateIPv4(host: string): boolean {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return false;
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return false;
    const [a, b] = o;
    // 0.0.0.0/8, 127.0.0.0/8 (loopback)
    if (a === 0 || a === 127) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (link-local, incl. cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    return false;
}

function normalizeIPv6(host: string): string {
    // new URL() wraps IPv6 in brackets; strip them and any zone id.
    let h = host;
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
    const pct = h.indexOf('%');
    if (pct >= 0) h = h.slice(0, pct);
    return h.toLowerCase();
}

function isPrivateIPv6(host: string): boolean {
    const h = normalizeIPv6(host);
    if (h === '::1' || h === '::') return true; // loopback / unspecified
    if (h.startsWith('fe80')) return true; // link-local
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique-local fc00::/7
    // IPv4-mapped (::ffff:127.0.0.1 etc.) — pull the trailing dotted quad.
    const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
    if (v4 && isPrivateIPv4(v4[1])) return true;
    return false;
}

// Hostnames that name the local machine without being a numeric IP.
function isLocalHostname(host: string): boolean {
    const h = host.toLowerCase().replace(/\.$/, '');
    return h === 'localhost' || h.endsWith('.localhost');
}

// Validate a renderer-supplied URL string. Returns the normalized origin form
// on success; throws UnsafeUrlError with an honest message otherwise.
export function assertSafeExternalUrl(raw: string, label = 'URL'): string {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new UnsafeUrlError(`${label} must be a valid URL.`);
    }
    if (parsed.protocol !== 'https:') {
        throw new UnsafeUrlError(`${label} must use https://.`);
    }
    const host = parsed.hostname;
    if (isLocalHostname(host) || isPrivateIPv4(host) || isPrivateIPv6(host)) {
        throw new UnsafeUrlError(`${label} may not point at a local or private address.`);
    }
    return raw;
}

// Is this extra key one whose value should be URL-guarded?
export function isUrlExtraKey(key: string): boolean {
    return URL_EXTRA_KEYS.has(key);
}
