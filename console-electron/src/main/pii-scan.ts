// console-electron/src/main/pii-scan.ts
//
// Deterministic (no-AI, no-network) scanner for PII and secrets that a user
// might inadvertently include in a prompt, AGENTS.md, .env values, or any
// text handed to an agent.
//
// Detected kinds: email, phone-us, ssn-us, credit-card (Luhn-validated),
// ipv4, jwt, aws-key, google-api-key, slack-token, github-pat, openai-key,
// anthropic-key.
//
// Contract: NEVER return the raw match. Every finding carries a redacted
// preview that shows at most the last 4 characters. The caller receives
// counts per kind so the UI can give a summary without ever logging the
// raw data.
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Public types ─────────────────────────────────────────────────────────────

export type PiiKind =
    | 'email'
    | 'phone-us'
    | 'ssn-us'
    | 'credit-card'
    | 'ipv4'
    | 'jwt'
    | 'aws-key'
    | 'google-api-key'
    | 'slack-token'
    | 'github-pat'
    | 'openai-key'
    | 'anthropic-key';

export interface PiiFinding {
    kind: PiiKind;
    redacted: string; // everything except last 4 chars replaced with ***
    line: number;
    col: number;
}

export interface PiiScanResult {
    ok: boolean;
    error?: string;
    findings: PiiFinding[];
    counts: Record<PiiKind, number>;
}

// ── Pattern table ─────────────────────────────────────────────────────────────

// Each entry: kind + regex (must be non-global so exec returns index).
// Order matters when patterns overlap (more-specific patterns come first).
interface Pattern {
    kind: PiiKind;
    re: RegExp;
    validate?: (raw: string) => boolean;
}

const PATTERNS: Pattern[] = [
    // Anthropic / OpenAI keys before generic sk- pattern.
    { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
    { kind: 'openai-key',    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
    // AWS access key: AKIA + 16 uppercase alphanums.
    { kind: 'aws-key',       re: /\bAKIA[0-9A-Z]{16}\b/ },
    // Google API key: AIza + 35 chars.
    { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    // Slack tokens: xoxb, xoxa, xoxp, xoxr, xoxs.
    { kind: 'slack-token',   re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
    // GitHub PATs: ghp_ or github_pat_ prefix.
    { kind: 'github-pat',    re: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/ },
    // JWT: three base64url segments separated by dots.
    { kind: 'jwt',           re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
    // Credit card: 13-19 digit sequence (spaces/dashes allowed), Luhn-validated.
    { kind: 'credit-card',   re: /\b(?:\d[ -]?){13,19}\b/, validate: luhn },
    // US SSN: ddd-dd-dddd or ddddddddd.
    { kind: 'ssn-us',        re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/ },
    // IPv4: four octets 0-255.
    { kind: 'ipv4',          re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/ },
    // US phone: +1-NXX-NXX-XXXX or (NXX) NXX-XXXX or NXX-NXX-XXXX variants.
    { kind: 'phone-us',      re: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/ },
    // Email: RFC-ish simple match.
    { kind: 'email',         re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/ },
];

// ── Luhn validation ───────────────────────────────────────────────────────────

function luhn(raw: string): boolean {
    const digits = raw.replace(/[ -]/g, '');
    if (!/^\d{13,19}$/.test(digits)) return false;
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

// ── Redaction ─────────────────────────────────────────────────────────────────

function redact(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length <= 4) return '***';
    return `***${trimmed.slice(-4)}`;
}

// ── Core scanner ──────────────────────────────────────────────────────────────

const MAX_LINE_LEN = 4000;
const MAX_FINDINGS = 200;

function emptyResult(): PiiScanResult {
    const counts = {} as Record<PiiKind, number>;
    (PATTERNS.map((p) => p.kind) as PiiKind[]).forEach((k) => { counts[k] = 0; });
    return { ok: true, findings: [], counts };
}

export function scanText(text: string): PiiScanResult {
    if (typeof text !== 'string') {
        return { ok: false, error: 'input must be a string', findings: [], counts: emptyResult().counts };
    }
    const result = emptyResult();
    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
        if (result.findings.length >= MAX_FINDINGS) break;
        const line = lines[li];
        if (line.length > MAX_LINE_LEN) continue;
        // Track column offset after consumed chars so multiple hits per line work.
        let remaining = line;
        let colOffset = 0;
        let hitOnLine = false;
        for (const pattern of PATTERNS) {
            if (hitOnLine) break; // one finding per line keeps noise low
            const m = pattern.re.exec(remaining);
            if (!m) continue;
            const raw = m[0];
            if (pattern.validate && !pattern.validate(raw)) continue;
            result.findings.push({
                kind: pattern.kind,
                redacted: redact(raw),
                line: li + 1,
                col: colOffset + m.index + 1,
            });
            result.counts[pattern.kind]++;
            hitOnLine = true;
        }
    }
    return result;
}

// ── File entry point ──────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 512 * 1024;

export function scanFile(projectRoot: string, filePath: string): PiiScanResult {
    const fail = (error: string): PiiScanResult => ({ ok: false, error, findings: [], counts: emptyResult().counts });
    if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) return fail('a project root is required');
    const root = path.resolve(projectRoot);
    const abs = path.resolve(root, filePath);
    // Confine the read to the project directory. A path that climbs out (../)
    // or points elsewhere on disk (an absolute path / other drive) resolves to
    // a `rel` that starts with '..' or is itself absolute; either is refused, so
    // this handler cannot read arbitrary files on the machine (CWE-22).
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return fail('path escapes the project directory');
    let text: string;
    try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) return { ok: false, error: 'not a file', findings: [], counts: emptyResult().counts };
        if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'file too large (> 512 KB)', findings: [], counts: emptyResult().counts };
        text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'read error';
        return { ok: false, error: msg, findings: [], counts: emptyResult().counts };
    }
    return scanText(text);
}
