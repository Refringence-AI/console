// console-electron/src/main/ipc/architecture-graph.ts
//
// Live architecture dependency graph. Walks the active project, regex-
// extracts import specifiers from every source file across several
// languages (JS/TS, Python, Rust, Go, Java/Kotlin), resolves each to a
// PACKAGE-LEVEL node (top-level dir under the repo root), and aggregates
// package->package edges weighted by import count. Tiers are heuristic
// (inbound/outbound topology); cycles come from Tarjan SCC.
//
// The graph is cached under <project>/.refringence-console/arch-graph-cache.json
// keyed on a signature (per-dir mtime + file count roll-up) so re-opening
// the panel is instant; a real edit busts the signature and triggers a
// recompute, while an unchanged tree hits the cache. The signature walk is
// directory-only (no per-file stat), so it stays cheap on the read path.
//
// A separate overlay file (<project>/.refringence-console/architecture.json)
// holds the user's curated layer: node positions, tier overrides, notes,
// and hidden nodes. The overlay is read/written independently of the graph
// so curation survives a graph recompute.
//
// Every handler is total: it returns an empty graph / null overlay on any
// error rather than throwing into the renderer. projectRoot is resolved and
// guarded against path traversal before any fs access.
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ArchTier = 'shell' | 'presentation' | 'domain' | 'data' | 'infra' | 'test' | 'external';

export interface DependencyNode {
    id: string;
    label: string;
    tier: ArchTier;
    loc: number;
    fileCount: number;
    /** True for nodes synthesised from package.json/go.mod/etc, not walked dirs. */
    external?: boolean;
}

export interface DependencyEdge {
    source: string;
    target: string;
    weight: number;
}

export interface DependencyGraph {
    nodes: DependencyNode[];
    edges: DependencyEdge[];
    cycles: string[][];
    /** Set when the walk hit MAX_FILES/MAX_DEPTH; the renderer shows a banner. */
    truncated: boolean;
    /** Files actually walked. With truncated, this is the cap; else the real count. */
    fileCount: number;
}

export interface ArchGraphOptions {
    includeExternal: boolean;
    // Default false keeps the walk to JS/TS imports only, which is the clean,
    // common case. A large repo of independent non-JS/TS packages renders as a
    // dense wall of disconnected boxes, so the other-language extractors are
    // opt-in.
    allLanguages: boolean;
}

export interface ArchOverlay {
    positions: Record<string, { x: number; y: number }>;
    tierOverrides: Record<string, string>;
    notes: Record<string, string>;
    hidden: string[];
}

const EMPTY_GRAPH: DependencyGraph = {
    nodes: [], edges: [], cycles: [], truncated: false, fileCount: 0,
};

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.refringence-qa',
    '.refringence-console', '__pycache__', '.pio', '.cache', '.venv',
    'tools-src', 'vcpkg', 'src-qt', 'out', '.next', '.parcel-cache', 'target',
]);

// Per-language source extensions. The walk maps each to its language so the
// right extractor runs; an unknown extension is skipped entirely.
const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXTS = new Set(['.py', '.pyi']);
const RUST_EXTS = new Set(['.rs']);
const GO_EXTS = new Set(['.go']);
const JVM_EXTS = new Set(['.java', '.kt', '.kts']);

type Lang = 'js' | 'py' | 'rust' | 'go' | 'jvm';

// allLanguages off => only JS/TS is recognised, so the Python/Rust/Go/JVM
// extractors never run and their packages never enter the graph.
function langForExt(ext: string, allLanguages: boolean): Lang | null {
    if (JS_EXTS.has(ext)) return 'js';
    if (!allLanguages) return null;
    if (PY_EXTS.has(ext)) return 'py';
    if (RUST_EXTS.has(ext)) return 'rust';
    if (GO_EXTS.has(ext)) return 'go';
    if (JVM_EXTS.has(ext)) return 'jvm';
    return null;
}

// Raised from 12/8000: real monorepos nest deeper and carry more files, and
// truncation is now surfaced (not silent) so a cap is a banner, not a lie.
const MAX_DEPTH = 24;
const MAX_FILES = 30000;
const MAX_FILE_BYTES = 1_000_000;

// JS/TS: `from '...'`, `require('...')`, dynamic `import('...')`. One
// alternation keeps a single pass per file; the captured spec is the group.
const JS_IMPORT_RE =
    /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

// Python: `import a.b.c` (possibly comma-separated) and `from a.b import c`.
// We capture the dotted module path; the package mapping turns it into a dir.
const PY_FROM_RE = /^\s*from\s+([.\w]+)\s+import\s+/gm;
const PY_IMPORT_RE = /^\s*import\s+([.\w]+(?:\s*,\s*[.\w]+)*)/gm;

// Rust: `use crate::a::b;` / `use crate::a::{b, c};` and `mod foo;`. crate::
// imports stay inside the current crate; mod declares a sibling module file.
const RUST_USE_RE = /^\s*(?:pub\s+)?use\s+(crate::[\w:]+|[\w]+::[\w:]+)/gm;
const RUST_MOD_RE = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;

// Go: a grouped `import ( "a/b" "c/d" )` block or a single `import "a/b"`.
// We capture quoted specifiers; the module path prefix marks intra-module.
const GO_IMPORT_BLOCK_RE = /import\s*\(([\s\S]*?)\)/g;
const GO_IMPORT_SINGLE_RE = /^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm;
const GO_QUOTED_RE = /"([^"]+)"/g;

