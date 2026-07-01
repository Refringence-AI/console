// console-electron/src/main/grounding.ts
//
// The "ground" step of the golden path. An error or stack trace names files;
// this pulls those paths out, maps them back to real files in THIS repo (stack
// traces often carry absolute paths from another machine, so we match the
// longest path suffix that exists under the project root), and assembles a fix
// prompt grounded in the paths that actually exist - never a guess. Deterministic,
// read-only, no network.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GroundedError {
    foundPaths: string[];     // repo-relative paths that exist
    mentioned: string[];      // path-like tokens seen but not found in this repo
    prompt: string;           // a ready, grounded fix prompt
}

const PATH_RE =
    /([\w./\\@-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|vue|svelte|css|scss|sass|less|json|ya?ml|sql|sh))(?:[:(]\d+)?/g;

// Files under these dirs exist on disk but are not the user's code - grounding a
// fix in node_modules or build output is never what you want.
const VENDOR_RE = /(^|\/)(node_modules|dist|build|\.next|\.nuxt|out|coverage|vendor|\.git|\.turbo|\.cache|__pycache__|\.venv|venv)(\/|$)/;

function existingSuffix(root: string, candidate: string): string | null {
    // Try the path as-is and every shorter leading-dir-stripped suffix, so an
    // absolute trace path like /ci/app/src/a.ts resolves to src/a.ts here.
    const parts = candidate.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
        const rel = parts.slice(i).join('/');
        const full = path.resolve(root, rel);
        // Stay inside the project root; never confirm a path that escapes it.
        if (!full.startsWith(path.resolve(root) + path.sep) && full !== path.resolve(root)) continue;
        try { if (fs.statSync(full).isFile()) return rel; } catch { /* keep shrinking */ }
    }
    return null;
}

export function groundError(root: string, errorText: string): GroundedError {
    const found = new Set<string>();
    const mentioned = new Set<string>();
    if (typeof root === 'string' && root.length > 0 && typeof errorText === 'string') {
        let m: RegExpExecArray | null;
        PATH_RE.lastIndex = 0;
        while ((m = PATH_RE.exec(errorText)) !== null) {
            const token = m[1];
            if (!token || token.length > 300) continue;
            const rel = existingSuffix(root, token);
            if (rel && !VENDOR_RE.test(rel)) found.add(rel);
            else mentioned.add(token.replace(/\\/g, '/'));
        }
    }
    const foundPaths = [...found].slice(0, 20);
    const mentionedPaths = [...mentioned].slice(0, 20);

    const grounding = foundPaths.length > 0
        ? `The files involved (confirmed present in this repo):\n${foundPaths.map((p) => `- ${p}`).join('\n')}\nStart in ${foundPaths[0]}, then anything it imports.`
        : `I could not find the named files in this repo, so start from the symbols in the error and search for where they are defined.`;

    const prompt =
        `I hit the error below and want the smallest fix.\n\n${grounding}\n\n` +
        `In plain words: what the error means, the most likely cause here, and the smallest change that fixes it. ` +
        `Do not edit yet - tell me the fix and which line, then wait for my go.\n\n` +
        `\`\`\`\n${errorText.trim().slice(0, 4000)}\n\`\`\`\n`;

    return { foundPaths, mentioned: mentionedPaths, prompt };
}
