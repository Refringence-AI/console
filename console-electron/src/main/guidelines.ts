// console-electron/src/main/guidelines.ts
//
// Project guideline file (Phase P6). Console reads a project best when its
// docs, checklists, eval output, QA runs, and architecture file sit in the
// places Console looks. This module generates a markdown guideline that
// tells the user's coding agent to reorganize the project into that shape,
// then writes it through the SAME managed-block writers the dev-tool router
// uses (devhandoff.writeAgentsMd / writeCursorRules) so it lands once, in a
// block, and a re-run only rewrites the block.
import {
    writeAgentsMd,
    writeCursorRules,
    type WriteResult,
} from './devhandoff';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type GuidelineTarget = 'agents-md' | 'cursorrules';

export interface GuidelineStatus {
    agentsMd: boolean;
    cursorRules: boolean;
}

const BLOCK_START = '# --- Console (managed) ---';

// The body of the managed block. Enumerates exactly what Console reads so an
// agent can shape the repo to match. No em-dashes; plain ASCII.
export function generateGuideline(): string {
    return [
        '## Set up this project for Console',
        '',
        'Console reads a project through a fixed set of files and',
        'folders. Reorganize and format this project so Console can find them.',
        '',
        '### What Console reads',
        '',
        '- `docs/` with categorized docs. Group by purpose: planning, onboarding,',
        '  runbooks, ADRs, reference, compliance, testing, operations. One topic',
        '  per file; put a short title on the first line.',
        '- `docs/release-checklists/*.yaml`: one YAML per release with a `version`,',
        '  a `status`, and a `gates` list (each gate has an `id`, `label`,',
        '  `artifact`, and `status`). Console renders these as the release board.',
        '- Eval output: write the eval harness summary as JSON so Console can show',
        '  pass/fail counts and cost. Keep it in the repo, not only in CI logs.',
        '- `.refringence-qa/runs/`: one folder per QA run with a status manifest',
        '  (run id, ok/failed, artifact list). Console reads these for the',
        '  observability view.',
        '- `.refringence-console/architecture.json`: an optional saved layout for',
        '  the architecture graph (node positions, tier overrides, notes).',
        '',
        '### How to format the code',
        '',
        '- Declare `paths` in `tsconfig.json` for internal aliases so the',
        '  architecture graph resolves cross-package imports instead of dropping',
        '  the edges.',
        '- Avoid dependency cycles between packages; a clean tier order reads',
        '  better on the graph and is easier to reason about.',
        '- One directory per package, named after the package. Keep each',
        "  package's source under that one directory.",
        '',
        'When you reorganize, move files rather than copying them, and keep the',
        'managed block above any hand-written notes so a re-run does not disturb',
        'your edits.',
    ].join('\n');
}

// Resolve a project root the same way the rest of main does: an explicit
// directory that is inside (or equal to) the active project root, otherwise
// the active project root. The inside() check is authoritative: an explicit
// root resolving OUTSIDE the active root is rejected (we fall back to base),
// so the renderer cannot point a write at an arbitrary directory.
function resolveRoot(root?: string): string {
    const base = process.cwd();
    if (root && root.trim().length > 0) {
        const abs = path.resolve(root);
        const rel = path.relative(base, abs);
        const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        if (inside) {
            try {
                if (fs.statSync(abs).isDirectory()) return abs;
            } catch {
                /* fall through to base */
            }
        }
    }
    return base;
}

// Write the guideline into the chosen target's managed block. Reuses the
// devhandoff writers so we never double-write a file ourselves.
export function writeGuideline(root: string, target: GuidelineTarget): WriteResult {
    const content = generateGuideline();
    if (target === 'cursorrules') {
        return writeCursorRules(root, content, 'replace');
    }
    return writeAgentsMd(root, content, 'replace');
}

// Whether each target file already carries our managed block.
export function guidelineStatus(root?: string): GuidelineStatus {
    const dir = resolveRoot(root);
    return {
        agentsMd: hasManagedBlock(path.join(dir, 'AGENTS.md')),
        cursorRules: hasManagedBlock(path.join(dir, '.cursorrules')),
    };
}

function hasManagedBlock(file: string): boolean {
    try {
        if (!fs.existsSync(file)) return false;
        return fs.readFileSync(file, 'utf8').includes(BLOCK_START);
    } catch {
        return false;
    }
}
