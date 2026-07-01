// console-electron/src/main/design-system.ts
//
// Deterministic (no-AI) design-system detector. It reads a project's Tailwind
// config (v3 static parse, or v4 CSS-first @theme blocks), shadcn components.json,
// and CSS custom-property token blocks, plus its component libraries from
// package.json, and returns one normalised DesignSystem. Read-only and bounded:
// a fixed candidate-file set, capped reads, never writes into the scanned project.
// Colour values are kept AS AUTHORED (e.g. "oklch(0.55 0.2 256)") so the UI can
// render them natively; no colour-space conversion is done here.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface NamedToken { name: string; value: string; resolved?: boolean }
export interface ColorToken extends NamedToken { theme?: string }
export interface TypeStep { name: string; fontSize: string; lineHeight?: string; letterSpacing?: string; fontWeight?: string }
export interface RadiusToken extends NamedToken { px?: number }
export interface LibraryHit { id: string; label: string; version?: string; declared: boolean; imported: boolean }

export interface DesignSystem {
    tailwind?: {
        source: string;
        version: '3' | '4' | 'unknown';
        cssFirst?: boolean;
        customVariants?: NamedToken[];
        unresolved?: string[];
    };
    shadcn?: {
        style?: string;
        baseColor?: string;
        cssVariables?: boolean;
        iconLibrary?: string;
        tailwindCss?: string;
    };
    tokens: {
        colors: ColorToken[];
        fonts: NamedToken[];
        spacing: NamedToken[];
        radii: RadiusToken[];
        typeScale: TypeStep[];
    };
    themes: { name: string; vars: Record<string, string> }[];
    libraries: string[];
    libraryDetails: LibraryHit[];
    sources: string[];
    scannedAt: string;
    error?: string;
}

const MAX_BYTES = 512 * 1024;

function resolveRoot(input: string): string | null {
    if (typeof input !== 'string' || input.trim().length === 0) return null;
    const abs = path.resolve(input);
    try { if (!fs.statSync(abs).isDirectory()) return null; } catch { return null; }
    return abs;
}

function read(file: string): string | null {
    try { return fs.readFileSync(file, 'utf8').slice(0, MAX_BYTES); } catch { return null; }
}
function readJson(file: string): Record<string, unknown> | null {
    const raw = read(file);
    if (raw == null) return null;
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}
function exists(file: string): boolean {
    try { return fs.statSync(file).isFile(); } catch { return false; }
}
function firstExisting(root: string, candidates: string[]): string | null {
    for (const c of candidates) { const f = path.join(root, c); if (exists(f)) return f; }
    return null;
}
function isDir(p: string): boolean { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

// Where the front-end app actually lives. In a monorepo the design system is
// under apps/web/ (or similar), not the repo root - the old root-only lookup is
// exactly why a real shadcn repo read as "no design tokens found". Returns the
// first base (relative to root, '' = root) that carries a design-system signal.
const MONO_BASES = [
    '', 'apps/web', 'apps/app', 'apps/frontend', 'apps/client', 'apps/console', 'apps/ui',
    'web', 'frontend', 'client', 'app', 'packages/web', 'packages/ui', 'packages/app',
    'console-shell', 'src',
];
const CSS_NAMES = [
    'src/styles/globals.css', 'src/index.css', 'src/styles/index.css',
    'src/app/globals.css', 'app/globals.css', 'styles/globals.css', 'globals.css', 'index.css',
];
const TW_CONFIG_NAMES = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs'];

function detectBase(root: string): string {
    for (const b of MONO_BASES) {
        const dir = b ? path.join(root, b) : root;
        if (b && !isDir(dir)) continue;
        if (exists(path.join(dir, 'components.json'))) return b;
        if (TW_CONFIG_NAMES.some((c) => exists(path.join(dir, c)))) return b;
        if (CSS_NAMES.some((c) => exists(path.join(dir, c)))) return b;
    }
    return '';
}
function under(base: string, names: string[]): string[] {
    return base ? names.map((n) => `${base}/${n}`) : names;
}

// Capture the substring of a balanced {...} block starting at the first '{'
// after `fromIndex`. Returns the inner text (without the outer braces).
function braceBlock(text: string, fromIndex: number): string | null {
    const start = text.indexOf('{', fromIndex);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start + 1, i); }
    }
    return null;
}