// Java/Kotlin: `import a.b.C;` (Java) / `import a.b.C` (Kotlin) and the
// file's own `package a.b` declaration, which anchors it to a package.
const JVM_IMPORT_RE = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;?\s*$/gm;
const JVM_PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;?\s*$/m;

interface WalkedFile {
    pkg: string;
    lang: Lang;
}

export interface WalkResult {
    /** abs file path -> package id + language */
    fileToPkg: Map<string, WalkedFile>;
    /** package id -> { loc, fileCount } */
    pkgStats: Map<string, { loc: number; fileCount: number }>;
    /** abs paths of config files found, for alias + external resolution. */
    tsconfigs: string[];
    goMods: string[];
    cargoTomls: string[];
    packageJsons: string[];
    requirementsTxts: string[];
    pyprojectTomls: string[];
    totalFiles: number;
    /** Hit a depth/file cap; the renderer surfaces this as a banner. */
    truncated: boolean;
}

function resolveProjectRoot(input: string | undefined | null): string | null {
    if (!input || input.trim().length === 0) return null;
    const abs = path.resolve(input);
    try {
        if (!fs.statSync(abs).isDirectory()) return null;
    } catch {
        return null;
    }
    return abs;
}

// Path-traversal guard: candidate must live inside (or equal) root.
function isInside(root: string, candidate: string): boolean {
    const rel = path.relative(root, candidate);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// The package a file belongs to = its first path segment under the repo
// root. A nested layout like bundled-tools/my-tool/... would
// otherwise collapse every package into "bundled-tools", so we keep two
// segments for the known monorepo container dirs.
const TWO_SEGMENT_CONTAINERS = new Set([
    'bundled-tools', 'packages', 'apps', 'services', 'libs', 'app', 'plugins', 'modules', 'examples',
]);

export function pkgForRelPath(relPath: string): string {
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length === 0) return relPath;
    if (parts.length >= 2 && TWO_SEGMENT_CONTAINERS.has(parts[0])) {
        return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
}

// Config files we collect during the walk to drive alias + external-dep
// resolution, keyed by basename so the readdir loop is a single lookup.
const CONFIG_NAMES = new Set([
    'tsconfig.json', 'go.mod', 'Cargo.toml', 'package.json', 'requirements.txt', 'pyproject.toml',
]);

export function walkRepo(root: string, allLanguages: boolean): WalkResult {
    const fileToPkg = new Map<string, WalkedFile>();
    const pkgStats = new Map<string, { loc: number; fileCount: number }>();
    const tsconfigs: string[] = [];
    const goMods: string[] = [];
    const cargoTomls: string[] = [];
    const packageJsons: string[] = [];
    const requirementsTxts: string[] = [];
    const pyprojectTomls: string[] = [];
    let totalFiles = 0;
    let truncated = false;

    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length > 0) {
        if (totalFiles >= MAX_FILES) {
            truncated = true;
            break;
        }
        const { dir, depth } = stack.pop()!;
        if (depth > MAX_DEPTH) {
            truncated = true;
            continue;
        }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            if (SKIP_DIRS.has(ent.name)) continue;
            if (ent.name.startsWith('.')) continue;
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                stack.push({ dir: abs, depth: depth + 1 });
            } else if (ent.isFile()) {
                if (CONFIG_NAMES.has(ent.name)) {
                    if (ent.name === 'tsconfig.json') tsconfigs.push(abs);
                    else if (ent.name === 'go.mod') goMods.push(abs);
                    else if (ent.name === 'Cargo.toml') cargoTomls.push(abs);
                    else if (ent.name === 'package.json') packageJsons.push(abs);
                    else if (ent.name === 'requirements.txt') requirementsTxts.push(abs);
                    else if (ent.name === 'pyproject.toml') pyprojectTomls.push(abs);
                    continue;
                }
                const ext = path.extname(ent.name).toLowerCase();
                const lang = langForExt(ext, allLanguages);
                if (!lang) continue;
                let stat: fs.Stats;
                try {
                    stat = fs.statSync(abs);
                } catch {
                    continue;
                }
                if (stat.size > MAX_FILE_BYTES) continue;
                const rel = path.relative(root, abs).replace(/\\/g, '/');
                const pkg = pkgForRelPath(rel);
                fileToPkg.set(abs, { pkg, lang });
                let loc = 0;
                try {
                    loc = fs.readFileSync(abs, 'utf8').split('\n').length;
                } catch {
                    /* count the file even if unreadable */
                }
                const cur = pkgStats.get(pkg) ?? { loc: 0, fileCount: 0 };
                cur.loc += loc;
                cur.fileCount += 1;
                pkgStats.set(pkg, cur);
                totalFiles += 1;
            }
        }
    }
    return {
        fileToPkg, pkgStats, tsconfigs, goMods, cargoTomls,
        packageJsons, requirementsTxts, pyprojectTomls, totalFiles, truncated,
    };
}

// One tsconfig's resolved path aliases. baseUrl + each pattern is made
// absolute so an aliased specifier collapses to a real on-disk prefix.
interface TsAlias {
    /** alias prefix with a trailing wildcard stripped, e.g. '@/' */
    prefix: string;
    /** whether the alias matched on a trailing '*' (substitution) */
    wildcard: boolean;
    /** absolute on-disk targets the alias maps to */
    targets: string[];
}

