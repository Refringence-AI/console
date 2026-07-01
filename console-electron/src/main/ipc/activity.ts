// console-electron/src/main/ipc/activity.ts
//
// Activity feed IPC: recent git commits from the PICKED project, parsed
// into a typed feed. Replaces the renderer's synthetic sampleFeed() so
// the Activity panel and the Operator cockpit show real history.
import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ActivityCommit {
    hash: string;
    subject: string;
    author: string;
    relativeTime: string; // git %cr, e.g. "5 minutes ago"
    isoTime: string;      // git %cI
}

export interface DeliveryCadence {
    commits7d: number;
    commits30d: number;
    daysSinceLastCommit: number | null;
    contributors30d: number;
    releaseCount: number;
    daysSinceLastRelease: number | null;
}

const EMPTY_CADENCE: DeliveryCadence = {
    commits7d: 0, commits30d: 0, daysSinceLastCommit: null,
    contributors30d: 0, releaseCount: 0, daysSinceLastRelease: null,
};

async function gitOut(root: string, args: string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync('git', args, { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 });
        return stdout.trim();
    } catch {
        return '';
    }
}

// Unit / record separators keep the parse robust against subjects that
// contain commas, pipes, or newlines.
const FIELD = '\x1f';
const RECORD = '\x1e';

export function registerActivityHandlers(): void {
    ipcMain.handle(
        'console:activity.recentCommits',
        async (_e, root: string, limit?: number): Promise<ActivityCommit[]> => {
            const n = Math.min(Math.max(1, typeof limit === 'number' ? limit : 12), 50);
            if (typeof root !== 'string' || root.length === 0) return [];
            try {
                const { stdout } = await execFileAsync(
                    'git',
                    [
                        'log',
                        '-n',
                        String(n),
                        `--pretty=format:%h${FIELD}%s${FIELD}%an${FIELD}%cr${FIELD}%cI${RECORD}`,
                    ],
                    { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 },
                );
                return stdout
                    .split(RECORD)
                    .map((rec) => rec.replace(/^\s+/, ''))
                    .filter((rec) => rec.length > 0)
                    .map((rec) => {
                        const [hash, subject, author, relativeTime, isoTime] = rec.split(FIELD);
                        return {
                            hash: hash ?? '',
                            subject: subject ?? '',
                            author: author ?? '',
                            relativeTime: relativeTime ?? '',
                            isoTime: isoTime ?? '',
                        };
                    });
            } catch {
                // Not a git repo, git not on PATH, or detached state: an
                // empty feed is honest, the renderer shows its empty state.
                return [];
            }
        },
    );

    // Delivery cadence, all from git: how active the repo is and how often it
    // releases. Deterministic; a non-git folder returns zeros honestly.
    ipcMain.handle('console:activity.cadence', async (_e, root: string): Promise<DeliveryCadence> => {
        if (typeof root !== 'string' || root.length === 0) return EMPTY_CADENCE;
        const [c7, c30, lastIso, authors, tags] = await Promise.all([
            gitOut(root, ['rev-list', '--count', '--since=7 days ago', 'HEAD']),
            gitOut(root, ['rev-list', '--count', '--since=30 days ago', 'HEAD']),
            gitOut(root, ['log', '-1', '--format=%cI']),
            gitOut(root, ['log', '--since=30 days ago', '--format=%an', 'HEAD']),
            gitOut(root, ['tag', '--sort=-creatordate', '--format=%(creatordate:iso8601)']),
        ]);
        const num = (s: string): number => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : 0; };
        const daysSince = (iso: string): number | null => {
            const t = Date.parse(iso);
            return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : null;
        };
        const tagDates = tags.split('\n').map((s) => s.trim()).filter(Boolean);
        return {
            commits7d: num(c7),
            commits30d: num(c30),
            daysSinceLastCommit: daysSince(lastIso),
            contributors30d: new Set(authors.split('\n').map((s) => s.trim()).filter(Boolean)).size,
            releaseCount: tagDates.length,
            daysSinceLastRelease: tagDates.length > 0 ? daysSince(tagDates[0]) : null,
        };
    });
}
