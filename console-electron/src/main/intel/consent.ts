// Per-project consent for reading the project's .env files. Onboarding asks
// explicitly before any .env is read; the answer is persisted here so every
// later profile build respects it too (not just the onboarding mount).
//
// null  = never asked -> read by default (backward-compatible with repos
//         profiled before this gate existed)
// true  = the user allowed .env key-name detection
// false = the user declined -> .env is never read
import * as fs from 'node:fs';
import * as path from 'node:path';

function consentFile(root: string): string {
    return path.join(root, '.refringence-console', 'consent.json');
}

export function readEnvConsent(root: string): boolean | null {
    try {
        const j = JSON.parse(fs.readFileSync(consentFile(root), 'utf8'));
        return typeof j.env === 'boolean' ? j.env : null;
    } catch {
        return null;
    }
}

export function writeEnvConsent(root: string, allow: boolean): void {
    try {
        const dir = path.join(root, '.refringence-console');
        fs.mkdirSync(dir, { recursive: true });
        let existing: Record<string, unknown> = {};
        try {
            existing = JSON.parse(fs.readFileSync(consentFile(root), 'utf8'));
        } catch {
            /* fresh file */
        }
        existing.env = allow;
        existing.envConsentAt = new Date().toISOString();
        fs.writeFileSync(consentFile(root), JSON.stringify(existing, null, 2));
    } catch {
        /* best-effort; a denied write just means we ask again next time */
    }
}