// A Go module / Rust crate root: an import-path prefix and the dir it anchors.
interface ModuleRoot {
    importPrefix: string;
    dir: string;
}

interface ResolveContext {
    root: string;
    fileToPkg: Map<string, WalkedFile>;
    /** Resolved tsconfig aliases, longest-prefix-first. */
    tsAliases: TsAlias[];
    /** go.mod module paths, longest-prefix-first. */
    goModules: ModuleRoot[];
    /** abs file path -> its crate dir, for Rust intra-crate detection. */
    cargoCrateDir: (fromAbs: string) => string | null;
    /** declared JVM package (a.b.c) -> repo package id of the declaring file. */
    jvmPackageToPkg: Map<string, string>;
}

// Map an absolute on-disk path (no extension) to its package by probing the
// same candidate set the JS resolver used: the path itself, with each source
// extension, and as a directory index.
function pkgForResolvedPath(base: string, fileToPkg: Map<string, WalkedFile>): string | null {
    const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    for (const e of exts) {
        const hit = fileToPkg.get(base + e);
        if (hit) return hit.pkg;
    }
    const indices = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];
    for (const idx of indices) {
        const hit = fileToPkg.get(path.join(base, idx));
        if (hit) return hit.pkg;
    }
    return null;
}

// JS/TS: relative specifier -> the package the file lands in. A bare spec is
// resolved through tsconfig path aliases (recovering '@/foo'-style edges
// that the relative-only resolver used to drop); anything still unresolved
// is an external dependency.
function resolveJsImport(fromAbs: string, spec: string, ctx: ResolveContext): string | null {
    if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(fromAbs), spec);
        return pkgForResolvedPath(base, ctx.fileToPkg);
    }
    for (const alias of ctx.tsAliases) {
        if (!spec.startsWith(alias.prefix)) continue;
        const rest = spec.slice(alias.prefix.length);
        for (const target of alias.targets) {
            const base = alias.wildcard ? path.join(target, rest) : target;
            const pkg = pkgForResolvedPath(base, ctx.fileToPkg);
            if (pkg) return pkg;
        }
    }
    return null;
}

// Python: a dotted module ('a.b.c') maps to a dir under the repo. We probe
// 'a/b/c.py', 'a/b/c/__init__.py' and return the package of the first that
// exists in the walk. Leading-dot relative imports resolve against the
// importing file's directory.
function resolvePyImport(fromAbs: string, spec: string, ctx: ResolveContext): string | null {
    let base: string;
    if (spec.startsWith('.')) {
        const dots = spec.match(/^\.+/)![0].length;
        let dir = path.dirname(fromAbs);
        for (let i = 1; i < dots; i += 1) dir = path.dirname(dir);
        const tail = spec.slice(dots).split('.').filter(Boolean);
        base = path.join(dir, ...tail);
    } else {
        base = path.join(ctx.root, ...spec.split('.'));
    }
    const candidates = [
        base + '.py', base + '.pyi',
        path.join(base, '__init__.py'), path.join(base, '__init__.pyi'),
    ];
    for (const c of candidates) {
        const hit = ctx.fileToPkg.get(c);
        if (hit) return hit.pkg;
    }
    return null;
}

// Rust: `use crate::...` and `mod foo;` stay inside the file's own crate, so
// they never cross a package boundary (no edge). A cross-crate `other::x`
// maps to that crate's dir when it is a walked workspace member.
function resolveRustImport(fromAbs: string, spec: string, ctx: ResolveContext): string | null {
    if (spec.startsWith('crate::') || !spec.includes('::')) return null;
    const head = spec.split('::')[0];
    if (head === 'self' || head === 'super' || head === 'std' || head === 'core') return null;
    const hit = ctx.fileToPkg.get(path.join(ctx.root, head, 'src', 'lib.rs'))
        ?? ctx.fileToPkg.get(path.join(ctx.root, head, 'src', 'main.rs'));
    if (hit && hit.pkg) {
        const crateDir = ctx.cargoCrateDir(fromAbs);
        if (crateDir && path.basename(crateDir) === head) return null;
        return hit.pkg;
    }
    return null;
}

// Go: a quoted import is intra-module when it starts with the module path
// declared in go.mod. We strip the module prefix to get the in-repo subdir,
// then map that dir to its package. Stdlib + third-party fall through.
function resolveGoImport(spec: string, ctx: ResolveContext): string | null {
    for (const mod of ctx.goModules) {
        if (spec !== mod.importPrefix && !spec.startsWith(mod.importPrefix + '/')) continue;
        const sub = spec === mod.importPrefix ? '' : spec.slice(mod.importPrefix.length + 1);
        const dirAbs = path.join(mod.dir, sub);
        for (const [abs, wf] of ctx.fileToPkg) {
            if (wf.lang === 'go' && path.dirname(abs) === dirAbs) return wf.pkg;
        }
        return null;
    }
    return null;
}

// Java/Kotlin: an `import a.b.C` resolves to the repo package of whichever
// source declared `package a.b`. We match the longest declared package that
// prefixes the import.
function resolveJvmImport(spec: string, ctx: ResolveContext): string | null {
    let probe = spec;
    while (probe.includes('.')) {
        const pkg = ctx.jvmPackageToPkg.get(probe);
        if (pkg) return pkg;
        probe = probe.slice(0, probe.lastIndexOf('.'));
    }
    return null;
}

