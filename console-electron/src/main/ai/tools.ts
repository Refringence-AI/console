// console-electron/src/main/ai/tools.ts
//
// Agentic read-only tools the assistant can call to ground answers in the
// user's actual project: list a directory, read a file (capped), and search
// the code. Everything is scoped to the picked project root with a traversal
// guard - the assistant cannot read outside the project. Plus a compact
// project-context block injected into the system prompt.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runChecks } from '../checks';
import { computeDoraMetrics } from '../dora';
import { checkLicenses } from '../license-check';
import { scanMigrations } from '../migration-drift';
import { scanDeadConfig } from '../dead-config';
import { validateWriteTarget, makeDiff, applyWrite } from './writeGate';
import { buildConfig } from './config-gen';
import { CONFIG_KINDS, type ConfigKind } from '../config-templates';
import { buildSbom } from '../sbom';
import { spliceBlock } from '../devhandoff';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Run a shell command in the project and return its combined, truncated output.
// Total: a non-zero exit becomes a readable failure string, never a throw.
// Shell control characters that would let one approved-looking command chain,
// pipe, redirect, background, or substitute a second command (CWE-78). A command
// free of these is a single program + args, safe to run through the shell; any
// command containing them is refused rather than executed, so a prompt-injection
// payload cannot smuggle extra commands past the approval card.
const SHELL_METACHARACTERS = /[;&|`\n\r<>]|\$\(/;

async function runProjectCommand(root: string, command: string): Promise<string> {
    const cap = (s: string) => (s.length > 5000 ? s.slice(0, 5000) + '\n...(truncated)' : s);
    if (SHELL_METACHARACTERS.test(command)) {
        return 'That command contains shell control characters (such as && | ; > or $(...)), which are not allowed. Run one plain command at a time; nothing was executed.';
    }
    try {
        const { stdout, stderr } = await execAsync(command, { cwd: root, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true });
        const out = (stdout + (stderr ? '\n' + stderr : '')).trim();
        return cap(out || '(command produced no output)');
    } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
        const body = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
        return cap(`Command failed (exit ${err.code ?? '?'}):\n${body}`);
    }
}

export type PermissionDecision = 'allow' | 'allow-session' | 'deny';
export type PermissionKind = 'write' | 'run';
// One gate for every side-effecting action. The renderer shows the diff for a
// write and the command for a run, then returns the decision.
export interface PermissionGate {
    request(opts: { chatId: string; kind: PermissionKind; title: string; diff?: string; command?: string }): Promise<PermissionDecision>;
    // ask_user uses a separate channel: it returns the user's free-text answer,
    // not an allow/deny decision, so it never overloads the decision union.
    ask?(opts: { chatId: string; question: string; placeholder?: string; options?: string[] }): Promise<string>;
}

const SKIP = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache',
    '.venv', '__pycache__', '.refringence-qa', '.refringence-console',
]);

function inside(root: string, p: string): boolean {
    const rel = path.relative(root, p);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Lexical containment is bypassable via symlinks; canonicalise both root and
// target with realpath and confirm the real target still sits under the real
// root. Returns false on ENOENT, symlink loops, or any resolution failure.
function realInside(root: string, target: string): boolean {
    try {
        const realRoot = fs.realpathSync(root);
        const realTarget = fs.realpathSync(target);
        const rel = path.relative(realRoot, realTarget);
        return (rel === '' || !rel.startsWith('..')) && !path.isAbsolute(rel);
    } catch { return false; }
}

function listFiles(root: string, dir: string): string {
    const abs = path.resolve(root, dir || '.');
    if (!inside(root, abs)) return 'Path is outside the project.';
    if (!realInside(root, abs)) return 'Path is outside the project.';
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return 'Directory not found.'; }
    const names = ents
        .filter((e) => !(e.name.startsWith('.') && e.name !== '.github') && !SKIP.has(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .slice(0, 200);
    return names.length ? names.join('\n') : '(empty)';
}

function readFileCapped(root: string, rel: string): string {
    const abs = path.resolve(root, rel);
    if (!inside(root, abs)) return 'Path is outside the project.';
    if (!realInside(root, abs)) return 'Path is outside the project.';
    try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) return 'Not a file.';
        if (stat.size > 200_000) return 'File is too large to read (over 200KB).';
        const lines = fs.readFileSync(abs, 'utf8').split('\n');
        return lines.length > 400
            ? lines.slice(0, 400).join('\n') + `\n... (${lines.length - 400} more lines)`
            : lines.join('\n');
    } catch { return 'Could not read the file.'; }
}

async function searchCode(root: string, query: string): Promise<string> {
    // git grep is fast + respects .gitignore; fall back to a bounded JS walk.
    try {
        const { stdout } = await execFileAsync(
            'git', ['-C', root, 'grep', '-n', '-I', '--no-color', '-F', '-e', query, '--'],
            { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
        );
        const lines = stdout.split('\n').filter(Boolean).slice(0, 60);
        return lines.length ? lines.join('\n') : 'No matches.';
    } catch (e) {
        if (e && typeof e === 'object' && (e as { code?: number }).code === 1) return 'No matches.';
        return jsSearch(root, query);
    }
}

function jsSearch(root: string, query: string): string {
    const out: string[] = [];
    let scanned = 0;
    const stack = [root];
    const needle = query.toLowerCase();
    while (stack.length && out.length < 60 && scanned < 3000) {
        const dir = stack.pop() as string;
        let ents: fs.Dirent[];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
            if (e.name.startsWith('.') && e.name !== '.github') continue;
            if (SKIP.has(e.name)) continue;
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) { stack.push(abs); continue; }
            if (!/\.(ts|tsx|js|jsx|py|go|rs|java|c|cc|cpp|h|hpp|css|md|json|ya?ml|sh|html)$/i.test(e.name)) continue;
            scanned++;
            let body: string;
            try { if (fs.statSync(abs).size > 500_000) continue; body = fs.readFileSync(abs, 'utf8'); } catch { continue; }
            const ls = body.split('\n');
            for (let i = 0; i < ls.length && out.length < 60; i++) {
                if (ls[i].toLowerCase().includes(needle)) {
                    out.push(`${path.relative(root, abs).replace(/\\/g, '/')}:${i + 1}: ${ls[i].trim().slice(0, 160)}`);
                }
            }
        }
    }
    return out.length ? out.join('\n') : 'No matches.';
}

// Panels the assistant may open for the user via focus_panel.
const FOCUSABLE_PANELS = ['overview', 'report', 'issues', 'docs', 'repo', 'architecture', 'observability', 'release', 'services', 'activity', 'pipeline', 'prompts', 'design'] as const;

export function buildProjectTools(
    ai: typeof import('ai'),
    root: string,
    opts?: { gate?: PermissionGate; chatId?: string; onFocusPanel?: (panel: string) => void; planMode?: boolean },
): Record<string, unknown> {
    const onFocusPanel = opts?.onFocusPanel;
    const rawGate = opts?.gate;
    const chatId = opts?.chatId;
    const planMode = opts?.planMode === true;
    // In plan mode every write/run is auto-denied before it reaches the user; the
    // read tools and ask_user (a clarifying question is read-only) stay live.
    const gate: PermissionGate | undefined = rawGate && planMode
        ? { ...rawGate, request: (req) => (req.kind === 'write' || req.kind === 'run') ? Promise.resolve('deny' as PermissionDecision) : rawGate.request(req) }
        : rawGate;
    const PLAN_DENY = 'Plan mode is read-only, so nothing was changed. Turn off plan mode to apply changes.';
    // JSON-schema (not zod) tool inputs: the v6 zod tool-type inference is what
    // OOMs the tsc build, and these schemas are trivial.
    const tools: Record<string, unknown> = {
        list_files: ai.tool({
            description: 'List files and folders in a directory of the project. Pass "" for the project root.',
            inputSchema: ai.jsonSchema<{ dir: string }>({
                type: 'object',
                properties: { dir: { type: 'string', description: 'Directory relative to the project root.' } },
                required: ['dir'], additionalProperties: false,
            }),
            execute: async ({ dir }) => listFiles(root, dir),
        }),
        read_file: ai.tool({
            description: 'Read a text file from the project by its path relative to the root. Returns up to ~400 lines.',
            inputSchema: ai.jsonSchema<{ path: string }>({
                type: 'object',
                properties: { path: { type: 'string', description: 'File path relative to the project root.' } },
                required: ['path'], additionalProperties: false,
            }),
            execute: async ({ path: p }) => readFileCapped(root, p),
        }),
        search_code: ai.tool({
            description: 'Search the project files for a literal string. Returns matching file:line snippets.',
            inputSchema: ai.jsonSchema<{ query: string }>({
                type: 'object',
                properties: { query: { type: 'string', description: 'The text to search for.' } },
                required: ['query'], additionalProperties: false,
            }),
            execute: async ({ query }) => searchCode(root, query),
        }),
        get_checks: ai.tool({
            description: 'Run the project\'s release-readiness checks (build, tests, lint, env, git state, and more) and return each gate with its status (pass / warn / fail / skip) plus the failing findings. Use this to answer what is failing or blocking a release, not raw file reading.',
            inputSchema: ai.jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
            execute: async () => {
                const results = runChecks(root);
                if (!results.length) return 'No checks available for this project.';
                return results.map((c) => {
                    const flags = c.findings
                        .filter((f) => f.severity === 'fail' || f.severity === 'warn')
                        .slice(0, 4)
                        .map((f) => `    - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
                    const head = `[${c.status}] ${c.title}${c.summary ? ' - ' + c.summary : ''}`;
                    return flags.length ? head + '\n' + flags.join('\n') : head;
                }).join('\n');
            },
        }),
        get_delivery_metrics: ai.tool({
            description: 'Compute DORA delivery metrics from this project\'s git history: deployment frequency, lead time for change, change-failure rate, and time to restore. Use this to answer questions about delivery or shipping health. Returns honest n/a values when there is no signal (e.g. no tags).',
            inputSchema: ai.jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
            execute: async () => {
                const m = await computeDoraMetrics(root);
                return [
                    `Deployment frequency: ${m.deployFreqPerWeek ?? 'n/a'} per week`,
                    `Lead time for change: ${m.leadTimeHours ?? 'n/a'} hours`,
                    `Change-failure rate: ${m.changeFailRatePct ?? 'n/a'} %`,
                    `Time to restore: ${m.mttrHours ?? 'n/a'} hours`,
                    `(measured over the last ${m.windowDays} days)`,
                ].join('\n');
            },
        }),
        get_dependency_licenses: ai.tool({
            description: 'Report the project license and the licenses of its dependencies, flagging copyleft (GPL/AGPL/LGPL/MPL). Use this for license-risk questions, not raw file reading.',
            inputSchema: ai.jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
            execute: async () => {
                const r = checkLicenses(root);
                if (!r.ok) return r.error ?? 'Could not read licenses.';
                const head = `Project license: ${r.projectLicense ?? 'none detected'}. Scanned ${r.totalScanned} dependencies${r.truncated ? ' (truncated)' : ''}.`;
                const counts = `Strong-copyleft: ${r.counts['strong-copyleft']}, weak-copyleft: ${r.counts['weak-copyleft']}, permissive: ${r.counts.permissive}, unknown: ${r.counts.unknown}.`;
                const flagged = r.flagged.slice(0, 15).map((f) => `  - ${f.name}@${f.version}: ${f.license} (${f.class})`);
                return [head, counts, flagged.length ? 'Flagged:\n' + flagged.join('\n') : 'No copyleft dependencies flagged.'].join('\n');
            },
        }),
        get_migration_status: ai.tool({
            description: 'Report the database migration status: which migration tool, how many migrations, and any ordering gaps or anomalies. Use this for migration-drift questions.',
            inputSchema: ai.jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
            execute: async () => {
                const r = scanMigrations(root);
                if (!r.ok) return r.error ?? 'No migrations found.';
                return [
                    `Migration tool: ${r.tool}. ${r.count} migrations in ${r.dir}.`,
                    `Gaps: ${r.gaps.length ? r.gaps.join('; ') : 'none'}.`,
                    `Warnings: ${r.warnings.length ? r.warnings.join('; ') : 'none'}.`,
                ].join('\n');
            },
        }),
        get_dead_config: ai.tool({
            description: 'Report dead or unused configuration in the project: unresolved tsconfig paths, scripts pointing at missing files, unused env names, and missing extends. Use this for config-hygiene questions.',
            inputSchema: ai.jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
            execute: async () => {
                const r = scanDeadConfig(root);
                if (!r.ok) return r.error ?? 'Could not scan config.';
                if (!r.findings.length) return 'No dead or unused configuration found.';
                return r.findings.slice(0, 20).map((f) => `[${f.kind}] ${f.detail} (${f.file})`).join('\n');
            },
        }),
    };
    // The single write capability, gated: the user sees a diff and approves
    // before anything is written, and the prior content is backed up. Only
    // offered when the host wires an approval gate.
    if (gate && chatId) {
        tools.write_file = ai.tool({
            description: 'Create or update a file in the project. The user is shown a diff and must approve before anything is written, and the prior content is backed up so the change can be reverted. Use this only when the user has asked you to make a change.',
            inputSchema: ai.jsonSchema<{ path: string; content: string }>({
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to the project root.' },
                    content: { type: 'string', description: 'The full new contents of the file.' },
                },
                required: ['path', 'content'], additionalProperties: false,
            }),
            execute: async ({ path: rel, content }) => {
                const t = validateWriteTarget(root, rel);
                if ('error' in t) return t.error;
                const diff = makeDiff(t.existing, content, t.rel);
                const decision = await gate.request({
                    chatId,
                    kind: 'write',
                    title: t.existing === null ? `Create ${t.rel}` : `Update ${t.rel}`,
                    diff,
                });
                if (decision === 'deny') return planMode ? PLAN_DENY : 'The user declined the change; nothing was written.';
                const res = applyWrite(root, t, content);
                if (!res.ok) return `Could not write the file: ${res.error}`;
                return t.existing === null ? `Created ${t.rel}.` : `Updated ${t.rel}.`;
            },
        });
        tools.generate_config = ai.tool({
            description: 'Generate a deploy or CI config file tailored to this project (vercel.json, render.yaml, railway.json, Dockerfile, docker-compose.yaml, or a GitHub Actions CI workflow). The stack is detected from package.json and lockfiles; the file is written through the same approval gate as write_file (the user sees a diff and approves). Prefer this over hand-writing config.',
            inputSchema: ai.jsonSchema<{ kind: ConfigKind }>({
                type: 'object',
                properties: { kind: { type: 'string', enum: [...CONFIG_KINDS], description: 'Which config file to generate.' } },
                required: ['kind'], additionalProperties: false,
            }),
            execute: async ({ kind }) => {
                const built = buildConfig(root, kind);
                if (!built.content) return `No template is available for ${kind}.`;
                const t = validateWriteTarget(root, built.destPath);
                if ('error' in t) return t.error;
                const diff = makeDiff(t.existing, built.content, t.rel);
                const decision = await gate.request({
                    chatId,
                    kind: 'write',
                    title: t.existing === null ? `Generate ${t.rel}` : `Regenerate ${t.rel}`,
                    diff,
                });
                if (decision === 'deny') return planMode ? PLAN_DENY : 'The user declined; nothing was written.';
                const res = applyWrite(root, t, built.content);
                if (!res.ok) return `Could not write the config: ${res.error}`;
                return `Wrote ${t.rel} (detected framework: ${built.stack.framework ?? 'unknown'}, ${built.stack.packageManager ?? 'npm'}).`;
            },
        });
        tools.dispatch_handoff = ai.tool({
            description: 'Hand off a scoped task to the user\'s IDE coding agent (Cursor, or Claude Code / Codex). Writes the task as a managed instruction block into AGENTS.md (the cross-tool standard) or .cursorrules, through the approval gate, so the IDE agent picks it up. Use when the user wants their IDE agent to implement a change you have scoped, rather than editing files here.',
            inputSchema: ai.jsonSchema<{ task: string; target?: 'agents' | 'cursor' }>({
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'The grounded task for the IDE agent (reference real files/paths).' },
                    target: { type: 'string', enum: ['agents', 'cursor'], description: 'agents = AGENTS.md (default), cursor = .cursorrules.' },
                },
                required: ['task'], additionalProperties: false,
            }),
            execute: async ({ task, target }) => {
                const fileName = target === 'cursor' ? '.cursorrules' : 'AGENTS.md';
                const t = validateWriteTarget(root, fileName);
                if ('error' in t) return t.error;
                const content = spliceBlock(t.existing ?? '', String(task ?? ''), 'replace');
                const diff = makeDiff(t.existing, content, t.rel);
                const decision = await gate.request({ chatId, kind: 'write', title: `Hand off to ${t.rel}`, diff });
                if (decision === 'deny') return planMode ? PLAN_DENY : 'The user declined the handoff.';
                const res = applyWrite(root, t, content);
                if (!res.ok) return `Could not write the handoff: ${res.error}`;
                return `Wrote the task into ${t.rel} as a managed block; open the project in your IDE agent to run it.`;
            },
        });
        tools.generate_sbom = ai.tool({
            description: 'Generate a CycloneDX 1.5 software bill of materials (SBOM) for the project from its package.json and lockfiles, and write it to sbom.cdx.json. The user approves the write via a diff. Use this when the user wants an SBOM or a supply-chain inventory.',
            inputSchema: ai.jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
            execute: async () => {
                const built = buildSbom(root, new Date().toISOString());
                if (!built.ok || !built.bom) return built.error ?? 'Could not build the SBOM.';
                const content = JSON.stringify(built.bom, null, 2);
                const t = validateWriteTarget(root, 'sbom.cdx.json');
                if ('error' in t) return t.error;
                const diff = makeDiff(t.existing, content, t.rel);
                const decision = await gate.request({ chatId, kind: 'write', title: `Write ${t.rel} (${built.componentCount} components)`, diff });
                if (decision === 'deny') return planMode ? PLAN_DENY : 'The user declined; no SBOM was written.';
                const res = applyWrite(root, t, content);
                if (!res.ok) return `Could not write the SBOM: ${res.error}`;
                return `Wrote ${t.rel} with ${built.componentCount} components.`;
            },
        });
        tools.run_command = ai.tool({
            description: 'Run a shell command in the project (for example npm test, npm run build, or a lint command) to verify a change or gather output. The user must approve the exact command before it runs. Use this to check your work; use write_file to make changes.',
            inputSchema: ai.jsonSchema<{ command: string }>({
                type: 'object',
                properties: { command: { type: 'string', description: 'The command to run, e.g. "npm test".' } },
                required: ['command'], additionalProperties: false,
            }),
            execute: async ({ command }) => {
                const cmd = String(command ?? '').trim();
                if (!cmd) return 'No command was provided.';
                const decision = await gate.request({ chatId, kind: 'run', title: `Run ${cmd}`, command: cmd });
                if (decision === 'deny') return planMode ? PLAN_DENY : 'The user declined to run the command.';
                return runProjectCommand(root, cmd);
            },
        });
        if (gate.ask) {
            tools.ask_user = ai.tool({
                description: 'Ask the user a single clarifying question and wait for their typed answer before continuing. Use when you are blocked on a decision only the user can make (which file, which option, confirm intent). Do not use this for permission to write or run; those have their own approval.',
                inputSchema: ai.jsonSchema<{ question: string; placeholder?: string; options?: string[] }>({
                    type: 'object',
                    properties: {
                        question: { type: 'string', description: 'The question to show the user.' },
                        placeholder: { type: 'string', description: 'Optional hint shown in the answer box.' },
                        options: { type: 'array', items: { type: 'string' }, description: 'Optional preset answers shown as buttons.' },
                    },
                    required: ['question'], additionalProperties: false,
                }),
                execute: async ({ question, placeholder, options }) => {
                    const q = String(question ?? '').trim();
                    if (!q) return 'No question was provided.';
                    const answer = await gate.ask!({
                        chatId,
                        question: q,
                        placeholder: typeof placeholder === 'string' ? placeholder : undefined,
                        options: Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string').slice(0, 6) : undefined,
                    });
                    return answer && answer.trim() ? `The user answered: ${answer}` : 'The user dismissed the question without answering.';
                },
            });
        }
    }
    // Only offered when the host provides a navigation callback (the chat stream
    // passes one that drives the renderer). Lets the assistant act as an operator:
    // open the panel it is talking about so the user sees it.
    if (onFocusPanel) {
        tools.focus_panel = ai.tool({
            description: 'Open one of Console\'s panels for the user so they can see what you are describing (for example open the architecture, the release checklist, or the services). Call this when your answer points the user at a panel.',
            inputSchema: ai.jsonSchema<{ panel: string }>({
                type: 'object',
                properties: { panel: { type: 'string', enum: [...FOCUSABLE_PANELS], description: 'Which panel to open.' } },
                required: ['panel'], additionalProperties: false,
            }),
            execute: async ({ panel }) => {
                if (!FOCUSABLE_PANELS.includes(panel as typeof FOCUSABLE_PANELS[number])) return `Unknown panel "${panel}".`;
                onFocusPanel(panel);
                return `Opened the ${panel} panel for the user.`;
            },
        });
    }
    return tools;
}

