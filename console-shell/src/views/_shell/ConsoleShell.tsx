import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useActiveProject } from '../../lib/activeProject';
import { isProjectOnboarded } from '../../lib/onboardedProjects';
import { bridge } from '../../lib/bridge';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import CommandPalette from './CommandPalette';
import CommandPaletteHotkey from './CommandPaletteHotkey';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { ConsoleChatDock } from './ConsoleChatDock';
import { useConsoleLayout } from '../../lib/consoleLayout';

/**
 * Console root layout.
 *
 *   TopBar      (full width)
 *   Sidebar  |  <Outlet />
 *
 * The Win11 OS titleBarOverlay still occupies the top-right ~148px;
 * TopBar reserves pr-44 internally so its trailing controls clear it.
 */
export function ConsoleShell() {
    const [paletteOpen, setPaletteOpen] = useState(false);
    const { pathname } = useLocation();
    const { layout } = useConsoleLayout();
    const navigate = useNavigate();
    const { project } = useActiveProject();
    const queryClient = useQueryClient();

    // Per-project setup guard: if the active project has never been onboarded -
    // e.g. the user just opened a brand-new folder - take them to setup. A
    // previously set-up project falls straight through to its overview.
    useEffect(() => {
        const path = project?.path;
        if (path && !isProjectOnboarded(path)) navigate('/welcome');
    }, [project?.path, navigate]);

    // The assistant can act as an operator: when it calls focus_panel, open that
    // panel for the user (architecture maps to the arch route; the rest match).
    useEffect(() => {
        return bridge.ai.onFocusPanel((panel) => {
            navigate(panel === 'architecture' ? '/arch' : `/${panel}`);
        });
    }, [navigate]);

    // Intelligent freshness: watch the active project (event-driven, no polling)
    // and, on a real debounced change, invalidate the cheap deterministic queries.
    // Only mounted (visible) queries refetch; AI/connector queries are excluded so
    // a file edit never triggers a network round-trip.
    useEffect(() => {
        void bridge.fsWatch.watch(project?.path ?? '');
        return () => { void bridge.fsWatch.watch(''); };
    }, [project?.path]);

    useEffect(() => {
        let t: ReturnType<typeof setTimeout> | undefined;
        const off = bridge.fsWatch.onProjectChanged(() => {
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                queryClient.invalidateQueries({
                    predicate: (q) => {
                        const k = String(q.queryKey[0] ?? '');
                        return !(k.startsWith('ai') || k.startsWith('connector') || k === 'connections');
                    },
                });
            }, 400);
        });
        return () => { off(); if (t) clearTimeout(t); };
    }, [queryClient]);

    useEffect(() => {
        function handler() {
            setPaletteOpen(true);
        }
        window.addEventListener('console-open-palette', handler);
        return () => window.removeEventListener('console-open-palette', handler);
    }, []);

    return (
        <div
            className="flex h-full w-full flex-col bg-background text-foreground"
            data-testid="console-shell"
        >
            <a
                href="#main-content"
                className="sr-only rounded-md bg-card px-3 py-2 text-body-strong text-foreground ring-2 ring-ring focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50"
            >
                Skip to content
            </a>
            <TopBar />
            <div className="flex min-h-0 flex-1">
                <Sidebar />
                <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-hidden outline-none">
                    <PanelErrorBoundary key={pathname} name={pathname}>
                        <Outlet />
                    </PanelErrorBoundary>
                </main>
                <ConsoleChatDock open={layout.chatOpen} />
            </div>
            <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
            <CommandPaletteHotkey onToggle={() => setPaletteOpen((o) => !o)} />
        </div>
    );
}
