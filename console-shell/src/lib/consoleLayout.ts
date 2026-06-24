// consoleLayout.ts: Console shell layout presets.
//
// The shell has three surfaces the presets toggle together:
//
//   railCollapsed   the left sidebar shows the icon rail only (no labels)
//   chatOpen        the right chat dock is open (real chat lands in P4)
//
// Presets:
//   Standard   railCollapsed:false  chatOpen:false   (default, calm)
//   Focus      railCollapsed:true   chatOpen:false   (rail only, content fills)
//   Chat       railCollapsed:true   chatOpen:true    (rail + chat flanking content)
//
// This module is the ONE owner of the rail-collapsed bit. The sidebar
// reads it; nothing else stores a second copy. Storage is localStorage;
// the renderer holds the truth (no IPC channel needed).

import { useCallback, useEffect, useState } from 'react';

export type ConsoleLayout = {
    railCollapsed: boolean;
    chatOpen: boolean;
};

export type ConsolePreset = 'standard' | 'focus' | 'chat' | 'custom';

const STORAGE_KEY = 'refringence-console-layout-v1';
const LAYOUT_EVENT = 'console-layout-change';

const PRESETS: Record<Exclude<ConsolePreset, 'custom'>, ConsoleLayout> = {
    standard: { railCollapsed: false, chatOpen: false },
    focus: { railCollapsed: true, chatOpen: false },
    chat: { railCollapsed: true, chatOpen: true },
};

const DEFAULT: ConsoleLayout = PRESETS.standard;

function eq(a: ConsoleLayout, b: ConsoleLayout): boolean {
    return a.railCollapsed === b.railCollapsed && a.chatOpen === b.chatOpen;
}

export function detectPreset(layout: ConsoleLayout): ConsolePreset {
    if (eq(layout, PRESETS.standard)) return 'standard';
    if (eq(layout, PRESETS.focus)) return 'focus';
    if (eq(layout, PRESETS.chat)) return 'chat';
    return 'custom';
}

export function presetLayout(p: Exclude<ConsolePreset, 'custom'>): ConsoleLayout {
    return PRESETS[p];
}

function readStorage(): ConsoleLayout {
    if (typeof window === 'undefined') return DEFAULT;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT;
        const parsed = JSON.parse(raw) as Partial<ConsoleLayout>;
        return {
            railCollapsed: typeof parsed.railCollapsed === 'boolean' ? parsed.railCollapsed : DEFAULT.railCollapsed,
            chatOpen: typeof parsed.chatOpen === 'boolean' ? parsed.chatOpen : DEFAULT.chatOpen,
        };
    } catch {
        return DEFAULT;
    }
}

function writeStorage(layout: ConsoleLayout): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
        window.dispatchEvent(new CustomEvent<ConsoleLayout>(LAYOUT_EVENT, { detail: layout }));
    } catch {
        /* private mode or quota: silently noop */
    }
}

export function useConsoleLayout() {
    const [layout, setLayout] = useState<ConsoleLayout>(readStorage);

    // Mirror cross-instance changes (another component flipping a preset,
    // or a second window via the storage event) into this hook.
    useEffect(() => {
        function onChange() {
            setLayout(readStorage());
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

    const commit = useCallback((next: ConsoleLayout) => {
        writeStorage(next);
        setLayout(next);
    }, []);

    const setPreset = useCallback(
        (p: Exclude<ConsolePreset, 'custom'>) => commit(PRESETS[p]),
        [commit],
    );

    const toggleRail = useCallback(() => {
        commit({ ...readStorage(), railCollapsed: !readStorage().railCollapsed });
    }, [commit]);

    const setRailCollapsed = useCallback(
        (collapsed: boolean) => commit({ ...readStorage(), railCollapsed: collapsed }),
        [commit],
    );

    const toggleChat = useCallback(() => {
        commit({ ...readStorage(), chatOpen: !readStorage().chatOpen });
    }, [commit]);

    return {
        layout,
        preset: detectPreset(layout),
        setPreset,
        toggleRail,
        setRailCollapsed,
        toggleChat,
    };
}

export { PRESETS };