// Bare JS module -> the dependency name surfaced in the external tier. A
// scoped package keeps its scope ('@scope/x'); a deep import collapses to its
// top-level package ('lodash/merge' -> 'lodash').
function bareModuleName(spec: string): string {
    if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
    return spec.split('/')[0];
}

// A Go import that did not resolve in-module is external only when it looks
// third-party (a dotted host like 'github.com/...'); bare stdlib paths
// ('fmt', 'net/http') are dropped as noise.
function goExternalName(spec: string): string | null {
    if (!spec.includes('.')) return null;
    return spec.split('/').slice(0, 3).join('/');
}

// Extract resolved import targets from one file. Internal targets become
// edges; external specifiers are returned raw for the includeExternal pass.
interface FileImports {
    internal: string[];
    external: string[];
}

function extractFile(abs: string, wf: WalkedFile, body: string, ctx: ResolveContext): FileImports {
    const internal: string[] = [];
    const external: string[] = [];

    if (wf.lang === 'js') {
        JS_IMPORT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = JS_IMPORT_RE.exec(body)) !== null) {
            const spec = m[1];
            if (!spec) continue;
            const target = resolveJsImport(abs, spec, ctx);
            if (target) internal.push(target);
            else if (!spec.startsWith('.')) external.push(bareModuleName(spec));
        }
    } else if (wf.lang === 'py') {
        for (const re of [PY_FROM_RE, PY_IMPORT_RE]) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(body)) !== null) {
                for (const part of m[1].split(',')) {
                    const spec = part.trim();
                    if (!spec) continue;
                    const target = resolvePyImport(abs, spec, ctx);
                    if (target) internal.push(target);
                    else if (!spec.startsWith('.')) external.push(spec.split('.')[0]);
                }
            }
        }
    } else if (wf.lang === 'rust') {
        for (const re of [RUST_USE_RE, RUST_MOD_RE]) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(body)) !== null) {
                const spec = m[1];
                const target = resolveRustImport(abs, spec, ctx);
                if (target) internal.push(target);
                else {
                    const head = spec.split('::')[0];
                    if (spec.includes('::') && head !== 'crate' && head !== 'self'
                        && head !== 'super' && head !== 'std' && head !== 'core') {
                        external.push(head);
                    }
                }
            }
        }
    } else if (wf.lang === 'go') {
        const handle = (spec: string) => {
            const target = resolveGoImport(spec, ctx);
            if (target) internal.push(target);
            else {
                const ext = goExternalName(spec);
                if (ext) external.push(ext);
            }
        };
        GO_IMPORT_BLOCK_RE.lastIndex = 0;
        let block: RegExpExecArray | null;
        while ((block = GO_IMPORT_BLOCK_RE.exec(body)) !== null) {
            GO_QUOTED_RE.lastIndex = 0;
            let q: RegExpExecArray | null;
            while ((q = GO_QUOTED_RE.exec(block[1])) !== null) handle(q[1]);
        }
        GO_IMPORT_SINGLE_RE.lastIndex = 0;
        let s: RegExpExecArray | null;
        while ((s = GO_IMPORT_SINGLE_RE.exec(body)) !== null) handle(s[1]);
    } else if (wf.lang === 'jvm') {
        JVM_IMPORT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = JVM_IMPORT_RE.exec(body)) !== null) {
            const spec = m[1];
            const target = resolveJvmImport(spec, ctx);
            if (target) internal.push(target);
            else external.push(spec.split('.').slice(0, 2).join('.'));
        }
    }
    return { internal, external };
}

function buildEdges(walk: WalkResult, ctx: ResolveContext, includeExternal: boolean): {
    edgeWeights: Map<string, number>;
    externalSpecs: Map<string, number>;
} {
    // key = "source target", value = weight
    const edgeWeights = new Map<string, number>();
    // external node id -> number of import sites (drives the node's loc proxy).
    const externalSpecs = new Map<string, number>();
    for (const [abs, wf] of walk.fileToPkg) {
        let body = '';
        try {
            body = fs.readFileSync(abs, 'utf8');
        } catch {
            continue;
        }
        const { internal, external } = extractFile(abs, wf, body, ctx);
        for (const targetPkg of internal) {
            if (targetPkg === wf.pkg) continue;
            const key = `${wf.pkg} ${targetPkg}`;
            edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
        }
        if (includeExternal) {
            for (const ext of external) {
                const id = `ext:${ext}`;
                edgeWeights.set(`${wf.pkg} ${id}`, (edgeWeights.get(`${wf.pkg} ${id}`) ?? 0) + 1);
                externalSpecs.set(id, (externalSpecs.get(id) ?? 0) + 1);
            }
        }
    }
    return { edgeWeights, externalSpecs };
}

// --- config parsing (alias / module roots / declared packages) ----------

