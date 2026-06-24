import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'framer-motion';
import {
    LayoutDashboard,
    ScanSearch,
    KanbanSquare,
    BookOpen,
    BookMarked,
    FileText,
    FolderTree,
    Workflow,
    Activity,
    Gauge,
    Rocket,
    Plug,
    Cable,
    GraduationCap,
    Settings,
    ChevronDown,
    ChevronRight,
    PanelLeftClose,
    PanelLeftOpen,
} from 'lucide-react';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { PERSONA_LABEL } from '../../lib/persona';
import { useSidebarLayout, orderItems } from '../../lib/sidebarLayout';
import { useObsCounters } from '../../lib/queries/observability';
import { useReleaseList, useReleaseSummary } from '../../lib/queries/release';
import { useConsoleLayout } from '../../lib/consoleLayout';
import { bridge } from '../../lib/bridge';
import { SectionLabel, Badge } from '@/components/ui';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Console left sidebar. The IA is persona-aware:
 *
 *   OPERATOR  - the full panel set, grouped PROJECT / WORKSHOP (the dense
 *               cockpit). Technical names. Order + hide come from the saved
 *               sidebar layout.
 *   GUIDED    - a curated, journey-ordered, de-crowded set with plain-
 *               language names so a newcomer is not faced with ~12 panels:
 *               "Your project" -> "Ship it" -> "Help", with the rest behind
 *               a "More" disclosure.
 *
 * The Assistant is NOT a nav panel any more; it opens from the TopBar into
 * the right dock. Everything stays reachable via Cmd-K regardless of mode.
 *
 * The bar collapses to an icon RAIL: labels hide, icons stay, hovering a
 * row shows its label in a tooltip, and the ACTIVE item keeps a 2px accent
 * bar at the rail's left edge. The rail-collapsed bit is owned by
 * consoleLayout (one owner); this component reads it and animates width.
 */

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; description: string; testid?: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

// Canonical full set (Operator). Also the source CommandPalette + the
// Settings SidebarEditor read, so every panel stays reachable + editable.
export const GROUPS: NavGroup[] = [
    {
        id: 'project', label: 'Project',
        items: [
            { to: '/overview',     label: 'Overview',     icon: LayoutDashboard, description: 'At-a-glance dashboard with what is next' },
            { to: '/report',       label: 'Report',       icon: ScanSearch,      description: 'A deep read of the project: stack, services, health', testid: 'nav-report' },
            { to: '/prompts',      label: 'Prompts',      icon: FileText,        description: 'Reusable prompt templates with variables', testid: 'nav-prompts' },
            { to: '/issues',       label: 'Workboard',    icon: KanbanSquare,    description: 'Kanban + table over GitHub Issues' },
            { to: '/repo',         label: 'Repo',         icon: FolderTree,      description: 'Repository structure + per-file stats' },
            { to: '/arch',         label: 'Architecture', icon: Workflow,        description: 'Live dependency graph' },
            { to: '/pipeline',     label: 'Pipeline',     icon: Cable,           description: 'CI/CD stage graph from your workflow files' },
            { to: '/services',     label: 'Services',     icon: Plug,            description: 'Hosting, observability, payment connections' },
            { to: '/library',      label: 'Library',      icon: BookMarked,      description: 'Browse the project repo like a book (md, yml, json, toml)' },
            { to: '/release',      label: 'Release',      icon: Rocket,          description: 'Release readiness + compliance' },
            { to: '/observability',label: 'Observability',icon: Gauge,           description: 'QA runs + artifact log + counters' },
            { to: '/activity',     label: 'Activity',     icon: Activity,        description: 'Chronological feed of events' },
        ],
    },
    {
        id: 'help', label: 'Help',
        items: [
            { to: '/tutorials',    label: 'Walk through',    icon: GraduationCap,   description: 'Step-by-step tours anchored to real UI' },
            { to: '/docs',         label: 'Docs',         icon: BookOpen,        description: "Console's own documentation" },
            { to: '/settings',     label: 'Settings',     icon: Settings,        description: 'Display, AI, project, services' },
        ],
    },
];

