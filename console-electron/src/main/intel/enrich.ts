// console-electron/src/main/intel/enrich.ts
//
// Layer 2 of the Project Intelligence Engine: AI enrichment. Takes the
// deterministic ProjectProfile and asks a connected model for the things only
// AI can supply: a plain-English "what this project is about" narrative, a one-
// line tagline, prioritized suggestions, and a SEMANTIC systems diagram. The
// diagram is grounded: the model may only place systems on REAL repo paths from
// a candidate list we pass in, and every returned path is validated against that
// list main-side before acceptance, so a clicked system always maps to real code
// (no hallucinated paths). Degrades to a clear {ok:false} when no provider is
// connected; never throws across IPC.
import { listAvailableModels, getProvider } from '../ai/registry';
import type { ChatMessage } from '../ai/ModelProvider';
import type { ProjectProfile, ProjectIntel, SystemDiagram, SystemNode, SystemEdge } from './types';

interface EnrichResult {
    ok: boolean;
    intel?: ProjectIntel;
    error?: string;
}

// Compact, token-bounded summary of the deterministic profile for the prompt.
function profileSummary(p: ProjectProfile): string {
    const langs = p.stack.languages.slice(0, 6).map((l) => `${l.language} ${(l.share * 100).toFixed(0)}%`).join(', ');
    const lines = [
        `Name: ${p.identity.name}`,
        p.identity.description ? `Description: ${p.identity.description}` : '',
        `Type: ${p.shape.projectType}${p.shape.isMonorepo ? ` (monorepo, ${p.shape.packageCount} packages, ${p.shape.workspaceTool ?? 'workspace'})` : ''}`,
        `Languages: ${langs}`,
        `Frameworks: ${p.stack.notableFrameworks.map((f) => `${f.name} ${f.version}`).join(', ') || 'none'}`,
        `Frontend: ${p.stack.frontend.join(', ') || 'none'}; backend: ${p.stack.backend.join(', ') || 'none'}; runtimes: ${p.stack.runtimes.join(', ') || 'none'}`,
        p.detail.dataLayer.orm.length || p.detail.dataLayer.engines.length ? `Data: ${[...p.detail.dataLayer.orm, ...p.detail.dataLayer.engines].join(', ')}` : '',
        p.detail.apiStyle.length ? `API style: ${p.detail.apiStyle.join(', ')}` : '',
        `Testing: ${p.detail.testing.frameworks.join(', ') || 'none'}`,
        `Services: ${p.services.map((s) => s.name).join(', ') || 'none'}`,
        `AI tooling: SDKs [${p.aiTooling.aiSdks.join(', ')}], MCP [${p.aiTooling.mcpServers.join(', ')}]`,
        p.packages.length > 1 ? `Packages: ${p.packages.slice(0, 16).map((pk) => `${pk.name} (${pk.kind}${pk.description ? `: ${pk.description}` : ''})`).join('; ')}` : '',
        `Run commands: ${p.detail.commands.filter((c) => c.group === 'run' || c.group === 'build').slice(0, 6).map((c) => c.name).join(', ') || 'none'}`,
        `README sections: ${p.readme.sections.slice(0, 12).join(', ') || 'none'}`,
        `Activity: ${p.git.activity}${p.git.cadencePerWeek ? `, ~${p.git.cadencePerWeek}/wk` : ''}; ${p.git.contributors} contributors, bus factor ${p.git.busFactor}.`,
        p.detail.hotspots.length ? `Risk hotspots (loc/churn/depended-on): ${p.detail.hotspots.slice(0, 5).map((h) => `${h.path} (${h.loc} LOC, churn ${h.churn}, depended-on ${h.dependedOnBy})`).join('; ')}` : '',
        `Metrics: ${p.metrics.fileCount} files, ${p.metrics.totalLoc} LOC, test/source ratio ${p.metrics.ratios.testToSource}, ${p.detail.todoCount} TODO/FIXME markers. Tests: ${p.inventory.hasTests}, CI: ${p.cicd.hasCi}, license: ${p.identity.license || 'none'}.`,
    ];
    return lines.filter(Boolean).join('\n');
}

// The real paths a system may be placed on: the walked packages + dep-graph
// nodes. The model is told to use ONLY these, and we re-validate after.
function candidatePaths(p: ProjectProfile): { path: string; role: string; loc: number }[] {
    const seen = new Map<string, { path: string; role: string; loc: number }>();
    for (const pkg of p.packages) {
        if (!seen.has(pkg.relPath)) seen.set(pkg.relPath, { path: pkg.relPath, role: pkg.role, loc: pkg.loc });
    }
    for (const n of p.depGraph.nodes) {
        if (!n.external && !seen.has(n.id)) seen.set(n.id, { path: n.id, role: n.tier, loc: n.loc });
    }
    return Array.from(seen.values()).sort((a, b) => b.loc - a.loc).slice(0, 60);
}