function readSafe(file: string): string {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

// tsconfig.json with comments + trailing commas is common; a strict
// JSON.parse would throw. We strip line/block comments and trailing commas
// before parsing. Best-effort: a parse miss just yields no aliases.
function parseJsonLoose<T>(raw: string): T | null {
    try {
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
            .replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(stripped) as T;
    } catch {
        return null;
    }
}

interface TsConfigShape {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
}

function collectTsAliases(tsconfigs: string[]): TsAlias[] {
    const aliases: TsAlias[] = [];
    for (const file of tsconfigs) {
        const cfg = parseJsonLoose<TsConfigShape>(readSafe(file));
        const paths = cfg?.compilerOptions?.paths;
        if (!paths) continue;
        const dir = path.dirname(file);
        const baseAbs = path.resolve(dir, cfg?.compilerOptions?.baseUrl ?? '.');
        for (const [pattern, targets] of Object.entries(paths)) {
            const wildcard = pattern.endsWith('*');
            const prefix = wildcard ? pattern.slice(0, -1) : pattern;
            const absTargets = targets.map((t) =>
                path.resolve(baseAbs, t.endsWith('*') ? t.slice(0, -1) : t),
            );
            aliases.push({ prefix, wildcard, targets: absTargets });
        }
    }
    // Longest prefix first so a specific alias wins over a catch-all.
    aliases.sort((a, b) => b.prefix.length - a.prefix.length);
    return aliases;
}

function collectGoModules(goMods: string[]): ModuleRoot[] {
    const mods: ModuleRoot[] = [];
    for (const file of goMods) {
        const m = readSafe(file).match(/^\s*module\s+(\S+)/m);
        if (m) mods.push({ importPrefix: m[1], dir: path.dirname(file) });
    }
    mods.sort((a, b) => b.importPrefix.length - a.importPrefix.length);
    return mods;
}

// Map each Rust source to its crate dir: the nearest ancestor holding a
// Cargo.toml. Used only to tell intra-crate from cross-crate imports.
function makeCargoCrateLookup(cargoTomls: string[]): (fromAbs: string) => string | null {
    const crateDirs = cargoTomls.map((c) => path.dirname(c)).sort((a, b) => b.length - a.length);
    return (fromAbs: string) => {
        for (const dir of crateDirs) {
            if (fromAbs === dir || fromAbs.startsWith(dir + path.sep)) return dir;
        }
        return null;
    };
}

// Index declared JVM packages: read each Java/Kotlin file's `package a.b`
// line and map that declared package to the file's repo package id, so an
// `import a.b.C` elsewhere resolves back to the owning repo package.
function collectJvmPackages(walk: WalkResult): Map<string, string> {
    const map = new Map<string, string>();
    for (const [abs, wf] of walk.fileToPkg) {
        if (wf.lang !== 'jvm') continue;
        const m = readSafe(abs).match(JVM_PACKAGE_RE);
        if (m) map.set(m[1], wf.pkg);
    }
    return map;
}

// Declared dependencies from manifest files, so a declared-but-unused dep
// still appears in the external tier; an imported-but-undeclared one is
// already surfaced by the import scan.
function collectDeclaredExternals(walk: WalkResult): Set<string> {
    const out = new Set<string>();
    for (const file of walk.packageJsons) {
        const cfg = parseJsonLoose<Record<string, Record<string, string>>>(readSafe(file));
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
            for (const name of Object.keys(cfg?.[field] ?? {})) out.add(name);
        }
    }
    for (const file of walk.requirementsTxts) {
        for (const line of readSafe(file).split('\n')) {
            const name = line.trim().split(/[<>=!~ #[]/)[0].trim();
            if (name && !name.startsWith('-')) out.add(name);
        }
    }
    for (const file of walk.goMods) {
        const raw = readSafe(file);
        const block = raw.match(/require\s*\(([\s\S]*?)\)/);
        const lines = block ? block[1].split('\n') : [];
        for (const line of lines) {
            const m = line.trim().match(/^([^\s]+)\s+v/);
            if (m && m[1].includes('.')) out.add(m[1].split('/').slice(0, 3).join('/'));
        }
    }
    for (const file of walk.cargoTomls) {
        const dep = readSafe(file).match(/\[dependencies\]([\s\S]*?)(\n\[|$)/);
        if (!dep) continue;
        for (const line of dep[1].split('\n')) {
            const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
            if (m) out.add(m[1]);
        }
    }
    return out;
}

// Tarjan SCC. Returns only components with >1 node (real cycles) plus any
// single node with a self-edge, which our edge builder never emits, so in
// practice: multi-node SCCs only.
function tarjanCycles(nodeIds: string[], edges: DependencyEdge[]): string[][] {
    const adj = new Map<string, string[]>();
    for (const id of nodeIds) adj.set(id, []);
    for (const e of edges) {
        if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
    }

    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    // Iterative Tarjan to avoid blowing the call stack on large graphs.
    for (const start of nodeIds) {
        if (indices.has(start)) continue;
        const work: Array<{ node: string; i: number }> = [{ node: start, i: 0 }];
        while (work.length > 0) {
            const frame = work[work.length - 1];
            const v = frame.node;
            if (frame.i === 0) {
                indices.set(v, index);
                lowlink.set(v, index);
                index += 1;
                stack.push(v);
                onStack.add(v);
            }
            const neighbours = adj.get(v)!;
            if (frame.i < neighbours.length) {
                const w = neighbours[frame.i];
                frame.i += 1;
                if (!indices.has(w)) {
                    work.push({ node: w, i: 0 });
                } else if (onStack.has(w)) {
                    lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
                }
            } else {
                if (lowlink.get(v) === indices.get(v)) {
                    const component: string[] = [];
                    let w: string;
                    do {
                        w = stack.pop()!;
                        onStack.delete(w);
                        component.push(w);
                    } while (w !== v);
                    if (component.length > 1) sccs.push(component);
                }
                work.pop();
                if (work.length > 0) {
                    const parent = work[work.length - 1].node;
                    lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(v)!));
                }
            }
        }
    }
    return sccs;
}

// Name-based tier signals. Order matters: test + infra are checked before the
// shell/presentation split. A `*-shell`/`*-renderer`/`chrome-*` package is a UI
// surface (presentation), NOT the process shell, so the electron-main detection
// is narrow (electron/main process/host/server/daemon/backend) and the UI
// detection is broad. derivePackages in the profiler overrides these per-package
// from the real manifest; this is the graph-only default.
const RE_TEST = /(^|[-/_])(qa|tests?|e2e|specs?|fixtures?|__tests__|evals?|benchmarks?)(\b|[-/_]|$)/i;
const RE_INFRA = /(^|[-/_])(scripts?|infra|config|setup|install|build|tooling|tokens|design-tokens|ci|devops)(\b|[-/_]|$)/i;
const RE_SHELL = /(^|[-/_])(electron|main|server|host|daemon|backend|gateway|api)(\b|[-/_]|$)/i;
const RE_PRESENTATION = /(^|[-/_])(shell|renderer|chrome|web|ui|frontend|front|client|app|site|view|pages?|components?|docs?)(\b|[-/_]|$)/i;

function tierByName(id: string): ArchTier | null {
    if (RE_TEST.test(id)) return 'test';
    if (RE_INFRA.test(id)) return 'infra';
    if (RE_SHELL.test(id)) return 'shell';
    if (RE_PRESENTATION.test(id)) return 'presentation';
    return null;
}

function tierFor(id: string, inbound: number, outbound: number): ArchTier {
    // Name signal first (test/infra/shell/presentation), then fall back to the
    // topology heuristic for genuinely ambiguous packages.
    const byName = tierByName(id);
    if (byName) return byName;
    if (inbound === 0 && outbound > 0) return 'presentation';
    if (inbound > 0 && outbound > 0) return 'domain';
    if (inbound > 0 && outbound === 0) return 'data';
    return 'domain';
}

function shortLabel(id: string): string {
    if (id.startsWith('ext:')) return id.slice('ext:'.length);
    const parts = id.split('/');
    return parts[parts.length - 1];
}

// Recover package->package edges the import resolver misses when packages
// communicate via their published `name` or a `file:`/`workspace:` link rather
// than relative on-disk imports (the npm --prefix / workspaces case). Reads each
// internal package.json's deps and adds an edge when a declared dep resolves to
// another internal package. This is what makes a workspace graph have edges at all.
// Extract the declared package NAME from a pyproject.toml / Cargo.toml body.
function tomlPackageName(body: string): string | null {
    const m = body.match(/^\s*\[(?:project|tool\.poetry|package)\][\s\S]*?^\s*name\s*=\s*"([^"]+)"/m)
        ?? body.match(/^\s*name\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
}

// Extract declared dependency NAMES from a pyproject.toml / Cargo.toml body
// (PEP-621 `dependencies = [...]`, poetry/cargo `[*dependencies]` tables).
function tomlDepNames(body: string): string[] {
    const out: string[] = [];
    const arr = body.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (arr) for (const m of arr[1].matchAll(/"([A-Za-z0-9._-]+)[^"]*"/g)) out.push(m[1]);
    for (const section of ['tool.poetry.dependencies', 'dependencies', 'dev-dependencies', 'tool.poetry.dev-dependencies']) {
        const re = new RegExp(`\\[${section.replace('.', '\\.')}\\]([\\s\\S]*?)(?:\\n\\[|$)`);
        const block = body.match(re);
        if (block) for (const m of block[1].matchAll(/^\s*([A-Za-z0-9._-]+)\s*=/gm)) out.push(m[1]);
    }
    return out;
}

function addManifestEdges(walk: WalkResult, root: string, edgeWeights: Map<string, number>): void {
    const byName = new Map<string, string>();
    const dirToId = new Map<string, string>();
    const idForFile = (file: string): string | null => {
        const rel = path.relative(root, path.dirname(file)).replace(/\\/g, '/');
        return rel === '' ? null : pkgForRelPath(rel);
    };
    const tomls = [...walk.pyprojectTomls, ...walk.cargoTomls];
    // Build the name -> id index across JS/TS, Python and Rust manifests.
    for (const file of walk.packageJsons) {
        const id = idForFile(file);
        if (!id) continue;
        dirToId.set(path.resolve(path.dirname(file)), id);
        const cfg = parseJsonLoose<{ name?: string }>(readSafe(file));
        if (cfg?.name) byName.set(cfg.name, id);
    }
    for (const file of tomls) {
        const id = idForFile(file);
        if (!id) continue;
        dirToId.set(path.resolve(path.dirname(file)), id);
        const name = tomlPackageName(readSafe(file));
        if (name) byName.set(name, id);
    }
    // JS/TS edges (with file:/workspace: link resolution).
    for (const file of walk.packageJsons) {
        const fromId = idForFile(file);
        if (!fromId) continue;
        const dir = path.dirname(file);
        const cfg = parseJsonLoose<Record<string, Record<string, string>>>(readSafe(file));
        if (!cfg) continue;
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
            const block = cfg[field];
            if (!block || typeof block !== 'object') continue;
            for (const [name, spec] of Object.entries(block)) {
                let toId: string | undefined;
                if (typeof spec === 'string' && /^(file:|link:|workspace:)/.test(spec)) {
                    const target = spec.replace(/^(file:|link:|workspace:)/, '').replace(/\*$/, '');
                    toId = dirToId.get(path.resolve(dir, target || '.'));
                }
                if (!toId) toId = byName.get(name);
                if (toId && toId !== fromId) {
                    const key = `${fromId} ${toId}`;
                    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
                }
            }
        }
    }
    // Python / Rust edges from declared internal deps (helps poetry/uv/cargo
    // workspaces that DO declare intra-repo deps; a runtime-only editable
    // monorepo declares none, so it gets no edges here, honestly).
    for (const file of tomls) {
        const fromId = idForFile(file);
        if (!fromId) continue;
        for (const name of tomlDepNames(readSafe(file))) {
            const toId = byName.get(name);
            if (toId && toId !== fromId) {
                const key = `${fromId} ${toId}`;
                edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
            }
        }
    }
}

// Seed a graph node for every package that has a manifest but no walked source
// files (an empty-but-real package like a design-tokens lib), so the package
// list and graph stay honest.
function seedManifestPackages(walk: WalkResult, root: string): void {
    for (const file of walk.packageJsons) {
        const rel = path.relative(root, path.dirname(file)).replace(/\\/g, '/');
        if (rel === '') continue;
        const id = pkgForRelPath(rel);
        if (!walk.pkgStats.has(id)) walk.pkgStats.set(id, { loc: 0, fileCount: 0 });
    }
}

export function computeGraph(
    root: string,
    options: ArchGraphOptions,
    prewalked?: WalkResult,
): DependencyGraph {
    // Mount can hand in a WalkResult it already produced (allLanguages set to
    // match `options`) so the tree is walked once, not twice.
    const walk = prewalked ?? walkRepo(root, options.allLanguages);
    if (walk.pkgStats.size === 0) return EMPTY_GRAPH;

    const ctx: ResolveContext = {
        root,
        fileToPkg: walk.fileToPkg,
        tsAliases: collectTsAliases(walk.tsconfigs),
        goModules: collectGoModules(walk.goMods),
        cargoCrateDir: makeCargoCrateLookup(walk.cargoTomls),
        jvmPackageToPkg: collectJvmPackages(walk),
    };

    seedManifestPackages(walk, root);
    const { edgeWeights, externalSpecs } = buildEdges(walk, ctx, options.includeExternal);
    addManifestEdges(walk, root, edgeWeights);
    const edges: DependencyEdge[] = [];
    const inbound = new Map<string, number>();
    const outbound = new Map<string, number>();
    for (const [key, weight] of edgeWeights) {
        const sep = key.indexOf(' ');
        const source = key.slice(0, sep);
        const target = key.slice(sep + 1);
        edges.push({ source, target, weight });
        outbound.set(source, (outbound.get(source) ?? 0) + 1);
        inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }

    const nodes: DependencyNode[] = [];
    for (const [id, stats] of walk.pkgStats) {
        nodes.push({
            id,
            label: shortLabel(id),
            tier: tierFor(id, inbound.get(id) ?? 0, outbound.get(id) ?? 0),
            loc: stats.loc,
            fileCount: stats.fileCount,
        });
    }
    nodes.sort((a, b) => b.loc - a.loc);

    if (options.includeExternal) {
        // One node per external dependency that an internal package imports;
        // plus declared-but-unimported deps so the manifest stays honest.
        const declared = collectDeclaredExternals(walk);
        const extIds = new Set<string>(externalSpecs.keys());
        for (const name of declared) extIds.add(`ext:${name}`);
        for (const id of extIds) {
            nodes.push({
                id,
                label: shortLabel(id),
                tier: 'external',
                loc: externalSpecs.get(id) ?? 0,
                fileCount: 0,
                external: true,
            });
        }
    }

    // Cycles are an internal-graph concern; external leaves never form one.
    const internalIds = nodes.filter((n) => !n.external).map((n) => n.id);
    const cycles = tarjanCycles(internalIds, edges);
    return {
        nodes,
        edges,
        cycles,
        truncated: walk.truncated,
        fileCount: walk.totalFiles,
    };
}

// --- caching ------------------------------------------------------------

// Bump when the graph algorithm changes (node granularity, edges, tiers) so a
// cached graph from an older build is recomputed even when the tree is unchanged
// (the signature is mtime-based and would not notice a code change).
const GRAPH_VERSION = 3;

interface GraphCache {
    version?: number;
    signature: string;
    includeExternal: boolean;
    allLanguages: boolean;
    graph: DependencyGraph;
}

function consoleDir(root: string): string {
    return path.join(root, '.refringence-console');
}

// Cheap signature: walk DIRECTORIES only (no per-file stat or read) and roll
// up each dir's mtime + entry count. A content edit bumps the containing
// dir's mtime on every OS we target, and an add/delete changes the entry
// count, so a real change busts the cache while an unchanged tree hits it.
// Distinct from the previous version, which re-walked + read every file on
// each read, defeating the cache it was meant to gate.
export function cacheSignature(root: string): string {
    let acc = 0;
    let dirCount = 0;
    let entryCount = 0;
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length > 0) {
        const { dir, depth } = stack.pop()!;
        if (depth > MAX_DEPTH) continue;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        try {
            acc = (acc + Math.round(fs.statSync(dir).mtimeMs)) % Number.MAX_SAFE_INTEGER;
        } catch {
            /* skip an unstatable dir */
        }
        dirCount += 1;
        entryCount += entries.length;
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
            stack.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
        }
    }
    return `${acc}:${dirCount}:${entryCount}`;
}

