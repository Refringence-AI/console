// console-electron/src/main/skills.ts
//
// Agent-skills library. A small curated catalogue of high-signal skills (the kind
// you want in Claude Code / Codex on every project), plus an install action that
// writes the skill as `<project>/.claude/skills/<id>/SKILL.md` - the location
// Claude Code reads. Project-scoped on purpose: installing never touches the
// user's global ~/.claude. Codex reads the same markdown under .codex/skills.
import * as fs from 'node:fs';
import * as path from 'node:path';

export type SkillTool = 'claude' | 'codex';

export interface SkillMeta {
    id: string;
    name: string;
    description: string;
    tags: string[];
}

interface SkillDef extends SkillMeta {
    body: string; // markdown body (below the frontmatter)
}

// Frontmatter + body are assembled at install time. Bodies are intentionally
// short - a skill is a sharp instruction, not an essay.
const SKILLS: SkillDef[] = [
    {
        id: 'ponytail',
        name: 'Ponytail (ruthless minimalism)',
        description: 'Forces the simplest solution that works: question whether the task needs to exist, prefer the standard library and native platform features over dependencies, one line before fifty.',
        tags: ['quality', 'minimalism', 'refactor'],
        body: [
            'When writing or changing code, take the laziest path that actually works.',
            '',
            '1. **YAGNI first.** Question whether the task needs to exist at all. Delete before you add.',
            '2. **Stdlib before custom.** Reach for the language/standard library, then native platform features, before a new dependency.',
            '3. **One line before fifty.** Three similar lines beat a premature helper. No speculative abstraction, no dead flexibility, no config for a thing used once.',
            '4. **Match the surrounding code** - its naming, idioms, and comment density.',
            '',
            'Leave a `// ponytail:` comment when you deliberately defer something, so the shortcut is tracked, not forgotten.',
        ].join('\n'),
    },
    {
        id: 'code-review',
        name: 'Correctness code review',
        description: 'Review a diff for real correctness bugs and high-confidence reuse/simplification cleanups. One concrete finding per issue: location, the problem, the fix.',
        tags: ['quality', 'review'],
        body: [
            'Review the current diff. Report only findings you are confident about.',
            '',
            '- **Correctness:** off-by-one, null/undefined, error paths not handled, race conditions, wrong boundary, broken invariant.',
            '- **Reuse:** code that reinvents something already in the codebase or standard library.',
            '- **Simplification:** dead branches, redundant state, needless async, over-broad types.',
            '',
            'For each finding give `file:line`, one sentence on the problem, and the concrete fix. No style nits, no praise.',
        ].join('\n'),
    },
    {
        id: 'tdd',
        name: 'Test-driven development',
        description: 'Red-green-refactor: write a failing test that pins the behavior, make it pass with the smallest change, then refactor. Real tests against real behavior, no mocked critical paths.',
        tags: ['testing', 'tdd'],
        body: [
            'Build the feature or fix the bug test-first.',
            '',
            '1. **Red:** write one test that fails for the right reason and names the behavior you want. Run it; confirm it fails.',
            '2. **Green:** make it pass with the smallest change. Run it; confirm it passes.',
            '3. **Refactor:** clean up with the test as a safety net. Keep it green.',
            '',
            'Test real behavior end to end. Do not mock the thing under test. One behavior per test; clear names.',
        ].join('\n'),
    },
    {
        id: 'diagnose',
        name: 'Disciplined bug diagnosis',
        description: 'A loop for hard bugs and perf regressions: reproduce, minimise, hypothesise, instrument, fix, regression-test. No guessing, no shotgun edits.',
        tags: ['debugging', 'performance'],
        body: [
            'When a bug is hard, do not guess. Run the loop:',
            '',
            '1. **Reproduce** reliably; capture the exact failing input + output.',
            '2. **Minimise** to the smallest case that still fails.',
            '3. **Hypothesise** one cause; predict what you would see if it were true.',
            '4. **Instrument** (log/assert/trace) to confirm or kill the hypothesis - do not change behavior yet.',
            '5. **Fix** the root cause, not the symptom.',
            '6. **Regression-test** so it can never come back silently.',
        ].join('\n'),
    },
    {
        id: 'verify',
        name: 'Verify it actually works',
        description: 'Before claiming a change is done, run the app and observe the behavior - not just the type checker. Report outcomes faithfully, with the evidence.',
        tags: ['testing', 'verification'],
        body: [
            'A change is not done until you have watched it work.',
            '',
            '- Build, launch the real app, and exercise the exact flow you changed.',
            '- Type-checking proves the code compiles, not that the feature works. Do both.',
            '- Report faithfully: if a step failed, say so with the output; if you skipped one, say that.',
            '- State "done and verified" only when you have the evidence in hand.',
        ].join('\n'),
    },
];

export function listSkills(): SkillMeta[] {
    return SKILLS.map(({ body: _body, ...meta }) => meta);
}

function skillDir(root: string, tool: SkillTool, id: string): string {
    const base = tool === 'codex' ? '.codex' : '.claude';
    return path.join(path.resolve(root), base, 'skills', id);
}

// Which catalogue skills are already installed for a tool in this project.
export function installedSkills(root: string, tool: SkillTool): string[] {
    const out: string[] = [];
    for (const s of SKILLS) {
        try {
            if (fs.existsSync(path.join(skillDir(root, tool, s.id), 'SKILL.md'))) out.push(s.id);
        } catch { /* ignore */ }
    }
    return out;
}

export function installSkill(root: string, id: string, tool: SkillTool): { ok: boolean; path?: string; error?: string } {
    const s = SKILLS.find((x) => x.id === id);
    if (!s) return { ok: false, error: 'Unknown skill.' };
    if (!root || typeof root !== 'string') return { ok: false, error: 'No project open.' };
    try {
        const dir = skillDir(root, tool, id);
        // Guard: the resolved dir must stay under the project root.
        const base = path.resolve(root);
        if (!path.resolve(dir).startsWith(base)) return { ok: false, error: 'Refused: path escapes the project.' };
        fs.mkdirSync(dir, { recursive: true });
        const md = `---\nname: ${s.id}\ndescription: ${s.description}\n---\n\n# ${s.name}\n\n${s.body}\n`;
        const file = path.join(dir, 'SKILL.md');
        fs.writeFileSync(file, md, 'utf8');
        return { ok: true, path: path.relative(base, file).replace(/\\/g, '/') };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
