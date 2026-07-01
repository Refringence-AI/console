// console-electron/src/main/ecn.ts
//
// Engineering Change Notice (ECN) generator. Deterministic from git only;
// no network, no Date() calls inside this module. The caller passes `at`.
//
// Public surface: generateEcn(root, ref, at)
//   root  - absolute path to the git working tree
//   ref   - a single ref (e.g. "HEAD", "abc1234") or a range
//           (e.g. "HEAD~3..HEAD"). Defaults to "HEAD" when absent.
//   at    - ISO timestamp string provided by the caller (not generated here)
//
// Risk hint thresholds (total lines changed = additions + deletions):
//   low    < 50
//   medium < 300
//   high   >= 300
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ── Public types ─────────────────────────────────────────────────────────────

export interface ImpactedArea {
    area: string;    // top-level directory name (or '.' for root-level files)
    files: number;   // number of changed files inside this area
}

export interface EcnEntry {
    ok: boolean;
    ref: string;
    title: string;
    summary: string;
    impactedAreas: ImpactedArea[];
    filesChanged: number;
    additions: number;
    deletions: number;
    risk: 'low' | 'medium' | 'high';
    at: string;
    error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_ECN = (ref: string, at: string, error: string): EcnEntry => ({
    ok: false,
    ref,
    title: '',
    summary: '',
    impactedAreas: [],
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    risk: 'low',
    at,
    error,
});

async function gitOut(root: string, args: string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync('git', args, {
            cwd: root,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
        });
        return stdout.trim();
    } catch {
        return '';
    }
}

// Normalise a ref string. A bare single SHA/branch/tag is turned into
// "<ref>^..<ref>" so we always get a one-commit diff range for numstat.
// A range containing ".." is passed through unchanged.
function normaliseRef(ref: string): { logRange: string; diffRange: string } {
    const trimmed = ref.trim();
    if (trimmed.includes('..')) {
        return { logRange: trimmed, diffRange: trimmed };
    }
    // Single commit: show just that commit in log, and diff its parent..itself.
    return { logRange: `${trimmed}^..${trimmed}`, diffRange: `${trimmed}^..${trimmed}` };
}

function riskFromLines(total: number): 'low' | 'medium' | 'high' {
    if (total < 50) return 'low';
    if (total < 300) return 'medium';
    return 'high';
}

// ── Core function ─────────────────────────────────────────────────────────────

export async function generateEcn(
    root: string,
    ref: string,
    at: string,
): Promise<EcnEntry> {
    if (typeof root !== 'string' || root.length === 0) {
        return EMPTY_ECN(ref, at, 'root must be a non-empty path');
    }
    const safeRef = typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : 'HEAD';
    const { logRange, diffRange } = normaliseRef(safeRef);

    // 1. Commit subjects and bodies in range (RS/US delimited for safety).
    const FIELD = '\x1f';
    const RECORD = '\x1e';

    const logRaw = await gitOut(root, [
        'log',
        logRange,
        `--pretty=format:%s${FIELD}%b${RECORD}`,
    ]);

    interface LogRow { subject: string; body: string }
    const logRows: LogRow[] = logRaw
        .split(RECORD)
        .map((r) => r.replace(/^\s+/, ''))
        .filter((r) => r.length > 0)
        .map((r) => {
            const sepIdx = r.indexOf(FIELD);
            const subject = sepIdx >= 0 ? r.slice(0, sepIdx).trim() : r.trim();
            const body = sepIdx >= 0 ? r.slice(sepIdx + 1).trim() : '';
            return { subject, body };
        });

    if (logRows.length === 0) {
        return EMPTY_ECN(safeRef, at, `no commits found for ref: ${safeRef}`);
    }

    // Title = subject of the most recent commit (first in log output).
    const title = logRows[0].subject;

    // Summary = all non-empty bodies joined, de-duplicated whitespace.
    const summary = logRows
        .map((r) => r.body)
        .filter((b) => b.length > 0)
        .join('\n\n')
        .replace(/\s+\n/g, '\n')
        .trim();

    // 2. Numstat diff for the range.
    const numstatRaw = await gitOut(root, [
        'diff',
        '--numstat',
        diffRange,
        '--',
    ]);

    // Each numstat line: "<additions>\t<deletions>\t<filepath>"
    // Binary files show "-\t-\t<path>" which we count as 0/0.
    let additions = 0;
    let deletions = 0;
    const areaCounts: Record<string, number> = {};

    const numstatLines = numstatRaw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    for (const line of numstatLines) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const addStr = parts[0];
        const delStr = parts[1];
        const filePath = parts.slice(2).join('\t'); // handles tabs in names

        const addN = addStr === '-' ? 0 : parseInt(addStr, 10);
        const delN = delStr === '-' ? 0 : parseInt(delStr, 10);
        additions += Number.isFinite(addN) ? addN : 0;
        deletions += Number.isFinite(delN) ? delN : 0;

        // Top-level directory = segment before the first slash (or '.' for root files).
        const slashIdx = filePath.indexOf('/');
        const area = slashIdx > 0 ? filePath.slice(0, slashIdx) : '.';
        areaCounts[area] = (areaCounts[area] ?? 0) + 1;
    }

    const filesChanged = numstatLines.length;
    const totalLines = additions + deletions;
    const risk = riskFromLines(totalLines);

    // Impacted areas sorted by file count descending.
    const impactedAreas: ImpactedArea[] = Object.entries(areaCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([area, files]) => ({ area, files }));

    return {
        ok: true,
        ref: safeRef,
        title,
        summary,
        impactedAreas,
        filesChanged,
        additions,
        deletions,
        risk,
        at,
    };
}