function buildPrompt(p: ProjectProfile, candidates: { path: string; role: string; loc: number }[]): { system: string; user: string } {
    const system = [
        'You are a senior software architect analysing a real codebase from a deterministic profile.',
        'Explain what the project is ABOUT (its domain, who it is for, what it does and why) in plain language, not a list of technologies.',
        'Then describe its system architecture as a small set of named systems mapped onto REAL repository paths.',
        'You may ONLY use repository paths from the provided candidate list. Never invent a path.',
        'Respond with a SINGLE valid JSON object and nothing else. No markdown, no code fences, no commentary.',
    ].join(' ');

    const schema = `{
  "tagline": "one sentence describing what this project is",
  "narrative": "2 to 4 sentences on the domain, audience, purpose, and what the project does",
  "systems": [
    { "id": "kebab-id", "label": "Human label", "kind": "frontend|backend|data|service|infra|shared|docs|tests", "paths": ["one or more paths FROM THE CANDIDATE LIST"], "summary": "one line on this system's responsibility" }
  ],
  "edges": [ { "source": "system-id", "target": "system-id", "label": "how they relate (e.g. 'calls', 'renders', 'persists to')" } ],
  "suggestions": [ { "title": "short specific title", "detail": "one line", "priority": "high|medium|low" } ],
  "packageNotes": [ { "path": "a path FROM THE CANDIDATE LIST", "oneLiner": "one plain-English line on what this package does" } ],
  "changeFirst": [ { "title": "what a senior engineer would fix or improve first", "rationale": "one line why", "evidencePath": "a path FROM THE CANDIDATE LIST that motivates it" } ],
  "runGuide": "2 to 4 short sentences on how to get the project running, using ONLY the real run/build commands listed in the profile. Never invent commands."
}`;

    const candidateList = candidates.map((c) => `- ${c.path} (${c.role}, ${c.loc} LOC)`).join('\n');

    const user = [
        '## Project profile',
        profileSummary(p),
        '',
        '## Candidate repository paths (use ONLY these in any "path" field)',
        candidateList || '(no packages detected; use empty arrays)',
        '',
        '## Output JSON schema',
        schema,
        '',
        'Produce 3 to 7 systems, 0 to 8 edges, 2 to 5 suggestions, one packageNote per real package (up to 16), 2 to 4 changeFirst items, and a runGuide. Output only the JSON object.',
    ].join('\n');

    return { system, user };
}

// Pull the first balanced {...} object out of model text (handles stray prose
// or code fences some models add despite instructions).
function extractJson(text: string): string | null {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
}

function validateDiagram(
    raw: unknown,
    candidatePathSet: Set<string>,
): {
    diagram: SystemDiagram | null;
    suggestions: ProjectIntel['suggestions'];
    packageNotes: ProjectIntel['packageNotes'];
    changeFirst: ProjectIntel['changeFirst'];
    runGuide: string;
    tagline: string;
    narrative: string;
} {
    const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const tagline = typeof obj.tagline === 'string' ? obj.tagline.slice(0, 200) : '';
    const narrative = typeof obj.narrative === 'string' ? obj.narrative.slice(0, 1200) : '';

    const nodes: SystemNode[] = [];
    const validIds = new Set<string>();
    if (Array.isArray(obj.systems)) {
        for (const s of obj.systems as Record<string, unknown>[]) {
            if (!s || typeof s !== 'object') continue;
            const id = typeof s.id === 'string' ? s.id.trim() : '';
            const label = typeof s.label === 'string' ? s.label.trim() : id;
            if (!id) continue;
            const rawPaths = Array.isArray(s.paths) ? s.paths.filter((x): x is string => typeof x === 'string') : [];
            // Keep only paths that exist in the real candidate set.
            const paths = rawPaths.filter((pth) => candidatePathSet.has(pth));
            if (paths.length === 0) continue; // ungrounded system, drop it
            nodes.push({
                id, label,
                kind: typeof s.kind === 'string' ? s.kind : 'shared',
                paths,
                summary: typeof s.summary === 'string' ? s.summary.slice(0, 240) : '',
            });
            validIds.add(id);
        }
    }

    const edges: SystemEdge[] = [];
    if (Array.isArray(obj.edges)) {
        for (const e of obj.edges as Record<string, unknown>[]) {
            if (!e || typeof e !== 'object') continue;
            const source = typeof e.source === 'string' ? e.source : '';
            const target = typeof e.target === 'string' ? e.target : '';
            if (!validIds.has(source) || !validIds.has(target) || source === target) continue;
            edges.push({ source, target, label: typeof e.label === 'string' ? e.label.slice(0, 80) : '' });
        }
    }

    const suggestions: ProjectIntel['suggestions'] = [];
    if (Array.isArray(obj.suggestions)) {
        for (const g of obj.suggestions as Record<string, unknown>[]) {
            if (!g || typeof g !== 'object') continue;
            const title = typeof g.title === 'string' ? g.title.slice(0, 120) : '';
            if (!title) continue;
            const priority = g.priority === 'high' || g.priority === 'low' ? g.priority : 'medium';
            suggestions.push({ title, detail: typeof g.detail === 'string' ? g.detail.slice(0, 240) : '', priority });
        }
    }

    // Per-package one-liners, path-validated.
    const packageNotes: ProjectIntel['packageNotes'] = [];
    if (Array.isArray(obj.packageNotes)) {
        for (const n of obj.packageNotes as Record<string, unknown>[]) {
            if (!n || typeof n !== 'object') continue;
            const pth = typeof n.path === 'string' ? n.path : '';
            const oneLiner = typeof n.oneLiner === 'string' ? n.oneLiner.slice(0, 200) : '';
            if (candidatePathSet.has(pth) && oneLiner) packageNotes.push({ path: pth, oneLiner });
        }
    }

    // "Change first", each citing a real path.
    const changeFirst: ProjectIntel['changeFirst'] = [];
    if (Array.isArray(obj.changeFirst)) {
        for (const c of obj.changeFirst as Record<string, unknown>[]) {
            if (!c || typeof c !== 'object') continue;
            const title = typeof c.title === 'string' ? c.title.slice(0, 140) : '';
            if (!title) continue;
            const evidencePath = typeof c.evidencePath === 'string' && candidatePathSet.has(c.evidencePath) ? c.evidencePath : '';
            changeFirst.push({ title, rationale: typeof c.rationale === 'string' ? c.rationale.slice(0, 220) : '', evidencePath });
        }
    }

    const runGuide = typeof obj.runGuide === 'string' ? obj.runGuide.slice(0, 800) : '';

    const diagram = nodes.length > 0 ? { nodes, edges } : null;
    return {
        diagram, suggestions: suggestions.slice(0, 8),
        packageNotes: packageNotes.slice(0, 20), changeFirst: changeFirst.slice(0, 5),
        runGuide, tagline, narrative,
    };
}

