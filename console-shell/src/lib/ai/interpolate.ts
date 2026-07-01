// console-shell/src/lib/ai/interpolate.ts
//
// Pure {{var}} substitution for the prompt library. Shared by the variable
// form and the live preview so a prompt renders the same wherever it shows.

// One {{name}} reference. Names are word-ish (letters, digits, underscore,
// dot, dash) so a stray "{{" in prose without a valid name is left alone.
const VAR_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

// Every distinct variable name referenced in a body, in first-seen order.
export function extractVariableNames(body: string): string[] {
    if (typeof body !== 'string') return [];
    const seen = new Set<string>();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(body)) !== null) {
        const name = m[1];
        if (!seen.has(name)) {
            seen.add(name);
            out.push(name);
        }
    }
    return out;
}

// Replace each {{name}} with values[name]. An unfilled name stays as its
// literal {{name}} so the user can see what is still missing in the preview.
export function interpolate(body: string, values: Record<string, string>): string {
    if (typeof body !== 'string') return '';
    return body.replace(VAR_RE, (whole, name: string) => {
        const v = values[name];
        return typeof v === 'string' && v.length > 0 ? v : whole;
    });
}

// True once every referenced variable has a non-empty value.
export function allFilled(body: string, values: Record<string, string>): boolean {
    return extractVariableNames(body).every((n) => {
        const v = values[n];
        return typeof v === 'string' && v.trim().length > 0;
    });
}