// Pull `--name: value;` declarations out of a CSS block body.
function cssDecls(body: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) out[m[1].trim()] = m[2].trim();
    return out;
}

// Resolve var(--x) one level against a token map (depth-capped, cycle-guarded).
function resolveVar(value: string, vars: Record<string, string>, depth = 0): { value: string; resolved: boolean } {
    if (depth > 5) return { value, resolved: false };
    const m = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim());
    if (!m) return { value, resolved: !/var\(/.test(value) };
    const next = vars[m[1]];
    if (next == null) return { value, resolved: false };
    return resolveVar(next, vars, depth + 1);
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|transparent\b|currentColor\b)/;
function looksLikeColor(v: string): boolean { return COLOR_RE.test(v.trim()); }

// ------------------------------- main CSS ----------------------------------

// The entry CSS that does @import "tailwindcss", following one hop of @import so
// split token files are read too. Returns concatenated CSS + the source paths.
function readMainCss(root: string, fromShadcn: string | null, base: string): { css: string; sources: string[] } | null {
    const candidates = [
        fromShadcn,
        ...under(base, CSS_NAMES),
        ...CSS_NAMES,
    ].filter(Boolean) as string[];
    const entry = firstExisting(root, candidates);
    if (!entry) return null;
    const sources: string[] = [];
    let css = '';
    const load = (file: string, hop: number) => {
        if (hop > 1 || sources.length > 12) return;
        const body = read(file);
        if (body == null) return;
        sources.push(path.relative(root, file).replace(/\\/g, '/'));
        css += '\n' + body;
        const dir = path.dirname(file);
        const importRe = /@import\s+["']([^"']+\.css)["']/g;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(body)) !== null) {
            const imp = path.resolve(dir, m[1]);
            if (exists(imp)) load(imp, hop + 1);
        }
    };
    load(entry, 0);
    return { css, sources };
}

// --------------------------- token extraction ------------------------------

function parseThemeBlocks(css: string, ds: DesignSystem, baseVars: Record<string, string>): void {
    const themeRe = /@theme(\s+inline)?\s*\{/g;
    let m: RegExpExecArray | null;
    const seenColor = new Set<string>();
    while ((m = themeRe.exec(css)) !== null) {
        const body = braceBlock(css, m.index);
        if (!body) continue;
        const decls = cssDecls(body);
        // Type-scale steps: --text-<stem> plus paired --text-<stem>--line-height etc.
        const steps = new Map<string, TypeStep>();
        for (const [name, val] of Object.entries(decls)) {
            if (name.startsWith('--color-')) {
                const r = resolveVar(val, baseVars);
                const key = `${name}|${r.value}`;
                if (!seenColor.has(key)) {
                    seenColor.add(key);
                    ds.tokens.colors.push({ name: name.replace('--color-', ''), value: r.value, resolved: r.resolved, theme: 'base' });
                }
            } else if (name.startsWith('--font-')) {
                ds.tokens.fonts.push({ name: name.replace('--font-', ''), value: val });
            } else if (/^--radius(-|$)/.test(name)) {
                ds.tokens.radii.push({ name: name.replace('--radius-', '').replace('--radius', 'base') || 'base', value: val });
            } else if (/^--spacing(-|$)/.test(name)) {
                ds.tokens.spacing.push({ name: name.replace('--spacing-', '').replace('--spacing', 'base') || 'base', value: val });
            } else if (name.startsWith('--text-')) {
                const rest = name.replace('--text-', '');
                const dash = rest.indexOf('--');
                const stem = dash === -1 ? rest : rest.slice(0, dash);
                const sub = dash === -1 ? '' : rest.slice(dash + 2);
                const step = steps.get(stem) ?? { name: stem, fontSize: '' };
                if (sub === '') step.fontSize = val;
                else if (sub === 'line-height') step.lineHeight = val;
                else if (sub === 'letter-spacing') step.letterSpacing = val;
                else if (sub === 'font-weight') step.fontWeight = val;
                steps.set(stem, step);
            }
        }
        for (const s of steps.values()) if (s.fontSize) ds.tokens.typeScale.push(s);
    }
    // @custom-variant signals dark-mode strategy.
    const cv: NamedToken[] = [];
    const cvRe = /@custom-variant\s+([A-Za-z0-9-]+)\s*\(([^)]*)\)/g;
    while ((m = cvRe.exec(css)) !== null) cv.push({ name: m[1], value: m[2].trim() });
    if (cv.length) (ds.tailwind ??= { source: '', version: '4', cssFirst: true }).customVariants = cv;
}