// Accumulate a provider's streamed text into one string, resolving on done.
function streamToText(
    provider: NonNullable<ReturnType<typeof getProvider>>,
    model: string,
    messages: ChatMessage[],
    system: string,
): Promise<{ ok: boolean; text: string; error?: string }> {
    return new Promise((resolve) => {
        let text = '';
        let settled = false;
        const controller = new AbortController();
        const done = (ok: boolean, error?: string) => {
            if (settled) return;
            settled = true;
            resolve({ ok, text, error });
        };
        const timeout = setTimeout(() => { controller.abort(); done(false, 'enrichment timed out'); }, 90_000);
        void provider.stream({
            model, messages, system, signal: controller.signal,
            onTextDelta: (d) => { text += d; },
            onDone: () => { clearTimeout(timeout); done(text.trim().length > 0, text.trim().length > 0 ? undefined : 'empty response'); },
            onError: (msg) => { clearTimeout(timeout); done(false, msg); },
        });
    });
}

export async function enrichProfile(profile: ProjectProfile, modelId: string | undefined, nowIso: string): Promise<EnrichResult> {
    let models;
    try {
        models = await listAvailableModels();
    } catch {
        return { ok: false, error: 'could not list AI models' };
    }
    if (!models || models.length === 0) {
        return { ok: false, error: 'No AI provider connected. Add a provider key or a local model in Settings.' };
    }
    const chosen = (modelId && models.find((m) => m.id === modelId)) || models[0];
    const provider = getProvider(chosen.provider);
    if (!provider) return { ok: false, error: 'provider unavailable' };

    const candidates = candidatePaths(profile);
    const candidateSet = new Set(candidates.map((c) => c.path));
    const { system, user } = buildPrompt(profile, candidates);

    const res = await streamToText(provider, chosen.id, [{ role: 'user', content: user }], system);
    if (!res.ok) return { ok: false, error: res.error ?? 'enrichment failed' };

    const jsonText = extractJson(res.text);
    if (!jsonText) return { ok: false, error: 'model did not return JSON' };
    let parsed: unknown;
    try { parsed = JSON.parse(jsonText); } catch { return { ok: false, error: 'model returned invalid JSON' }; }

    const { diagram, suggestions, packageNotes, changeFirst, runGuide, tagline, narrative } = validateDiagram(parsed, candidateSet);
    if (!narrative && !diagram) return { ok: false, error: 'model response had no usable content' };

    const intel: ProjectIntel = {
        narrative, tagline, systemDiagram: diagram, suggestions,
        packageNotes, changeFirst, runGuide,
        model: chosen.id, generatedAt: nowIso,
    };
    return { ok: true, intel };
}
