// console-electron/src/main/dora.ts
//
// DORA delivery metrics computed deterministically from local git history.
// No network calls; all four metrics are approximated from tag and commit data.
//
//   deployFreqPerWeek  – releases (tags + release/chore commits) per calendar week
//   leadTimeHours      – median interval from commit authoring to the tag that
//                        first includes it (sampled across the N most recent tags)
//   changeFailRatePct  – share of commits whose subject signals a revert or hotfix
//   mttrHours          – median interval between a revert/hotfix and the commit
//                        immediately before it (approximation of time-to-restore)
//
// Returns honest nulls when there is insufficient signal (e.g. no tags, no
// revert-pattern commits) rather than returning zeros that look meaningful.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DoraMetrics {
    deployFreqPerWeek: number | null;
    leadTimeHours: number | null;
    changeFailRatePct: number | null;
    mttrHours: number | null;
    windowDays: number;
    sampledAt: string;
}

const FIELD = '\x1f';
const RECORD = '\x1e';

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

function median(nums: number[]): number | null {
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Patterns that signal a revert or hotfix by commit subject.
const FAIL_RE = /^(revert|hotfix|fix!|hot-?fix|\[hotfix\])/i;

export async function computeDoraMetrics(root: string, windowDays = 90): Promise<DoraMetrics> {
    const sampledAt = new Date().toISOString();
    const since = `${windowDays} days ago`;

    // 1. Collect all commits in the window: unix timestamp + subject
    const logOut = await gitOut(root, [
        'log',
        `--since=${since}`,
        `--pretty=format:%at${FIELD}%s${RECORD}`,
        'HEAD',
    ]);

    interface CommitRow { ts: number; subject: string }
    const commits: CommitRow[] = logOut
        .split(RECORD)
        .map((r) => r.replace(/^\s+/, ''))
        .filter((r) => r.length > 0)
        .map((r) => {
            const [tsStr, subject] = r.split(FIELD);
            const ts = parseInt(tsStr ?? '0', 10);
            return { ts: Number.isFinite(ts) ? ts : 0, subject: subject ?? '' };
        })
        .filter((c) => c.ts > 0);

    // 2. Tags in the window: name + unix timestamp of the tag object (or commit)
    const tagOut = await gitOut(root, [
        'tag',
        '--sort=creatordate',
        `--format=%(creatordate:unix)${FIELD}%(refname:short)${RECORD}`,
    ]);

    interface TagRow { ts: number; name: string }
    const allTags: TagRow[] = tagOut
        .split(RECORD)
        .map((r) => r.replace(/^\s+/, ''))
        .filter((r) => r.length > 0)
        .map((r) => {
            const [tsStr, name] = r.split(FIELD);
            const ts = parseInt(tsStr ?? '0', 10);
            return { ts: Number.isFinite(ts) ? ts : 0, name: name ?? '' };
        })
        .filter((t) => t.ts > 0);

    const windowStart = Date.now() / 1000 - windowDays * 86_400;
    const windowTags = allTags.filter((t) => t.ts >= windowStart);

    // 3. Deploy frequency: (tags in window) / (window in weeks)
    const windowWeeks = windowDays / 7;
    const deployFreqPerWeek: number | null =
        windowTags.length > 0 ? windowTags.length / windowWeeks : null;

    // 4. Lead time: for each of the N most recent tags, find all commits
    //    authored between the previous tag and this tag; median(tag.ts - commit.ts).
    //    Sample up to 20 tags to stay fast.
    let leadTimeHours: number | null = null;
    const sampleTags = allTags.slice(-20);
    if (sampleTags.length >= 1) {
        const intervals: number[] = [];
        for (let i = 0; i < sampleTags.length; i++) {
            const tag = sampleTags[i];
            const prevTs = i === 0 ? 0 : sampleTags[i - 1].ts;
            // Commits whose author-timestamp falls in the (prevTag, thisTag] band
            const band = commits.filter((c) => c.ts > prevTs && c.ts <= tag.ts);
            for (const c of band) {
                const h = (tag.ts - c.ts) / 3600;
                if (h >= 0) intervals.push(h);
            }
        }
        leadTimeHours = median(intervals);
    }

    // 5. Change-failure rate: % of commits in window whose subject matches FAIL_RE
    const failCount = commits.filter((c) => FAIL_RE.test(c.subject)).length;
    const changeFailRatePct: number | null =
        commits.length > 0 ? (failCount / commits.length) * 100 : null;

    // 6. MTTR proxy: for each revert/hotfix commit, interval since the commit
    //    immediately preceding it (treating "preceding commit" as the "incident").
    let mttrHours: number | null = null;
    if (commits.length >= 2) {
        const mttrSamples: number[] = [];
        for (let i = 0; i < commits.length; i++) {
            if (FAIL_RE.test(commits[i].subject) && i + 1 < commits.length) {
                // commits are newest-first from git log
                const incident = commits[i + 1].ts;
                const fix = commits[i].ts;
                const h = (fix - incident) / 3600;
                if (h >= 0 && h < 24 * 30) mttrSamples.push(h); // cap at 30d to exclude stale outliers
            }
        }
        mttrHours = median(mttrSamples);
    }

    return {
        deployFreqPerWeek: deployFreqPerWeek !== null ? Math.round(deployFreqPerWeek * 100) / 100 : null,
        leadTimeHours: leadTimeHours !== null ? Math.round(leadTimeHours * 10) / 10 : null,
        changeFailRatePct: changeFailRatePct !== null ? Math.round(changeFailRatePct * 10) / 10 : null,
        mttrHours: mttrHours !== null ? Math.round(mttrHours * 10) / 10 : null,
        windowDays,
        sampledAt,
    };
}