// Selector token blocks (:root / .dark / [data-theme]) -> themes + palette.
function parseCssThemes(css: string, ds: DesignSystem): Record<string, string> {
    const selectors: { name: string; re: RegExp }[] = [
        // ":root {" (the light base). Not ":root.dark {" (that is handled by the
        // .dark matcher) - the \s*\{ guard keeps it to a bare :root block.
        { name: 'light', re: /:root\s*\{/g },
        { name: 'dark', re: /\.dark\s*\{/g },
        { name: 'light', re: /\[data-theme=["']?light["']?\]\s*\{/g },
        { name: 'dark', re: /\[data-theme=["']?dark["']?\]\s*\{/g },
    ];
    const themes: { name: string; vars: Record<string, string> }[] = [];
    let base: Record<string, string> = {};
    for (const sel of selectors) {
        let m: RegExpExecArray | null;
        while ((m = sel.re.exec(css)) !== null) {
            const body = braceBlock(css, m.index + m[0].length - 1);
            if (!body) continue;
            const vars = cssDecls(body);
            if (Object.keys(vars).length === 0) continue;
            const existing = themes.find((t) => t.name === sel.name);
            if (existing) Object.assign(existing.vars, vars);
            else themes.push({ name: sel.name, vars });
            if (sel.name === 'light') base = { ...base, ...vars };
        }
    }
    ds.themes = themes;
    // Promote colour-valued vars from the light theme into the palette.
    const seen = new Set(ds.tokens.colors.map((c) => `${c.name}|${c.value}`));
    const light = themes.find((t) => t.name === 'light');
    if (light) {
        for (const [name, val] of Object.entries(light.vars)) {
            const r = resolveVar(val, base);
            if (!looksLikeColor(r.value)) continue;
            const clean = name.replace(/^--/, '').replace(/^color-/, '');
            const key = `${clean}|${r.value}`;
            if (seen.has(key)) continue;
            seen.add(key);
            ds.tokens.colors.push({ name: clean, value: r.value, resolved: r.resolved, theme: 'light' });
        }
    }
    return base;
}

// --------------------------- tailwind v3 config ----------------------------

function parseTailwindV3(text: string, ds: DesignSystem, source: string): void {
    const extendIdx = text.indexOf('extend');
    const scope = extendIdx === -1 ? text : (braceBlock(text, extendIdx) ?? text);
    const grabPairs = (key: string, bucket: NamedToken[], strip = '') => {
        const idx = scope.indexOf(`${key}:`);
        if (idx === -1) return;
        const body = braceBlock(scope, idx);
        if (!body) return;
        const re = /['"]?([A-Za-z0-9._-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(body)) !== null) bucket.push({ name: m[1].replace(strip, ''), value: m[2] });
    };
    const colors: NamedToken[] = [];
    grabPairs('colors', colors);
    for (const c of colors) if (!ds.tokens.colors.some((x) => x.name === c.name)) ds.tokens.colors.push({ ...c, theme: 'config' });
    grabPairs('fontFamily', ds.tokens.fonts);
    grabPairs('spacing', ds.tokens.spacing);
    grabPairs('borderRadius', ds.tokens.radii);
    ds.tailwind = { source, version: '3' };
}

// ----------------------------- libraries -----------------------------------

const LIB_REGISTRY: { match: (dep: string) => boolean; id: string; label: string }[] = [
    { match: (d) => d === '@mui/material', id: 'mui', label: 'MUI' },
    { match: (d) => d === '@chakra-ui/react', id: 'chakra', label: 'Chakra UI' },
    { match: (d) => d === '@mantine/core', id: 'mantine', label: 'Mantine' },
    { match: (d) => d === 'antd', id: 'antd', label: 'Ant Design' },
    { match: (d) => d === 'react-bootstrap', id: 'react-bootstrap', label: 'React-Bootstrap' },
    { match: (d) => d.startsWith('@radix-ui/'), id: 'radix', label: 'Radix UI' },
    { match: (d) => d === '@headlessui/react', id: 'headlessui', label: 'Headless UI' },
    { match: (d) => d === '@nextui-org/react' || d === '@heroui/react', id: 'heroui', label: 'HeroUI' },
    { match: (d) => d === 'react-aria' || d === 'react-aria-components', id: 'react-aria', label: 'React Aria' },
    { match: (d) => d === 'daisyui', id: 'daisyui', label: 'daisyUI' },
    { match: (d) => d === 'lucide-react', id: 'lucide', label: 'Lucide icons' },
    { match: (d) => d === 'framer-motion' || d === 'motion', id: 'framer', label: 'Framer Motion' },
    { match: (d) => d === 'tailwindcss', id: 'tailwind', label: 'Tailwind CSS' },
];

function detectLibraries(deps: Record<string, string>): LibraryHit[] {
    const out = new Map<string, LibraryHit>();
    for (const [dep, ver] of Object.entries(deps)) {
        for (const r of LIB_REGISTRY) {
            if (r.match(dep)) {
                const cur = out.get(r.id);
                out.set(r.id, { id: r.id, label: r.label, version: cur?.version ?? ver, declared: true, imported: false });
            }
        }
    }
    return [...out.values()];
}

// ------------------------------- assemble ----------------------------------

export function scanDesignSystem(projectRoot: string): DesignSystem {
    const scannedAt = new Date().toISOString();
    const ds: DesignSystem = {
        tokens: { colors: [], fonts: [], spacing: [], radii: [], typeScale: [] },
        themes: [], libraries: [], libraryDetails: [], sources: [], scannedAt,
    };
    const root = resolveRoot(projectRoot);
    if (!root) return { ...ds, error: 'invalid project root' };

    // package.json (+ one level of workspace children) for deps + libraries.
    const deps: Record<string, string> = {};
    const addPkg = (file: string) => {
        const json = readJson(file);
        if (!json) return;
        ds.sources.push(path.relative(root, file).replace(/\\/g, '/'));
        for (const k of ['dependencies', 'devDependencies']) {
            const d = json[k] as Record<string, string> | undefined;
            if (d && typeof d === 'object') Object.assign(deps, d);
        }
    };
    if (exists(path.join(root, 'package.json'))) addPkg(path.join(root, 'package.json'));
    for (const sub of ['console-shell', 'src', 'app', 'web', 'packages']) {
        const childPkg = path.join(root, sub, 'package.json');
        if (exists(childPkg)) addPkg(childPkg);
    }
    // Find where the front-end app lives (root, or apps/web/... in a monorepo).
    const base = detectBase(root);

    ds.libraryDetails = detectLibraries(deps);
    if ('shadcn' in deps || firstExisting(root, under(base, ['components.json']).concat('components.json', 'console-shell/components.json'))) {
        if (!ds.libraryDetails.some((l) => l.id === 'shadcn')) ds.libraryDetails.push({ id: 'shadcn', label: 'shadcn/ui', declared: true, imported: false });
    }
    ds.libraries = ds.libraryDetails.map((l) => l.label);

    // shadcn components.json (front-end base, then root / console-shell).
    const cjPath = firstExisting(root, under(base, ['components.json']).concat('components.json', 'console-shell/components.json'));
    let shadcnCss: string | null = null;
    if (cjPath) {
        ds.sources.push(path.relative(root, cjPath).replace(/\\/g, '/'));
        const cj = readJson(cjPath);
        const tw = cj?.tailwind as Record<string, unknown> | undefined;
        ds.shadcn = {
            style: typeof cj?.style === 'string' ? cj.style : undefined,
            baseColor: tw && typeof tw.baseColor === 'string' ? tw.baseColor : undefined,
            cssVariables: tw && typeof tw.cssVariables === 'boolean' ? tw.cssVariables : undefined,
            iconLibrary: typeof cj?.iconLibrary === 'string' ? cj.iconLibrary : undefined,
            tailwindCss: tw && typeof tw.tailwindCss === 'string' ? tw.tailwindCss
                : tw && typeof tw.css === 'string' ? tw.css : undefined,
        };
        if (ds.shadcn.tailwindCss) {
            const base = path.dirname(cjPath);
            const cssCandidate = path.resolve(base, ds.shadcn.tailwindCss);
            if (exists(cssCandidate)) shadcnCss = path.relative(root, cssCandidate).replace(/\\/g, '/');
        }
    }

    // Tailwind config (v3) - static parse, never executed.
    const cfg = firstExisting(root, under(base, TW_CONFIG_NAMES).concat(TW_CONFIG_NAMES,
        ['console-shell/tailwind.config.ts', 'console-shell/tailwind.config.js']));
    if (cfg) {
        const text = read(cfg);
        if (text) { ds.sources.push(path.relative(root, cfg).replace(/\\/g, '/')); parseTailwindV3(text, ds, path.relative(root, cfg).replace(/\\/g, '/')); }
    }

    // Main CSS (v4 CSS-first + CSS custom-property themes).
    const main = readMainCss(root, shadcnCss, base);
    if (main) {
        ds.sources.push(...main.sources);
        const isV4 = /@import\s+["']tailwindcss["']|@tailwind\b/.test(main.css);
        const base = parseCssThemes(main.css, ds);
        parseThemeBlocks(main.css, ds, base);
        if (isV4) {
            ds.tailwind = { ...(ds.tailwind ?? {}), source: ds.tailwind?.source || main.sources[0] || '', version: '4', cssFirst: true };
        }
    }
    if (!ds.tailwind && cfg) { /* v3 already set above */ }

    ds.sources = [...new Set(ds.sources)];
    return ds;
}

// ---------------------------------------------------------------------------
// DesignSystemReport - flattened summary shape for console:design.detect
// ---------------------------------------------------------------------------

export interface TailwindReport {
    version: '3' | '4' | 'unknown';
    tokenCount: number;
    colors: { name: string; value: string }[];
}

export interface ShadcnReport {
    style?: string;
    baseColor?: string;
    cssVariables?: boolean;
    iconLibrary?: string;
}

export interface DesignSystemReport {
    ok: boolean;
    tailwind: TailwindReport | null;
    shadcn: ShadcnReport | null;
    cssVars: { name: string; value: string }[];
    libraries: string[];
    fonts: string[];
    error?: string;
}

export function detectDesignSystem(projectRoot: string): DesignSystemReport {
    let ds: DesignSystem;
    try {
        ds = scanDesignSystem(projectRoot);
    } catch (err) {
        return { ok: false, tailwind: null, shadcn: null, cssVars: [], libraries: [], fonts: [], error: err instanceof Error ? err.message : String(err) };
    }

    if (ds.error) {
        return { ok: false, tailwind: null, shadcn: null, cssVars: [], libraries: [], fonts: [], error: ds.error };
    }

    const tailwind: TailwindReport | null = ds.tailwind
        ? {
            version: ds.tailwind.version,
            tokenCount: ds.tokens.colors.length + ds.tokens.fonts.length + ds.tokens.spacing.length + ds.tokens.radii.length,
            colors: ds.tokens.colors.map((c) => ({ name: c.name, value: c.value })),
        }
        : null;

    const shadcn: ShadcnReport | null = ds.shadcn
        ? {
            style: ds.shadcn.style,
            baseColor: ds.shadcn.baseColor,
            cssVariables: ds.shadcn.cssVariables,
            iconLibrary: ds.shadcn.iconLibrary,
        }
        : null;

    // Collect CSS custom-property vars from all themes; light theme is primary.
    const seen = new Set<string>();
    const cssVars: { name: string; value: string }[] = [];
    for (const t of ds.themes) {
        for (const [name, value] of Object.entries(t.vars)) {
            if (!seen.has(name)) {
                seen.add(name);
                cssVars.push({ name, value });
            }
        }
    }

    const fonts = ds.tokens.fonts.map((f) => f.value).filter(Boolean);

    return { ok: true, tailwind, shadcn, cssVars, libraries: ds.libraries, fonts };
}
