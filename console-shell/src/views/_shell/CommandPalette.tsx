import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import {
    SunMoon,
    UserCog,
    GraduationCap,
    GitBranch,
    Triangle,
    ClipboardCopy,
    FolderOpen,
    Keyboard,
    PlayCircle,
    Rocket,
    MessageSquarePlus,
    BookText,
    PanelLeft,
    LayoutGrid,
    type LucideIcon,
} from 'lucide-react';
import { GROUPS } from './Sidebar';
import { CONSOLE_DOC_PAGES } from '../docs/console-docs-index';
import { rankBySemanticSimilarity } from '../../lib/cmdk/semantic-rank';
import { readLayout } from '../../lib/sidebarLayout';
import { useConsoleLayout } from '../../lib/consoleLayout';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PERSONA_LABEL } from '../../lib/persona';
import { readActiveProject } from '../../lib/activeProject';
import { usePrompts } from '../../lib/queries/prompts';
import { setPendingPrompt } from '../../lib/prompts/pending';
import { clearOnboardedForWindow } from '../../lib/onboardedWindow';
import { bridge } from '../../lib/bridge';
import { useKeymap, NAV_CHORDS } from '../../lib/useKeymap';
import { Badge, Kbd } from '@/components/ui';
import {
    Dialog as ShortcutsDialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';

type PaletteItem =
    | {
          kind: 'panel';
          id: string;
          label: string;
          group: string;
          icon: LucideIcon;
          description: string;
          to: string;
      }
    | {
          kind: 'action';
          id: string;
          label: string;
          icon: LucideIcon;
          description: string;
          run: () => void;
      }
    | {
          kind: 'doc';
          id: string;
          label: string;
          group: string;
          description: string;
          to: string;
      }
    | {
          kind: 'prompt';
          id: string;
          label: string;
          description: string;
          to: string;
          promptId: string;
      };

function buildCatalogue(
    actions: { id: string; label: string; icon: LucideIcon; description: string; run: () => void }[],
    prompts: { id: string; title: string; whatWhen?: string; category: string }[],
): PaletteItem[] {
    const panels: PaletteItem[] = GROUPS.flatMap((g) =>
        g.items.map((it) => ({
            kind: 'panel' as const,
            id: `panel:${it.to}`,
            label: it.label,
            group: g.label,
            icon: it.icon,
            description: it.description,
            to: it.to,
        })),
    );
    const actionItems: PaletteItem[] = actions.map((a) => ({
        kind: 'action' as const,
        ...a,
    }));
    const docs: PaletteItem[] = CONSOLE_DOC_PAGES.map((d) => ({
        kind: 'doc' as const,
        id: `doc:${d.path}`,
        label: d.title,
        group: d.group,
        description: d.blurb ?? d.lead ?? '',
        to: d.path,
    }));
    const promptItems: PaletteItem[] = prompts.map((p) => ({
        kind: 'prompt' as const,
        id: `prompt:${p.id}`,
        label: p.title,
        description: p.whatWhen ?? p.category,
        to: '/prompts',
        promptId: p.id,
    }));
    return [...panels, ...actionItems, ...docs, ...promptItems];
}

function alphabetical(items: PaletteItem[]): PaletteItem[] {
    return [...items].sort((a, b) => a.label.localeCompare(b.label));
}

export default function CommandPalette({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const navigate = useNavigate();
    const { persona, setPersona } = usePersonaMode();
    const { toggleRail, setPreset, toggleChat } = useConsoleLayout();
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [semanticOrder, setSemanticOrder] = useState<Map<string, number> | null>(null);
    const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(() => new Set());
    const [helpOpen, setHelpOpen] = useState(false);

    const showHelp = useCallback(() => setHelpOpen(true), []);

    // Shell keymap: g-prefix jumps + '?' help. Disabled while the palette
    // itself is open so its own input keeps focus and never triggers chords.
    useKeymap({ enabled: !open, onShowHelp: showHelp });

    useEffect(() => {
        if (open) {
            setQuery('');
            setDebouncedQuery('');
            setSemanticOrder(null);
            setHiddenPaths(new Set(readLayout().hidden));
            const t = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [open]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 150);
        return () => clearTimeout(t);
    }, [query]);

    const actions = useMemo(
        () => [
            {
                id: 'action:toggle-theme',
                label: 'Toggle theme',
                icon: SunMoon,
                description: 'Switch between light and dark',
                run: () => {
                    const cur = window.localStorage.getItem('refringence-console-theme');
                    const next = cur === 'dark' ? 'light' : 'dark';
                    window.localStorage.setItem('refringence-console-theme', next);
                    document.documentElement.classList.toggle('dark', next === 'dark');
                },
            },
            {
                id: 'action:switch-mode',
                label: `Switch mode (${PERSONA_LABEL.newbie}/${PERSONA_LABEL.seasoned})`,
                icon: UserCog,
                description: `Currently ${PERSONA_LABEL[persona]}. Toggle Guided and Operator.`,
                run: () => setPersona(persona === 'newbie' ? 'seasoned' : 'newbie'),
            },
            {
                id: 'action:run-onboarding',
                label: 'Run onboarding again',
                icon: GraduationCap,
                description: 'Replay the first-run tour',
                run: () => {
                    // Clear both the global + per-window flags and route to the
                    // wizard so the tour actually replays for this window.
                    window.localStorage.removeItem('refringence-console-onboarded');
                    clearOnboardedForWindow();
                    navigate('/welcome');
                },
            },
            {
                id: 'action:connect-github',
                label: 'Connect GitHub',
                icon: GitBranch,
                description: 'Link a GitHub account in Services',
                run: () => navigate('/services'),
            },
            {
                id: 'action:connect-vercel',
                label: 'Connect Vercel',
                icon: Triangle,
                description: 'Link a Vercel project in Services',
                run: () => navigate('/services'),
            },
            {
                id: 'action:connect-repo',
                label: 'Connect repo',
                icon: GitBranch,
                description: 'Link the project repository in Services',
                run: () => navigate('/services'),
            },
            {
                id: 'action:run-eval',
                label: 'Run eval',
                icon: PlayCircle,
                description: 'Open Observability to run and inspect evals',
                run: () => navigate('/observability'),
            },
            {
                id: 'action:deploy',
                label: 'Deploy',
                icon: Rocket,
                description: 'Open Release to check readiness and ship',
                run: () => navigate('/release'),
            },
            {
                id: 'action:open-assistant',
                label: 'Open assistant',
                icon: MessageSquarePlus,
                // The assistant is the right-hand chat dock (no longer a nav panel),
                // so the palette toggles the dock instead of navigating.
                description: 'Open or close the AI chat dock',
                run: () => toggleChat(),
            },
            {
                id: 'action:open-prompt',
                label: 'Open prompt library',
                icon: BookText,
                description: 'Browse saved prompts and templates',
                run: () => navigate('/prompts'),
            },
            {
                id: 'action:toggle-rail',
                label: 'Toggle sidebar rail',
                icon: PanelLeft,
                description: 'Collapse the sidebar to an icon rail, or expand it',
                run: () => toggleRail(),
            },
            {
                id: 'action:layout-standard',
                label: 'Layout: Standard',
                icon: LayoutGrid,
                description: 'Full sidebar, no chat dock',
                run: () => setPreset('standard'),
            },
            {
                id: 'action:layout-focus',
                label: 'Layout: Focus',
                icon: LayoutGrid,
                description: 'Icon rail only, no chat dock',
                run: () => setPreset('focus'),
            },
            {
                id: 'action:layout-chat',
                label: 'Layout: Chat',
                icon: LayoutGrid,
                description: 'Icon rail plus the chat dock',
                run: () => setPreset('chat'),
            },
            {
                id: 'action:copy-eval-command',
                label: 'Copy eval command',
                icon: ClipboardCopy,
                description: 'Copy npm run eval:promptfoo to the clipboard',
                run: () => {
                    void navigator.clipboard
                        .writeText('npm run eval:promptfoo')
                        .then(() => toast.success('Copied: npm run eval:promptfoo'))
                        .catch(() => toast.error('Could not copy to clipboard'));
                },
            },
            {
                id: 'action:open-project-folder',
                label: 'Open project folder',
                icon: FolderOpen,
                description: 'Reveal the active project root in your file manager',
                run: () => {
                    const proj = readActiveProject();
                    if (!proj) {
                        toast.error('No active project. Pick one first.');
                        return;
                    }
                    void bridge.openPath(proj.path).then((r) => {
                        if (!r.ok) toast.error(r.error ?? 'Could not open the project folder');
                    });
                },
            },
            {
                id: 'action:open-repo',
                label: 'Open repo on GitHub',
                icon: GitBranch,
                description: 'Open the Console repository in a browser',
                run: () => {
                    window.open('https://github.com/Refringence-AI/console', '_blank');
                },
            },
            {
                id: 'action:keyboard-shortcuts',
                label: 'Keyboard shortcuts',
                icon: Keyboard,
                description: 'Show the g-prefix navigation chords and Ctrl+K',
                run: () => setHelpOpen(true),
            },
        ],
        [navigate, persona, setPersona, toggleRail, setPreset],
    );

    // Index the project's prompts (curated + user) so Cmd-K can jump straight to
    // one. They only surface on a query (excluded from the empty alphabetical
    // view) so the default palette stays short.
    const promptsQ = usePrompts(readActiveProject()?.path ?? null);
    const catalogue = useMemo(
        () => buildCatalogue(actions, promptsQ.data ?? []),
        [actions, promptsQ.data],
    );

    const orderedItems = useMemo(() => {
        const q = debouncedQuery.trim().toLowerCase();
        // Keep prompts out of the empty default view (there can be dozens); they
        // appear once the user types.
        if (!q) return alphabetical(catalogue.filter((it) => it.kind !== 'prompt'));
        // shouldFilter is off on the Command so cmdk does not re-order or
        // hide items. We do both ourselves: substring match on label or
        // description (cheap recall), then re-sort by semantic similarity
        // when the embedder has produced a score map.
        const matched = catalogue.filter((it) => {
            const hay = `${it.label} ${it.description}`.toLowerCase();
            return hay.includes(q);
        });
        if (!semanticOrder) return matched;
        return [...matched].sort((a, b) => {
            const sa = semanticOrder.get(a.id) ?? -Infinity;
            const sb = semanticOrder.get(b.id) ?? -Infinity;
            return sb - sa;
        });
    }, [catalogue, debouncedQuery, semanticOrder]);

    useEffect(() => {
        let cancelled = false;
        if (!debouncedQuery.trim()) {
            setSemanticOrder(null);
            return;
        }
        const items = catalogue.map((it) => ({
            id: it.id,
            text: `${it.label}. ${it.description}`,
        }));
        rankBySemanticSimilarity(debouncedQuery, items).then((scored) => {
            if (cancelled) return;
            const m = new Map<string, number>();
            for (const s of scored) m.set(s.id, s.score);
            setSemanticOrder(m);
        });
        return () => {
            cancelled = true;
        };
    }, [debouncedQuery, catalogue]);

    const panels = orderedItems.filter((i) => i.kind === 'panel');
    const actionRows = orderedItems.filter((i) => i.kind === 'action');
    const docs = orderedItems.filter((i) => i.kind === 'doc');
    const promptRows = orderedItems.filter((i) => i.kind === 'prompt');

    function onSelect(item: PaletteItem) {
        if (item.kind === 'panel') navigate(item.to);
        else if (item.kind === 'doc') navigate(item.to);
        else if (item.kind === 'prompt') { setPendingPrompt(item.promptId); navigate(item.to); }
        else item.run();
        onOpenChange(false);
    }

    return (
        <>
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <Dialog.Content
                    className="fixed left-1/2 top-[18%] z-50 w-[640px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-md"
                    data-testid="command-palette"
                    onOpenAutoFocus={(e) => {
                        e.preventDefault();
                        inputRef.current?.focus();
                    }}
                >
                    <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                    <Dialog.Description className="sr-only">
                        Jump to a panel, run an action, or open a doc.
                    </Dialog.Description>
                    <Command
                        label="Command palette"
                        className="flex flex-col"
                        shouldFilter={false}
                    >
                        <Command.Input
                            ref={inputRef}
                            value={query}
                            onValueChange={setQuery}
                            placeholder="Jump to a panel, run an action, or open a doc..."
                            className="w-full border-b border-border bg-transparent px-4 py-3 text-body outline-none placeholder:text-muted-foreground"
                        />
                        <Command.List className="max-h-[420px] overflow-y-auto p-2">
                            <Command.Empty className="px-3 py-6 text-center text-small text-muted-foreground">
                                No matches.
                            </Command.Empty>

                            {panels.length > 0 && (
                                <Command.Group
                                    heading="Panels"
                                    className="text-label uppercase text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                                >
                                    {panels.map((it) => {
                                        if (it.kind !== 'panel') return null;
                                        const Icon = it.icon;
                                        return (
                                            <Command.Item
                                                key={it.id}
                                                value={`${it.label} ${it.description}`}
                                                onSelect={() => onSelect(it)}
                                                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-body text-foreground data-[selected=true]:bg-secondary"
                                            >
                                                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate">{it.label}</span>
                                                    <span className="truncate text-small text-muted-foreground">
                                                        {it.description}
                                                    </span>
                                                </span>
                                                {hiddenPaths.has(it.to) && (
                                                    <Badge variant="outline" className="ml-auto rounded-sm text-muted-foreground">
                                                        Hidden
                                                    </Badge>
                                                )}
                                                <Badge variant="outline" className={`${hiddenPaths.has(it.to) ? '' : 'ml-auto'} rounded-sm text-muted-foreground`}>
                                                    {it.group}
                                                </Badge>
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                            )}

                            {actionRows.length > 0 && (
                                <Command.Group
                                    heading="Actions"
                                    className="mt-2 text-label uppercase text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                                >
                                    {actionRows.map((it) => {
                                        if (it.kind !== 'action') return null;
                                        const Icon = it.icon;
                                        return (
                                            <Command.Item
                                                key={it.id}
                                                value={`${it.label} ${it.description}`}
                                                onSelect={() => onSelect(it)}
                                                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-body text-foreground data-[selected=true]:bg-secondary"
                                            >
                                                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate">{it.label}</span>
                                                    <span className="truncate text-small text-muted-foreground">
                                                        {it.description}
                                                    </span>
                                                </span>
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                            )}

                            {docs.length > 0 && (
                                <Command.Group
                                    heading="Docs"
                                    className="mt-2 text-label uppercase text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                                >
                                    {docs.map((it) => {
                                        if (it.kind !== 'doc') return null;
                                        return (
                                            <Command.Item
                                                key={it.id}
                                                value={`${it.label} ${it.description}`}
                                                onSelect={() => onSelect(it)}
                                                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-body text-foreground data-[selected=true]:bg-secondary"
                                            >
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate">{it.label}</span>
                                                    <span className="truncate text-small text-muted-foreground">
                                                        {it.description}
                                                    </span>
                                                </span>
                                                <Badge variant="outline" className="ml-auto rounded-sm text-muted-foreground">
                                                    {it.group}
                                                </Badge>
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                            )}

                            {promptRows.length > 0 && (
                                <Command.Group
                                    heading="Prompts"
                                    className="mt-2 text-label uppercase text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                                >
                                    {promptRows.map((it) => {
                                        if (it.kind !== 'prompt') return null;
                                        return (
                                            <Command.Item
                                                key={it.id}
                                                value={`${it.label} ${it.description}`}
                                                onSelect={() => onSelect(it)}
                                                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-body text-foreground data-[selected=true]:bg-secondary"
                                            >
                                                <BookText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate">{it.label}</span>
                                                    <span className="truncate text-small text-muted-foreground">
                                                        {it.description}
                                                    </span>
                                                </span>
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                            )}
                        </Command.List>
                        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-small text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> to close</span>
                            <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd> to select</span>
                        </div>
                    </Command>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>

        <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen}>
            <DialogContent className="sm:max-w-lg" data-testid="shortcuts-help">
                <DialogHeader>
                    <DialogTitle>Keyboard shortcuts</DialogTitle>
                    <DialogDescription>
                        Press <Kbd>g</Kbd> then a letter to jump. Works anywhere
                        except while typing or with the palette open.
                    </DialogDescription>
                </DialogHeader>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2 py-2">
                    <li className="flex items-center justify-between gap-3 text-body">
                        <span className="text-foreground">Command palette</span>
                        <span className="inline-flex items-center gap-1">
                            <Kbd>Ctrl</Kbd>
                            <Kbd>K</Kbd>
                        </span>
                    </li>
                    <li className="flex items-center justify-between gap-3 text-body">
                        <span className="text-foreground">This help</span>
                        <Kbd>?</Kbd>
                    </li>
                    {NAV_CHORDS.map((c) => (
                        <li
                            key={c.key}
                            className="flex items-center justify-between gap-3 text-body"
                        >
                            <span className="truncate text-foreground">{c.label}</span>
                            <span className="inline-flex shrink-0 items-center gap-1">
                                <Kbd>g</Kbd>
                                <Kbd>{c.key}</Kbd>
                            </span>
                        </li>
                    ))}
                </ul>
            </DialogContent>
        </ShortcutsDialog>
        </>
    );
}
