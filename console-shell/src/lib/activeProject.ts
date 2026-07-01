// console-shell/src/lib/activeProject.ts
//
// localStorage-backed active project + a useActiveProject() hook that
// stays in sync across components via a window event. Settings,
// Connect wizard, Pipeline, and Overview NewcomerBanner all read
// through this so picking a folder anywhere re-evaluates the rest.
//
// The ACTIVE project is scoped PER WINDOW so several projects can be open
// at once in separate windows. Each window gets a stable id via the `?wid=`
// query the main process appends on load (it survives reloads); the active
// path is keyed by that id. The RECENT list stays global so a project opened
// in one window shows up in another window's switcher.

import { useEffect, useState, useCallback } from 'react';
import { bridge } from './bridge';

function windowId(): string {
    if (typeof window === 'undefined') return '0';
    try {
        return new URLSearchParams(window.location.search).get('wid') || '0';
    } catch {
        return '0';
    }
}

const WID = windowId();
const PATH_KEY = `refringence-console-active-project:${WID}`;
const PICKED_AT_KEY = `refringence-console-active-project-pickedAt:${WID}`;
const RECENT_KEY = 'refringence-console-recent-projects-v1';
const RECENT_CAP = 6;
const CHANGE_EVENT = 'console-active-project-change';

export interface ActiveProject {
    path: string;
    pickedAt: number;
}

export function readRecentProjects(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((p): p is string => typeof p === 'string').slice(0, RECENT_CAP);
    } catch {
        return [];
    }
}

function pushRecentProject(path: string): void {
    if (typeof window === 'undefined') return;
    try {
        const next = [path, ...readRecentProjects().filter((p) => p !== path)].slice(0, RECENT_CAP);
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        /* noop */
    }
}

export function readActiveProject(): ActiveProject | null {
    if (typeof window === 'undefined') return null;
    try {
        const path = window.localStorage.getItem(PATH_KEY);
        if (!path) return null;
        const pickedAtRaw = window.localStorage.getItem(PICKED_AT_KEY);
        const pickedAt = pickedAtRaw ? Number(pickedAtRaw) : 0;
        return { path, pickedAt: Number.isFinite(pickedAt) ? pickedAt : 0 };
    } catch {
        return null;
    }
}

export function writeActiveProject(path: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(PATH_KEY, path);
        window.localStorage.setItem(PICKED_AT_KEY, String(Date.now()));
        pushRecentProject(path);
        // Persist in main so the next launch (and post-update) reopens it.
        try { void bridge.project.remember(path); } catch { /* offline / stub */ }
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    } catch {
        /* noop */
    }
}

export function clearActiveProject(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(PATH_KEY);
        window.localStorage.removeItem(PICKED_AT_KEY);
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    } catch {
        /* noop */
    }
}

export function useActiveProject(): {
    project: ActiveProject | null;
    setProject: (path: string) => void;
    clear: () => void;
} {
    const [project, setProjectState] = useState<ActiveProject | null>(() => readActiveProject());

    useEffect(() => {
        function onChange() {
            setProjectState(readActiveProject());
        }
        function onStorage(e: StorageEvent) {
            if (e.key === PATH_KEY || e.key === PICKED_AT_KEY) {
                setProjectState(readActiveProject());
            }
        }
        window.addEventListener(CHANGE_EVENT, onChange);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(CHANGE_EVENT, onChange);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const setProject = useCallback((path: string) => {
        writeActiveProject(path);
    }, []);

    const clear = useCallback(() => {
        clearActiveProject();
    }, []);

    return { project, setProject, clear };
}

export function useRecentProjects(): {
    recent: string[];
    active: string | null;
    setProject: (path: string) => void;
} {
    const [recent, setRecent] = useState<string[]>(() => readRecentProjects());
    const [active, setActive] = useState<string | null>(() => readActiveProject()?.path ?? null);

    useEffect(() => {
        function onChange() {
            setRecent(readRecentProjects());
            setActive(readActiveProject()?.path ?? null);
        }
        function onStorage(e: StorageEvent) {
            if (e.key === PATH_KEY || e.key === PICKED_AT_KEY || e.key === RECENT_KEY) {
                onChange();
            }
        }
        window.addEventListener(CHANGE_EVENT, onChange);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(CHANGE_EVENT, onChange);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const setProject = useCallback((path: string) => {
        writeActiveProject(path);
    }, []);

    return { recent, active, setProject };
}