// Guided: a curated, journey-ordered set with PLAIN-LANGUAGE names. The
// `more` group is hidden behind a disclosure row so the first sight is
// just the journey. Icons + routes match GROUPS so Cmd-K and the active
// state stay consistent; only the visible labels differ.
const GUIDED_GROUPS: NavGroup[] = [
    {
        id: 'your-project', label: 'Your project',
        items: [
            { to: '/overview',     label: 'Overview',      icon: LayoutDashboard, description: 'Where your project stands and what is next' },
            { to: '/report',       label: 'Project report', icon: ScanSearch,    description: 'What your project is, what it uses, and its health' },
            { to: '/repo',         label: 'Your code',     icon: FolderTree,      description: 'Browse your repository' },
            { to: '/issues',       label: 'What to fix',   icon: KanbanSquare,    description: 'Your tasks and bugs' },
        ],
    },
    {
        id: 'ship-it', label: 'Ship it',
        items: [
            { to: '/services',     label: 'Connect & deploy', icon: Plug,        description: 'Link hosting, errors, and payments' },
            { to: '/release',      label: 'Release',          icon: Rocket,      description: 'Is it ready to ship?' },
            { to: '/observability',label: 'Monitor',          icon: Gauge,       description: 'Watch for errors after you ship' },
        ],
    },
    {
        // Docs + Library sit at the top level in Guided (not behind "More"):
        // the user wants the documentation library reachable from Guided.
        id: 'help', label: 'Help',
        items: [
            { to: '/tutorials',    label: 'Walk through',     icon: GraduationCap,   description: 'Step-by-step tours' },
            { to: '/docs',         label: 'Docs',          icon: BookOpen,        description: "Console's own documentation" },
            { to: '/library',      label: 'Library',       icon: BookMarked,      description: 'Read project files like a book' },
        ],
    },
];

// The rest, revealed by the Guided "More" disclosure. Same routes/icons,
// plain-language where it helps. Docs + Library are promoted to the Help
// group above, so they are intentionally absent here.
const GUIDED_MORE: NavItem[] = [
    { to: '/arch',     label: 'Architecture', icon: Workflow,   description: 'How your code fits together' },
    { to: '/pipeline', label: 'Pipeline',     icon: Cable,      description: 'Your build and deploy steps' },
    { to: '/activity', label: 'Activity',     icon: Activity,   description: 'A feed of recent events' },
    { to: '/prompts',  label: 'Prompts',      icon: FileText,   description: 'Saved prompt templates' },
];

// De-crowd (Operator only): the lower-frequency entries default OFF the
// rail and live in the command palette instead. SOFT default, applied only
// when the user has never customised the layout; never touches LOCKED.
const SOFT_HIDDEN: ReadonlySet<string> = new Set(['/activity', '/library', '/docs', '/tutorials']);

// Canonical nav testid per route, so the test/capture selector (nav-workboard,
// nav-architecture, ...) is STABLE no matter the display label. Guided shows
// plain-language labels ("What to fix") but the testid stays route-canonical.
const NAV_TESTID: Record<string, string> = {
    '/overview': 'overview', '/prompts': 'prompts', '/issues': 'workboard', '/repo': 'repo',
    '/arch': 'architecture', '/pipeline': 'pipeline', '/services': 'services', '/library': 'library',
    '/release': 'release', '/observability': 'observability', '/activity': 'activity',
    '/tutorials': 'tutorials', '/docs': 'docs', '/settings': 'settings',
};

// Proactive nav badges: a small token-styled dot on a nav row when that
// panel needs attention. Each entry is keyed by the item's `to` path.
type NavBadge = { tone: 'danger' | 'warning'; label: string };

const RAIL_WIDTH = 56;
const FULL_WIDTH = 224;

