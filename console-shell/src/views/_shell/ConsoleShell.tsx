import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
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
