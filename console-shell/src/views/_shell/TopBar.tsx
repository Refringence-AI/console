import { useEffect, useState } from 'react';
import { Folder, Sun, Moon, Search, FolderOpen, FolderSearch, SquarePlus, MessageSquareText, ArrowUpCircle } from 'lucide-react';
import { useActiveProject, useRecentProjects } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PERSONA_LABEL } from '../../lib/persona';
import { useConsoleLayout } from '../../lib/consoleLayout';
import { useUpdate } from '../../lib/useUpdate';
import { bridge } from '../../lib/bridge';
import { Button, IconButton, Kbd } from '@/components/ui';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { WindowControls } from './WindowControls';

/**
 * Console top bar. Full-width band above Sidebar + content.
 *
 * Holds the brand mark, the project switcher, the persona pill, the Ctrl+K
 * hint, the theme toggle, and the custom window controls. The window is
 * frameless and the controls are rendered in React (WindowControls), so there
 * is no OS caption overlay. The whole bar is a drag region (globals.css) except
 * interactive elements, which opt out via the no-drag rule.
 */

function readTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem('refringence-console-theme');
    return stored === 'dark' ? 'dark' : 'light';
}

function basename(p: string): string {
    const norm = p.replace(/\\/g, '/');
    const trimmed = norm.endsWith('/') ? norm.slice(0, -1) : norm;
    const idx = trimmed.lastIndexOf('/');
    return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function TopBar() {
    const { project, setProject } = useActiveProject();
    const { recent } = useRecentProjects();
    const [theme, setTheme] = useState<'light' | 'dark'>(() => readTheme());
    // Persona via the shared hook so a flip in this TopBar instantly
    // re-renders Sidebar's persona chip + Overview/Workboard newbie
    // variants via the broadcast event the hook owns.
    const { persona, setPersona } = usePersonaMode();
    // The Assistant lives in the right dock now (not a left-nav panel); the
    // TopBar owns its open/close toggle. consoleLayout is the one owner of
    // the chatOpen bit, so the dock + this button stay in lock-step.
    const { layout, toggleChat } = useConsoleLayout();
    const chatOpen = layout.chatOpen;

    useEffect(() => {
        // Cross-component theme sync via custom event; the existing
        // 'console-theme-change' listener pattern is reused.
        function onExternal(e: Event) {
            const t = (e as CustomEvent<'light' | 'dark'>).detail;
            if (t === 'light' || t === 'dark') setTheme(t);
        }
        window.addEventListener('console-theme-change', onExternal as EventListener);
        return () => window.removeEventListener('console-theme-change', onExternal as EventListener);
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        window.localStorage.setItem('refringence-console-theme', theme);
        window.dispatchEvent(new CustomEvent('console-theme-change', { detail: theme }));
    }, [theme]);

    // Name the OS window after the active project so several windows are
    // distinguishable on the taskbar and Alt-Tab.
    useEffect(() => {
        const title = project ? `${basename(project.path)} - Console` : 'Console';
        bridge.window.setTitle(title).catch(() => { /* bridge unavailable in dev */ });
    }, [project?.path]);

    async function pickProject() {
        try {
            const res = await bridge.project.pickFolder();
            if (!res.canceled && res.path) setProject(res.path);
        } catch {
            /* noop - bridge unavailable in browser dev */
        }
    }

    async function openInExplorer() {
        if (!project?.path) return;
        try {
            await bridge.openPath(project.path);
        } catch {
            /* noop - bridge unavailable in browser dev */
        }
    }

    async function newWindow() {
        // A new project opens in its own window so several projects can be
        // open and worked on at once. The fresh window starts at onboarding.
        try {
            await bridge.window.newWindow();
        } catch {
            /* noop - bridge unavailable in browser dev */
        }
    }

    function flipPersona() {
        const current = persona ?? 'newbie';
        const next = current === 'seasoned' ? 'newbie' : 'seasoned';
        setPersona(next);
    }

    // Width the chat dock claims; kept in step with ConsoleChatDock's
    // DOCK_WIDTH so the grow exactly fits the dock without squishing content.
    const CHAT_DOCK_WIDTH = 360;

    function toggleAssistant() {
        const willOpen = !chatOpen;
        toggleChat();
        // Only grow on open; closing leaves the wider window (the user can
        // resize back). Best-effort: a no-op in browser dev or when the
        // window is maximized / already at the work-area edge.
        if (willOpen) {
            bridge.window.growForDock(CHAT_DOCK_WIDTH).catch(() => { /* bridge unavailable in dev */ });
        }
    }

    return (
        <header
            data-testid="top-bar"
            className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card pl-4 pr-0"
        >
            <div className="flex items-center gap-2">
                <img
                    src="./console.svg"
                    alt=""
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {/* Product renamed to "Console by Refringence": CONSOLE leads
                    as the bold brand word; "by Refringence" trails as quiet
                    secondary text. */}
                <span className="font-brand text-body-strong uppercase leading-tight tracking-tight text-foreground">
                    Console
                </span>
                <span className="text-label text-muted-foreground">
                    by Refringence
                </span>
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        data-testid="topbar-project-chip"
                        title={project?.path ?? 'Pick a project folder'}
                        className="min-w-0 max-w-[360px] text-muted-foreground"
                    >
                        <Folder className="h-3 w-3 shrink-0" />
                        {project ? (
                            <span className="truncate font-medium text-foreground">{basename(project.path)}</span>
                        ) : (
                            <span className="truncate">No project, click to pick</span>
                        )}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-[420px]">
                    {recent.length > 0 && (
                        <>
                            <DropdownMenuLabel className="text-label uppercase text-muted-foreground">
                                Recent projects
                            </DropdownMenuLabel>
                            {recent.map((path) => (
                                <DropdownMenuItem
                                    key={path}
                                    onSelect={() => setProject(path)}
                                    className="flex-col items-start gap-0"
                                >
                                    <span className="w-full truncate font-medium text-foreground">
                                        {basename(path)}
                                    </span>
                                    <span className="w-full truncate text-small text-muted-foreground">
                                        {path}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                        </>
                    )}
                    <DropdownMenuItem onSelect={() => { void newWindow(); }} data-testid="topbar-new-window">
                        <SquarePlus className="h-3 w-3" />
                        <span>New project in a new window</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { void pickProject(); }}>
                        <FolderOpen className="h-3 w-3" />
                        <span>Open a project in this window...</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => { void openInExplorer(); }}
                        disabled={!project?.path}
                    >
                        <FolderSearch className="h-3 w-3" />
                        <span>Open in file explorer</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto flex items-center gap-1.5 pr-2">
                <UpdatePill />

                <Button
                    variant="default"
                    size="sm"
                    data-testid="topbar-persona"
                    onClick={flipPersona}
                    title={persona === 'seasoned' ? 'Switch to Guided mode' : 'Switch to Operator mode'}
                >
                    <span>{PERSONA_LABEL[persona ?? 'newbie']}</span>
                </Button>

                <Button
                    variant={chatOpen ? 'secondary' : 'outline'}
                    size="sm"
                    data-testid="topbar-ai"
                    aria-pressed={chatOpen}
                    onClick={toggleAssistant}
                    title={chatOpen ? 'Close the assistant' : 'Open the assistant'}
                    className={chatOpen ? 'text-foreground' : 'text-muted-foreground'}
                >
                    <MessageSquareText className="h-3 w-3" />
                    <span>Assistant</span>
                </Button>

                <Button
                    variant="outline"
                    size="sm"
                    data-testid="topbar-cmdk"
                    onClick={() => window.dispatchEvent(new CustomEvent('console-open-palette'))}
                    className="text-muted-foreground"
                >
                    <Search className="h-3 w-3" />
                    <Kbd>Ctrl+K</Kbd>
                </Button>

                <IconButton
                    variant="outline"
                    size="icon-sm"
                    data-testid="topbar-theme-toggle"
                    data-theme-current={theme}
                    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                    label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
                    title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
                    className="text-muted-foreground"
                >
                    {theme === 'light' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                </IconButton>
            </div>

            <WindowControls />
        </header>
    );
}

/**
 * Appears only once a new version has downloaded in the background. Clicking it
 * restarts into the update. While the update is still downloading we stay quiet
 * (no nagging) - the affordance shows up when it's actually actionable.
 */
function UpdatePill() {
    const update = useUpdate();
    if (update.status !== 'downloaded') return null;
    return (
        <Button
            variant="primary"
            size="sm"
            data-testid="topbar-update"
            onClick={() => { void update.install(); }}
            title={update.version ? `Restart to install Console ${update.version}` : 'Restart to install the update'}
        >
            <ArrowUpCircle className="h-3 w-3" />
            <span>Restart to update</span>
        </Button>
    );
}
