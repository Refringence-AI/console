// console-electron/src/main/ipc/release.ts
//
// Release readiness for the PICKED project, computed from REAL signals - not a
// hand-typed checklist YAML. One synthetic release ("current") whose gates are
// cheap, honest checks of the project: latest CI run, working-tree state, push
// state, key files (README / LICENSE / CI config), package scripts, and open
// blocker issues. The ReleaseSummary/ReleaseChecklist shape is unchanged so the
// Overview donut and the Release panel keep rendering.
import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { deriveRepo, isValidRepo } from '../gitRemote';

const execFileAsync = promisify(execFile);

export type GateStatus = 'green' | 'amber' | 'red' | 'blocked';

export interface ReleaseGate {
    id: string;
    label: string;
    artifact: string;
    status: GateStatus;
    notes?: string;
    blocker?: string;
}

export interface ReleaseChecklist {
    version: string;
    status: 'in-progress' | 'shipped' | 'cancelled';
    target_date: string;
    release_manager: string;
    gates: ReleaseGate[];
}

export interface ReleaseSummary {
    version: string;
    overall_status: GateStatus;
    green: number;
    amber: number;
    red: number;
    blocked: number;
    gate_count: number;
}

async function gitOut(root: string, args: string[]): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', ['-C', root, ...args], { windowsHide: true, timeout: 8_000 });
        return stdout;
    } catch {
        return null;
    }
}

async function ciGate(repo: string | null): Promise<ReleaseGate> {
    const base = { id: 'ci', label: 'CI passing', artifact: 'GitHub Actions' };
    if (!repo || !isValidRepo(repo)) return { ...base, status: 'amber', notes: 'No GitHub remote to read CI from.' };
    try {
        const { stdout } = await execFileAsync(
            'gh',
            ['run', 'list', '-R', repo, '--limit', '1', '--json', 'status,conclusion,workflowName'],
            { windowsHide: true, timeout: 15_000 },
        );
        const arr = JSON.parse(stdout) as Array<{ status?: string; conclusion?: string; workflowName?: string }>;
        if (!arr.length) return { ...base, status: 'amber', notes: 'No CI runs found.' };
        const r = arr[0];
        if (r.status !== 'completed') return { ...base, status: 'amber', notes: `Latest run is ${r.status}.` };
        if (r.conclusion === 'success') return { ...base, status: 'green', notes: `${r.workflowName ?? 'CI'} passed.` };
        return { ...base, status: 'red', notes: `${r.workflowName ?? 'CI'} did not pass (${r.conclusion}).` };
    } catch {
        return { ...base, status: 'amber', notes: 'Could not read CI (gh unavailable).' };
    }
}

async function blockerGate(repo: string | null): Promise<ReleaseGate> {
    const base = { id: 'no-blockers', label: 'No open blockers', artifact: 'GitHub issues' };
    if (!repo || !isValidRepo(repo)) return { ...base, status: 'amber', notes: 'No GitHub remote to read issues from.' };
    try {
        const { stdout } = await execFileAsync(
            'gh',
            ['issue', 'list', '-R', repo, '--state', 'open', '--label', 'blocker', '--json', 'number'],
            { windowsHide: true, timeout: 15_000 },
        );
        const arr = JSON.parse(stdout) as unknown[];
        return arr.length === 0
            ? { ...base, status: 'green', notes: 'No open issues labelled blocker.' }
            : { ...base, status: 'blocked', notes: `${arr.length} open blocker issue(s).` };
    } catch {
        return { ...base, status: 'amber', notes: 'Could not read issues (gh unavailable).' };
    }
}

function fileGate(root: string, id: string, label: string, patterns: RegExp[]): ReleaseGate {
    let found = false;
    try {
        for (const f of fs.readdirSync(root)) {
            if (patterns.some((p) => p.test(f))) { found = true; break; }
        }
    } catch { /* unreadable */ }
    return { id, label, artifact: '(repo root)', status: found ? 'green' : 'amber', notes: found ? 'Present in the repo root.' : 'Not found in the repo root.' };
}

