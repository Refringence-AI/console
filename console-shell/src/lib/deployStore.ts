// Per-project record of the last Console-initiated Vercel deploy. The Overview's
// deployment card used the Vercel account's GLOBAL latest deployment, so a
// project that was never deployed (e.g. a freshly opened folder) showed an
// unrelated project's URL. We instead remember, per project path, what Console
// deployed, and show only that - otherwise "not deployed".

export interface StoredDeploy {
    url: string;
    name: string;
    id: string;
    at: number;
}

const key = (projectPath: string) => `refringence-console-deploy:${projectPath}`;

export function setLastDeploy(projectPath: string, d: StoredDeploy): void {
    if (!projectPath) return;
    try {
        window.localStorage.setItem(key(projectPath), JSON.stringify(d));
    } catch {
        /* storage unavailable */
    }
}

export function getLastDeploy(projectPath: string): StoredDeploy | null {
    if (!projectPath) return null;
    try {
        const raw = window.localStorage.getItem(key(projectPath));
        return raw ? (JSON.parse(raw) as StoredDeploy) : null;
    } catch {
        return null;
    }
}
