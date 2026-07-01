// console-electron/src/main/ipc/intel.ts
//
// Project Intelligence Engine IPC. Two surfaces:
//
//   console:intel.profile(root, { force? })  -> ProjectProfile | null
//     Fast path: returns the cached deterministic profile if the tree signature
//     is unchanged, else rebuilds. Used by the Project Report + onboarding.
//
//   console:intel.mount.start(root, { ai? })  -> { mountId }
//     Streamed "mount + study": emits step events as each stage runs, then a
//     mount.profile event the instant the deterministic profile is ready (render
//     now), then mount.done. AI enrichment streams over mount.ai in a later
//     phase. Clones the runner.ts streaming shape (sync id + webContents.send).
//
// Every handler is total: it degrades to null / an error event rather than
// throwing into the renderer. projectRoot is resolved + traversal-guarded.
import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { buildProfile, MOUNT_STEPS } from '../intel/profiler';
import { writeEnvConsent } from '../intel/consent';
import { enrichProfile } from '../intel/enrich';
import { cacheSignature } from './architecture-graph';
import type { ProjectProfile, ProjectIntel } from '../intel/types';

const CACHE_FILE = 'intel-profile.json';

function resolveRoot(input: string | undefined | null): string | null {
    if (!input || input.trim().length === 0) return null;
    const abs = path.resolve(input);
    try {
        if (!fs.statSync(abs).isDirectory()) return null;
    } catch {
        return null;
    }
    return abs;
}

// Bump when the profiler logic changes in a way that should invalidate cached
// profiles (the tree signature is mtime-based and would not notice a code
// change, so an improvement would otherwise never reach an unchanged repo).
// v3: the deep-intelligence upgrade (detail group, notableFrameworks, fixed
// shape/roles/edges, richer git, ratios). v4: hotspots/readingOrder/containers/
// workflows/envGroups/todoCount/release + AI packageNotes/changeFirst/runGuide.
const PROFILE_VERSION = 4;

interface CacheEnvelope { v: number; profile: ProjectProfile; }

function consoleDir(root: string): string {
    return path.join(root, '.refringence-console');
}

// Returns the cached profile plus the profiler version it was built with, so the
// caller can both (a) reject a stale-version cache and (b) carry its `ai` field
// forward into the rebuild. Reads the legacy bare-profile shape as version 1.
function readCache(root: string): { profile: ProjectProfile; version: number } | null {
    try {
        const raw = fs.readFileSync(path.join(consoleDir(root), CACHE_FILE), 'utf8');
        const parsed = JSON.parse(raw) as Partial<CacheEnvelope> & Partial<ProjectProfile>;
        const env = parsed as Partial<CacheEnvelope>;
        if (typeof env.v === 'number' && env.profile?.identity && typeof env.profile.signature === 'string') {
            return { profile: env.profile, version: env.v };
        }
        const legacy = parsed as Partial<ProjectProfile>;
        if (typeof legacy.signature === 'string' && legacy.identity) {
            return { profile: legacy as ProjectProfile, version: 1 };
        }
        return null;
    } catch {
        return null;
    }
}

function writeCache(root: string, profile: ProjectProfile): void {
    try {
        fs.mkdirSync(consoleDir(root), { recursive: true });
        fs.writeFileSync(path.join(consoleDir(root), CACHE_FILE), JSON.stringify({ v: PROFILE_VERSION, profile }), 'utf8');
    } catch {
        /* cache write is best-effort */
    }
}

// nowIso is stamped main-side; tests can mock Date if needed. We pass a fresh
// ISO so the profile carries an honest generated-at without surprising callers.
function nowIso(): string {
    return new Date().toISOString();
}

async function getProfile(root: string, force: boolean): Promise<ProjectProfile> {
    const signature = cacheSignature(root);
    const cached = readCache(root);
    if (!force && cached && cached.version === PROFILE_VERSION && cached.profile.signature === signature) {
        return cached.profile;
    }
    const profile = await buildProfile(root, nowIso());
    // Carry the (expensive) AI enrichment forward across a deterministic or
    // version rebuild so a signature bump or profiler upgrade does not silently
    // wipe it. The user refreshes it explicitly via "Re-read with AI".
    if (cached?.profile.ai && !profile.ai) profile.ai = cached.profile.ai;
    writeCache(root, profile);
    return profile;
}

