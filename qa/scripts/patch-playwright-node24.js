#!/usr/bin/env node
// qa/scripts/patch-playwright-node24.js
//
// Patches Playwright 1.61's transform/esmLoader for Node 24+ compatibility.
//
// Node 24 changed `context.conditions` in the module loader API from
// Array<string> to Set<string>. Playwright 1.61 calls `.includes()` on it,
// which fails on Set with:
//
//   TypeError: context.conditions?.includes is not a function
//
// This patch rewrites the two affected lines to use Array.from() before
// .includes(). Idempotent: re-running is safe.
//
// Run automatically via qa/package.json `postinstall` script.
const fs = require('node:fs');
const path = require('node:path');

const PW = path.resolve(__dirname, '..', 'node_modules', 'playwright');
const TARGETS = [
    path.join(PW, 'lib', 'common', 'index.js'),
    path.join(PW, 'lib', 'transform', 'esmLoader.js'),
];

const BROKEN = 'context.conditions?.includes("import")';
const FIXED = '(Array.from(context.conditions ?? [])).includes("import")';
const MARKER = '/* refringence-node24-patch */';

let patched = 0;
let skipped = 0;
let missing = 0;

for (const file of TARGETS) {
    if (!fs.existsSync(file)) {
        console.warn(`[patch-pw-node24] missing: ${file}`);
        missing++;
        continue;
    }
    let body = fs.readFileSync(file, 'utf8');
    if (body.includes(MARKER)) {
        skipped++;
        continue;
    }
    if (!body.includes(BROKEN)) {
        console.warn(`[patch-pw-node24] target line not found in ${file} — Playwright internals may have changed; review manually`);
        skipped++;
        continue;
    }
    const newBody = body.replace(BROKEN, FIXED) + '\n' + MARKER + '\n';
    fs.writeFileSync(file, newBody, 'utf8');
    patched++;
    console.log(`[patch-pw-node24] patched: ${path.relative(process.cwd(), file)}`);
}

console.log(`[patch-pw-node24] patched=${patched} skipped=${skipped} missing=${missing}`);
process.exit(0);