function ciConfigGate(root: string): ReleaseGate {
    let found = false;
    try {
        found = fs.readdirSync(path.join(root, '.github', 'workflows')).some((f) => /\.ya?ml$/.test(f));
    } catch { /* no workflows dir */ }
    return { id: 'ci-config', label: 'CI configured', artifact: '.github/workflows', status: found ? 'green' : 'amber', notes: found ? 'GitHub Actions workflows present.' : 'No GitHub Actions workflows found.' };
}

function scriptGate(root: string, id: string, label: string, script: string): ReleaseGate {
    let has = false;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
        has = Boolean(pkg.scripts?.[script]);
    } catch { /* no package.json */ }
    return { id, label, artifact: 'package.json', status: has ? 'green' : 'amber', notes: has ? `A "${script}" script is defined.` : `No "${script}" script in package.json.` };
}

async function computeGates(root: string): Promise<ReleaseGate[]> {
    const repo = await deriveRepo(root);
    const gates: ReleaseGate[] = [];
    gates.push(await ciGate(repo));

    const porcelain = await gitOut(root, ['status', '--porcelain']);
    gates.push({
        id: 'clean-tree', label: 'Working tree clean', artifact: 'git status',
        status: porcelain === null ? 'amber' : (porcelain.trim() === '' ? 'green' : 'amber'),
        notes: porcelain === null ? 'Not a git checkout.' : (porcelain.trim() === '' ? 'No uncommitted changes.' : 'Uncommitted changes present.'),
    });

    const ahead = await gitOut(root, ['rev-list', '--count', '@{u}..HEAD']);
    gates.push({
        id: 'pushed', label: 'Branch pushed', artifact: 'git push',
        status: ahead === null ? 'amber' : (ahead.trim() === '0' ? 'green' : 'amber'),
        notes: ahead === null ? 'No upstream branch set.' : (ahead.trim() === '0' ? 'Up to date with upstream.' : `${ahead.trim()} commit(s) ahead of upstream.`),
    });

    gates.push(fileGate(root, 'readme', 'README present', [/^readme(\.md|\.rst|\.txt)?$/i]));
    gates.push(fileGate(root, 'license', 'License present', [/^licen[sc]e(\.md|\.txt)?$/i]));
    gates.push(ciConfigGate(root));
    gates.push(scriptGate(root, 'tests', 'Tests configured', 'test'));
    gates.push(scriptGate(root, 'build', 'Build configured', 'build'));
    gates.push(await blockerGate(repo));
    return gates;
}

function summarise(gates: ReleaseGate[]): ReleaseSummary {
    const counts = { green: 0, amber: 0, red: 0, blocked: 0 } as Record<GateStatus, number>;
    for (const g of gates) counts[g.status]++;
    let overall: GateStatus = 'green';
    if (counts.blocked > 0) overall = 'blocked';
    else if (counts.red > 0) overall = 'red';
    else if (counts.amber > 0) overall = 'amber';
    return { version: 'current', overall_status: overall, gate_count: gates.length, ...counts };
}

export function registerReleaseHandlers(): void {
    // One synthetic release per project, so the renderer's list -> version flow
    // is preserved (it threads the version into get/summary).
    ipcMain.handle('console:release.list', (_e, root: string): { version: string; status: string }[] => {
        if (typeof root !== 'string' || root.length === 0) return [];
        return [{ version: 'current', status: 'in-progress' }];
    });

    ipcMain.handle('console:release.get', async (_e, root: string): Promise<ReleaseChecklist | null> => {
        if (typeof root !== 'string' || root.length === 0) return null;
        const gates = await computeGates(root);
        return { version: 'current', status: 'in-progress', target_date: '', release_manager: '', gates };
    });

    ipcMain.handle('console:release.summary', async (_e, root: string): Promise<ReleaseSummary | null> => {
        if (typeof root !== 'string' || root.length === 0) return null;
        return summarise(await computeGates(root));
    });
}
