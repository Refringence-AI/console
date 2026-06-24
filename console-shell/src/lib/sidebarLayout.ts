import { useCallback, useEffect, useState } from 'react';

/**
 * Sidebar layout persistence. Phase 2 lightweight onboarding.
 *
 * The sidebar's order, hidden set, and collapsed groups live under a
 * versioned localStorage key. The editor in Settings and the live
 * Sidebar stay in sync via a CustomEvent (mirrors usePersonaMode).
 *
 * Three panels are LOCKED and can never be hidden: Overview, Release,
 * Pipeline. Helpers reject any attempt to hide them.
 */

export type SidebarLayout = {
    hidden: string[];
    order: string[];
    collapsedGroups: string[];
};

const STORAGE_KEY = 'refringence-console-sidebar-layout-v1';
const LAYOUT_EVENT = 'console-sidebar-layout-change';

/** The two group ids a collapse-all toggle spans. */
export const GROUP_IDS: readonly string[] = ['project', 'help'];

/** Panels that must always be visible. Never enter `hidden`. */
export const LOCKED: ReadonlySet<string> = new Set(['/overview', '/release', '/pipeline']);

const EMPTY_LAYOUT: SidebarLayout = { hidden: [], order: [], collapsedGroups: [] };

export function readLayout(): SidebarLayout {
    if (typeof window === 'undefined') return { ...EMPTY_LAYOUT };
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...EMPTY_LAYOUT };
        const parsed = JSON.parse(raw) as Partial<SidebarLayout>;
        return {
            hidden: (Array.isArray(parsed.hidden) ? parsed.hidden : []).filter((to) => !LOCKED.has(to)),
            order: Array.isArray(parsed.order) ? parsed.order : [],
            collapsedGroups: Array.isArray(parsed.collapsedGroups) ? parsed.collapsedGroups : [],
        };
    } catch {
        return { ...EMPTY_LAYOUT };
    }
}

/** True when the user has never customised the layout (drives the guided default). */
export function hasExplicitLayout(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(STORAGE_KEY) != null;
    } catch {
        return false;
    }
}

export function writeLayout(layout: SidebarLayout): void {
    if (typeof window === 'undefined') return;
    const sanitised: SidebarLayout = {
        hidden: layout.hidden.filter((to) => !LOCKED.has(to)),
        order: layout.order,
        collapsedGroups: layout.collapsedGroups,
    };
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitised));
        window.dispatchEvent(new CustomEvent<SidebarLayout>(LAYOUT_EVENT, { detail: sanitised }));
    } catch {
        /* noop */
    }
}

export function useSidebarLayout(): {
    layout: SidebarLayout;
    explicit: boolean;
    setHidden: (to: string, hidden: boolean) => void;
    move: (to: string, dirOrIndex: 'up' | 'down' | number) => void;
    setOrder: (order: string[]) => void;
    toggleGroup: (groupId: string) => void;
    collapseAll: (collapsed: boolean) => void;
    reset: () => void;
} {
    const [layout, setLayoutState] = useState<SidebarLayout>(readLayout);
    const [explicit, setExplicit] = useState<boolean>(hasExplicitLayout);

    useEffect(() => {
        function onChange() {
            setLayoutState(readLayout());
            setExplicit(hasExplicitLayout());
        }
        function onStorage(e: StorageEvent) {
            if (e.key === STORAGE_KEY) onChange();
        }
        window.addEventListener(LAYOUT_EVENT, onChange);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(LAYOUT_EVENT, onChange);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const commit = useCallback((next: SidebarLayout) => {
        writeLayout(next);
        setLayoutState(next);
        setExplicit(true);
    }, []);

    const setHidden = useCallback(
        (to: string, hidden: boolean) => {
            if (LOCKED.has(to)) return;
            const cur = readLayout();
            const set = new Set(cur.hidden);
            if (hidden) set.add(to);
            else set.delete(to);
            commit({ ...cur, hidden: [...set] });
        },
        [commit],
    );

    const setOrder = useCallback(
        (order: string[]) => {
            const cur = readLayout();
            commit({ ...cur, order });
        },
        [commit],
    );

    const move = useCallback(
        (to: string, dirOrIndex: 'up' | 'down' | number) => {
            const cur = readLayout();
            const order = [...cur.order];
            const from = order.indexOf(to);
            if (from === -1) return;
            let target: number;
            if (dirOrIndex === 'up') target = from - 1;
            else if (dirOrIndex === 'down') target = from + 1;
            else target = dirOrIndex;
            if (target < 0 || target >= order.length || target === from) return;
            order.splice(from, 1);
            order.splice(target, 0, to);
            commit({ ...cur, order });
        },
        [commit],
    );

    const toggleGroup = useCallback(
        (groupId: string) => {
            const cur = readLayout();
            const set = new Set(cur.collapsedGroups);
            if (set.has(groupId)) set.delete(groupId);
            else set.add(groupId);
            commit({ ...cur, collapsedGroups: [...set] });
        },
        [commit],
    );

    // Collapse or expand every group at once. Drives the "collapse all"
    // control next to the rail toggle, so a user can tuck both sections
    // away without flipping each chevron.
    const collapseAll = useCallback(
        (collapsed: boolean) => {
            const cur = readLayout();
            commit({ ...cur, collapsedGroups: collapsed ? [...GROUP_IDS] : [] });
        },
        [commit],
    );

    const reset = useCallback(() => {
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.removeItem(STORAGE_KEY);
            } catch {
                /* noop */
            }
            window.dispatchEvent(new CustomEvent<SidebarLayout>(LAYOUT_EVENT, { detail: { ...EMPTY_LAYOUT } }));
        }
        setLayoutState({ ...EMPTY_LAYOUT });
        setExplicit(false);
    }, []);

    return { layout, explicit, setHidden, move, setOrder, toggleGroup, collapseAll, reset };
}

/**
 * Apply a saved layout's order to a group's items. Items not present in
 * `order` keep their declared sequence, appended after the ordered ones.
 */
export function orderItems<T extends { to: string }>(items: T[], order: string[]): T[] {
    if (order.length === 0) return items;
    const rank = new Map(order.map((to, i) => [to, i]));
    return [...items].sort((a, b) => {
        const ra = rank.has(a.to) ? rank.get(a.to)! : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.to) ? rank.get(b.to)! : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return items.indexOf(a) - items.indexOf(b);
    });
}