function readCache(root: string): GraphCache | null {
    try {
        const raw = fs.readFileSync(path.join(consoleDir(root), 'arch-graph-cache.json'), 'utf8');
        const parsed = JSON.parse(raw) as GraphCache;
        if (typeof parsed.signature !== 'string' || !parsed.graph) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeCache(root: string, cache: GraphCache): void {
    try {
        fs.mkdirSync(consoleDir(root), { recursive: true });
        fs.writeFileSync(
            path.join(consoleDir(root), 'arch-graph-cache.json'),
            JSON.stringify(cache),
            'utf8',
        );
    } catch {
        /* cache write is best-effort */
    }
}

export function getGraph(root: string, options: ArchGraphOptions, force: boolean): DependencyGraph {
    const signature = cacheSignature(root);
    if (!force) {
        const cached = readCache(root);
        // The external tier and the language set each change the node/edge
        // set, so the cache is only valid when both flags match what was
        // stored.
        if (cached && cached.version === GRAPH_VERSION && cached.signature === signature
            && cached.includeExternal === options.includeExternal
            && cached.allLanguages === options.allLanguages) {
            return cached.graph;
        }
    }
    const graph = computeGraph(root, options);
    writeCache(root, {
        version: GRAPH_VERSION,
        signature,
        includeExternal: options.includeExternal,
        allLanguages: options.allLanguages,
        graph,
    });
    return graph;
}

// --- overlay ------------------------------------------------------------

const EMPTY_OVERLAY: ArchOverlay = {
    positions: {},
    tierOverrides: {},
    notes: {},
    hidden: [],
};

function overlayPath(root: string): string {
    return path.join(consoleDir(root), 'architecture.json');
}

function readOverlay(root: string): ArchOverlay | null {
    try {
        const raw = fs.readFileSync(overlayPath(root), 'utf8');
        const parsed = JSON.parse(raw) as Partial<ArchOverlay>;
        return {
            positions: parsed.positions ?? {},
            tierOverrides: parsed.tierOverrides ?? {},
            notes: parsed.notes ?? {},
            hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
        };
    } catch {
        return null;
    }
}

function writeOverlay(root: string, overlay: ArchOverlay): { ok: boolean; error?: string } {
    try {
        fs.mkdirSync(consoleDir(root), { recursive: true });
        const safe: ArchOverlay = {
            positions: overlay?.positions ?? {},
            tierOverrides: overlay?.tierOverrides ?? {},
            notes: overlay?.notes ?? {},
            hidden: Array.isArray(overlay?.hidden) ? overlay.hidden : [],
        };
        fs.writeFileSync(overlayPath(root), JSON.stringify(safe, null, 2), 'utf8');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'write failed' };
    }
}

function normalizeOptions(options: ArchGraphOptions | undefined): ArchGraphOptions {
    return {
        includeExternal: options?.includeExternal === true,
        allLanguages: options?.allLanguages === true,
    };
}

export function registerArchGraphHandlers(): void {
    ipcMain.handle(
        'console:arch.graph',
        (_e, projectRoot: string, options?: ArchGraphOptions): DependencyGraph => {
            const root = resolveProjectRoot(projectRoot);
            if (!root || !isInside(root, root)) return EMPTY_GRAPH;
            try {
                return getGraph(root, normalizeOptions(options), false);
            } catch {
                return EMPTY_GRAPH;
            }
        },
    );

    // Force a rebuild, bypassing the cache. The renderer calls this from a
    // Recompute button so a user can pick up changes the signature missed
    // (or simply re-run after an external edit).
    ipcMain.handle(
        'console:arch.recompute',
        (_e, projectRoot: string, options?: ArchGraphOptions): DependencyGraph => {
            const root = resolveProjectRoot(projectRoot);
            if (!root || !isInside(root, root)) return EMPTY_GRAPH;
            try {
                return getGraph(root, normalizeOptions(options), true);
            } catch {
                return EMPTY_GRAPH;
            }
        },
    );

    ipcMain.handle('console:arch.overlay.read', (_e, projectRoot: string): ArchOverlay | null => {
        const root = resolveProjectRoot(projectRoot);
        if (!root) return null;
        try {
            return readOverlay(root);
        } catch {
            return null;
        }
    });

    ipcMain.handle(
        'console:arch.overlay.write',
        (_e, projectRoot: string, overlay: ArchOverlay): { ok: boolean; error?: string } => {
            const root = resolveProjectRoot(projectRoot);
            if (!root) return { ok: false, error: 'invalid project root' };
            // Guard: the overlay file must resolve inside the project.
            const target = overlayPath(root);
            if (!isInside(root, target)) return { ok: false, error: 'path traversal blocked' };
            return writeOverlay(root, overlay ?? EMPTY_OVERLAY);
        },
    );
}