function send(win: BrowserWindow | null, channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// A globally-unique id per mount. An incrementing module-level counter raced
// across concurrent windows (two mounts could share an id, crossing their
// streamed step/profile/done events); a UUID cannot collide.
function newMountId(): string {
    return `mount-${randomUUID()}`;
}

async function runMount(win: BrowserWindow | null, root: string, mountId: string): Promise<void> {
    try {
        // Announce the full step list up front so the UI can render the checklist.
        send(win, 'console:intel.mount.step', {
            mountId, phase: 'init', steps: MOUNT_STEPS, current: null,
        });

        // Fast cache hit: skip the staged build, emit the profile immediately.
        const signature = cacheSignature(root);
        const cached = readCache(root);
        if (cached && cached.version === PROFILE_VERSION && cached.profile.signature === signature) {
            send(win, 'console:intel.mount.profile', { mountId, profile: cached.profile, cached: true });
            send(win, 'console:intel.mount.done', { mountId, ok: true, profile: cached.profile });
            return;
        }

        const profile = await buildProfile(root, nowIso(), (id, label) => {
            send(win, 'console:intel.mount.step', { mountId, phase: 'step', current: id, label });
        });
        // Preserve any prior AI enrichment across the rebuild (see getProfile).
        if (cached?.profile.ai && !profile.ai) profile.ai = cached.profile.ai;
        writeCache(root, profile);
        send(win, 'console:intel.mount.profile', { mountId, profile, cached: false });
        send(win, 'console:intel.mount.done', { mountId, ok: true, profile });
    } catch (err) {
        send(win, 'console:intel.mount.done', {
            mountId, ok: false, error: err instanceof Error ? err.message : 'mount failed', profile: null,
        });
    }
}

export function registerIntelHandlers(): void {
    ipcMain.handle(
        'console:intel.profile',
        async (_e, projectRoot: string, opts?: { force?: boolean }): Promise<ProjectProfile | null> => {
            const root = resolveRoot(projectRoot);
            if (!root) return null;
            try {
                return await getProfile(root, opts?.force === true);
            } catch {
                return null;
            }
        },
    );

    ipcMain.handle(
        'console:intel.mount.start',
        (e, projectRoot: string): { mountId: string; ok: boolean } => {
            const root = resolveRoot(projectRoot);
            if (!root) return { mountId: '', ok: false };
            const win = BrowserWindow.fromWebContents(e.sender);
            const mountId = newMountId();
            // Fire-and-forget: the streamed events carry the result.
            void runMount(win, root, mountId);
            return { mountId, ok: true };
        },
    );

    // Onboarding records the user's .env-read consent BEFORE the study mount, so
    // the profiler (which reads .env key names) respects it on this and every
    // later build. allow=false means .env is never read for this project.
    ipcMain.handle(
        'console:intel.setEnvConsent',
        (_e, projectRoot: string, allow: boolean): { ok: boolean } => {
            const root = resolveRoot(projectRoot);
            if (!root) return { ok: false };
            writeEnvConsent(root, allow === true);
            return { ok: true };
        },
    );

    // AI enrichment: load the deterministic profile, ask a connected model for
    // the narrative + suggestions + validated systems diagram, persist `ai` into
    // the cached profile, and return it. Returns { ok:false } with a reason when
    // no provider is connected (the report shows a "connect AI" prompt then).
    ipcMain.handle(
        'console:intel.enrich',
        async (_e, projectRoot: string, opts?: { model?: string }): Promise<{ ok: boolean; intel?: ProjectIntel; error?: string }> => {
            const root = resolveRoot(projectRoot);
            if (!root) return { ok: false, error: 'invalid project root' };
            try {
                const profile = await getProfile(root, false);
                const res = await enrichProfile(profile, opts?.model, nowIso());
                if (res.ok && res.intel) {
                    profile.ai = res.intel;
                    writeCache(root, profile);
                }
                return res;
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : 'enrichment failed' };
            }
        },
    );
}
