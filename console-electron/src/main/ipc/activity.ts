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
}