export function Sidebar() {
    const { persona, isNewbie } = usePersonaMode();
    const { layout, explicit, toggleGroup } = useSidebarLayout();
    const { layout: shellLayout, toggleRail } = useConsoleLayout();
    const railCollapsed = shellLayout.railCollapsed;

    // Guided "More" disclosure is local, transient UI state (not persisted):
    // a newcomer expands it occasionally; it resets calm on next launch.
    const [guidedMoreOpen, setGuidedMoreOpen] = useState(false);

    const obs = useObsCounters();
    const releaseList = useReleaseList();
    const latestVersion = releaseList.data?.[0]?.version ?? null;
    const releaseSummary = useReleaseSummary(latestVersion);

    const errors24h = obs.data?.errors_last_24h ?? 0;
    const summary = releaseSummary.data;
    const releaseBlocked = !!summary && (summary.overall_status === 'blocked' || summary.red > 0);

    const badges: Record<string, NavBadge> = {};
    if (errors24h > 0) {
        badges['/observability'] = { tone: 'danger', label: `${errors24h} errors in the last 24 hours` };
    }
    if (releaseBlocked) {
        badges['/release'] = { tone: 'warning', label: `Release ${latestVersion ?? ''} is blocked`.trim() };
    }

    // Fire an OS notification at most once per mount when the 24h error
    // count crosses 0 -> positive within this session. The ref guards
    // against re-firing on subsequent refetches.
    const notifiedErrors = useRef(false);
    useEffect(() => {
        if (errors24h > 0 && !notifiedErrors.current) {
            notifiedErrors.current = true;
            void bridge.notify(
                'Observability: new errors',
                `${errors24h} error${errors24h === 1 ? '' : 's'} in the last 24 hours.`,
            );
        }
    }, [errors24h]);

    const hidden = new Set(layout.hidden);

    // Shared row renderer so Operator groups, Guided groups, and the Guided
    // "More" items all draw identical NavLink / active-bar / tooltip chrome.
    function renderRow({ to, label, icon: Icon, description, testid }: NavItem) {
        const badge = badges[to];
        const panel = to.replace(/^\//, '');
        const row = (
            <NavLink
                to={to}
                title={railCollapsed ? undefined : description}
                data-testid={testid ?? `nav-${NAV_TESTID[to] ?? label.toLowerCase()}`}
                className={({ isActive }) =>
                    `relative flex items-center gap-2.5 rounded-md py-1.5 text-body transition-colors ${
                        railCollapsed ? 'justify-center px-0' : 'px-2.5'
                    } ${
                        isActive
                            ? 'bg-accent-subtle text-accent font-medium'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`
                }
            >
                {({ isActive }) => (
                    <>
                        {/* 2px accent bar marks the active item. In the rail it
                            sits at the rail's left edge; in the full bar at the
                            row's left edge. Direction section 12. */}
                        {isActive && (
                            <span
                                aria-hidden="true"
                                data-testid={`nav-active-bar-${panel}`}
                                className={`absolute top-1 bottom-1 ${
                                    railCollapsed ? '-left-2' : 'left-0'
                                } w-0.5 rounded-full bg-accent`}
                            />
                        )}
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {!railCollapsed && <span>{label}</span>}
                        {badge && (
                            <span
                                role="status"
                                aria-label={badge.label}
                                data-testid={`nav-badge-${panel}`}
                                className={`absolute ${
                                    railCollapsed ? 'right-2 top-1' : 'right-2 top-1.5'
                                } h-1.5 w-1.5 rounded-full ${
                                    badge.tone === 'danger' ? 'bg-danger' : 'bg-warning'
                                }`}
                            />
                        )}
                    </>
                )}
            </NavLink>
        );
        return (
            <li key={to}>
                {railCollapsed ? (
                    <Tooltip>
                        <TooltipTrigger asChild>{row}</TooltipTrigger>
                        <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                ) : (
                    row
                )}
            </li>
        );
    }

    // Operator: saved order + hide + soft-default de-crowd, collapsible
    // groups via the saved layout.
    function renderOperatorGroup(group: NavGroup) {
        const items = orderItems(group.items, layout.order).filter((it) => {
            if (hidden.has(it.to)) return false;
            if (!explicit && SOFT_HIDDEN.has(it.to)) return false;
            return true;
        });
        const collapsed = layout.collapsedGroups.includes(group.id);

        return (
            <section key={group.id} data-testid={`nav-group-${group.id}`}>
                {!railCollapsed && (
                    <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        data-testid={`nav-group-toggle-${group.id}`}
                        aria-expanded={!collapsed}
                        className="flex w-full items-center justify-between rounded-md px-2.5 pb-1 pt-1 text-left hover:text-foreground"
                    >
                        <SectionLabel className="p-0">{group.label}</SectionLabel>
                        <ChevronDown
                            className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                                collapsed ? '-rotate-90' : ''
                            }`}
                        />
                    </button>
                )}
                {/* In the rail, group chevrons are gone so every icon stays
                    reachable; the saved collapse only hides labels in the full bar. */}
                {(railCollapsed || !collapsed) && (
                    <ul className="flex flex-col gap-0.5">{items.map(renderRow)}</ul>
                )}
            </section>
        );
    }

    // Guided: the curated journey set. Groups are not collapsible (the whole
    // point is a short, fixed journey); hidden still applies so a Settings
    // hide stays reversible.
    function renderGuidedGroup(group: NavGroup) {
        const items = group.items.filter((it) => !hidden.has(it.to));
        if (items.length === 0) return null;
        return (
            <section key={group.id} data-testid={`nav-group-${group.id}`}>
                {!railCollapsed && (
                    <div className="px-2.5 pb-1 pt-1">
                        <SectionLabel className="p-0">{group.label}</SectionLabel>
                    </div>
                )}
                <ul className="flex flex-col gap-0.5">{items.map(renderRow)}</ul>
            </section>
        );
    }

    const guidedMoreItems = GUIDED_MORE.filter((it) => !hidden.has(it.to));

    return (
        <motion.nav
            aria-label="Primary"
            data-testid="sidebar"
            data-rail-collapsed={railCollapsed}
            initial={false}
            animate={{ width: railCollapsed ? RAIL_WIDTH : FULL_WIDTH }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-card text-sm"
        >
            {/* No brand mark here: the TopBar carries the single wordmark.
                The reclaimed vertical space goes to the nav, which starts at
                the top with a small inset clear of the frameless drag band. */}
            <div className="mt-1 flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-2 pb-4 pt-3">
                {isNewbie ? (
                    <>
                        {GUIDED_GROUPS.map(renderGuidedGroup)}

                        {/* "More" disclosure: the rest of the panels, plain
                            language, behind one calm row. In the rail the
                            extra icons just render inline so they stay
                            reachable without a label to disclose. */}
                        {guidedMoreItems.length > 0 && (
                            <section data-testid="nav-group-more">
                                {railCollapsed ? (
                                    <ul className="flex flex-col gap-0.5">{guidedMoreItems.map(renderRow)}</ul>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => setGuidedMoreOpen((o) => !o)}
                                            data-testid="nav-more-toggle"
                                            aria-expanded={guidedMoreOpen}
                                            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-body text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                        >
                                            <span>More</span>
                                            <ChevronRight
                                                className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                                    guidedMoreOpen ? 'rotate-90' : ''
                                                }`}
                                            />
                                        </button>
                                        {guidedMoreOpen && (
                                            <ul className="flex flex-col gap-0.5">{guidedMoreItems.map(renderRow)}</ul>
                                        )}
                                    </>
                                )}
                            </section>
                        )}

                        {/* Settings stays reachable in Guided too. */}
                        <section data-testid="nav-group-guided-settings">
                            <ul className="flex flex-col gap-0.5">
                                {renderRow({ to: '/settings', label: 'Settings', icon: Settings, description: 'Display, AI, project, services' })}
                            </ul>
                        </section>
                    </>
                ) : (
                    GROUPS.map(renderOperatorGroup)
                )}
            </div>

            <div
                className={`flex shrink-0 flex-col border-t border-border pb-3 pt-2 ${
                    railCollapsed ? 'items-center gap-2 px-2' : 'gap-2 px-3'
                }`}
            >
                {/* Collapse control. In the full bar it is a clear LABELLED row
                    ("Collapse" + chevron); in the rail it shrinks to the icon
                    + tooltip. data-testid is preserved for both. */}
                {railCollapsed ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={toggleRail}
                                data-testid="sidebar-rail-toggle"
                                aria-label="Expand sidebar"
                                aria-pressed={railCollapsed}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                <PanelLeftOpen className="h-3.5 w-3.5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">Expand sidebar</TooltipContent>
                    </Tooltip>
                ) : (
                    <button
                        type="button"
                        onClick={toggleRail}
                        data-testid="sidebar-rail-toggle"
                        aria-label="Collapse sidebar to a rail"
                        aria-pressed={railCollapsed}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                        <PanelLeftClose className="h-3.5 w-3.5 shrink-0" />
                        <span>Collapse</span>
                    </button>
                )}

                {!railCollapsed && (
                    <div className="flex items-center justify-between gap-2 px-0.5">
                        <Badge
                            variant="outline"
                            data-testid="sidebar-persona-chip"
                            className="rounded-sm text-muted-foreground"
                        >
                            {PERSONA_LABEL[persona ?? 'newbie']}
                        </Badge>
                        <span
                            data-testid="sidebar-version-chip"
                            className="text-label uppercase text-muted-foreground/70"
                        >
                            v0.1
                        </span>
                    </div>
                )}
            </div>
        </motion.nav>
    );
}