// A compact context block prepended to the chat system prompt so the assistant
// knows which project it is helping with and that it has tools to explore it.
export function buildProjectContext(root: string): string {
    const name = path.basename(root);
    let shape = 'No package.json at the project root.';
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: string; description?: string; scripts?: Record<string, string> };
        shape = `package.json name: ${pkg.name ?? name}${pkg.description ? `; description: ${pkg.description}` : ''}; scripts: ${Object.keys(pkg.scripts ?? {}).join(', ') || 'none'}.`;
    } catch { /* keep default */ }
    let topLevel = '';
    try {
        topLevel = fs.readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
            .map((e) => e.name).slice(0, 20).join(', ');
    } catch { /* none */ }
    return [
        'You are Console\'s assistant, helping with a software project the user has open in the app.',
        `Project root: ${root}`,
        shape,
        topLevel ? `Top-level folders: ${topLevel}.` : '',
        'You have read-only tools to ground your answers: list_files, read_file, and search_code explore the code; get_checks reports the release-readiness gates (what is passing or failing); get_delivery_metrics reports DORA delivery health from git; get_dependency_licenses reports license risk; get_migration_status reports database migration drift; get_dead_config reports unused config; focus_panel opens a Console panel for the user when your answer points them at one; write_file creates or updates a file but only after the user approves a diff, so use it solely when the user asks you to make a change; generate_config scaffolds a deploy or CI config file (vercel/render/railway/docker/CI) tailored to the detected stack, through that same approval gate; generate_sbom writes a CycloneDX SBOM of the dependencies through that gate; run_command runs a shell command (npm test, build, lint) after the user approves it, so you can verify a change; dispatch_handoff hands a scoped task to the IDE coding agent (Cursor / Claude Code) via AGENTS.md or .cursorrules through that gate, for when the user wants their IDE agent to implement a change rather than you editing here; ask_user pauses to ask the user one clarifying question and waits for their answer when you are blocked on a decision only they can make. Use the read tools before answering; do not guess about files or status you have not read. Keep answers concise and concrete.',
    ].filter(Boolean).join('\n');
}
