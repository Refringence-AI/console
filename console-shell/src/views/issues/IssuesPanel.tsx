import {
    AlertTriangle, ExternalLink, Filter, GripVertical, KanbanSquare,
    MessageCircle, X, RefreshCw, Calendar, ArrowRight, MoreVertical,
    ChevronRight,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
    useDroppable, pointerWithin,
    type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
    arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { renderMarkdown } from '@/lib/markdown';
import { bridge, type IssueRow } from '../../lib/bridge';
import {
    useIssuesHealth, useIssuesList, useIssueDetail, useIssueRelabel,
} from '../../lib/queries/issues';
import { PanelHeader } from '../_shell/PanelHeader';
import { GroundError } from './GroundError';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { WorkboardNewbie } from './WorkboardNewbie';
import { SlackBoard, SourceToggle, type WorkboardSource } from './SlackBoard';
import { cleanIssueTitle } from '../../lib/humanize';
import { Button, SectionLabel, Skeleton } from '@/components/ui';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ViewMode = 'kanban' | 'table';
type SeverityKey = 'critical' | 'high' | 'medium' | 'low' | 'phase' | 'other';

/**
 * Workboard panel.
 *
 * Architecture notes:
 *   1. Every column is its own droppable (useDroppable) with its own
 *      SortableContext. Cross-column drag now works: dropping a card
 *      onto a different column re-labels the issue via
 *      console:issues.relabel (gh issue edit --add-label /
 *      --remove-label).
 *   2. All six severity columns ALWAYS render, including empty ones.
 *      Empty columns show an inline "drop a card here to set severity:X"
 *      hint so the board reads as a full state-space, not a list.
 *   3. In-app issue detail Sheet replaces openExternal on card click.
 *      Fetched via console:issues.detail (gh issue view --json
 *      body,comments,...). Markdown rendered with marked.
 *   4. Optimistic UI on cross-column move: the card moves visually
 *      before the IPC resolves; on failure the move is reverted and
 *      sonner toasts the gh stderr.
 */
export function IssuesPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <WorkboardNewbie />;
    return <IssuesPanelSeasoned />;
}

function IssuesPanelSeasoned() {
    const health = useIssuesHealth();
    const [source, setSource] = useState<WorkboardSource>('github');
    const [view, setView] = useState<ViewMode>('kanban');
    const [filter, setFilter] = useState('');
    const [openIssue, setOpenIssue] = useState<number | null>(null);
    const issues = useIssuesList({ state: 'open', limit: 100 });

    const filtered = useMemo(() => {
        if (!issues.data) return [];
        if (!filter.trim()) return issues.data;
        const f = filter.toLowerCase();
        return issues.data.filter(
            (i) =>
                i.title.toLowerCase().includes(f) ||
                String(i.number).includes(f) ||
                i.labels.some((l) => l.name.toLowerCase().includes(f)),
        );
    }, [issues.data, filter]);
    const hasIssues = (issues.data?.length ?? 0) > 0;

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="issues-panel">
            <PanelHeader
                icon={KanbanSquare}
                title="Workboard"
                subtitle={
                    <>
                        {source === 'github' && health.data && (
                            <span className="rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-label" data-testid="issues-repo">
                                {health.data.repo}
                            </span>
                        )}
                        {source === 'github' && issues.data && (
                            <span className="ml-2">
                                {filtered.length} of {issues.data.length} open
                            </span>
                        )}
                        {source === 'slack' && <span>Pulled from Slack</span>}
                    </>
                }
                testid="workboard-panel-header"
            >
                <SourceToggle source={source} setSource={setSource} />
                {source === 'github' && (
                    <>
                        <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 transition-colors focus-within:border-ring">
                            <Filter className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <input
                                type="search"
                                data-testid="issues-filter"
                                placeholder="title, #num, label"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                className="w-28 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 sm:w-44"
                            />
                        </div>
                        <div className="flex overflow-hidden rounded-md border border-border" role="tablist">
                            <ViewToggle id="kanban" current={view} setCurrent={setView}>Kanban</ViewToggle>
                            <ViewToggle id="table"  current={view} setCurrent={setView}>Table</ViewToggle>
                        </div>
                    </>
                )}
            </PanelHeader>

            <GroundError />

            {source === 'slack' && <SlackBoard density="compact" />}

            {source === 'github' && !health.data?.ghAvailable && health.isSuccess && (
                <Banner kind="error">
                    <AlertTriangle className="h-4 w-4" />
                    <span>
                        <strong>gh CLI not available.</strong> Install <code className="font-mono">gh</code> from{' '}
                        <a
                            href="https://cli.github.com"
                            onClick={(e) => { e.preventDefault(); void bridge.openExternal('https://cli.github.com'); }}
                            className="underline"
                        >
                            cli.github.com
                        </a>, then run <code className="font-mono">gh auth login</code>.
                    </span>
                </Banner>
            )}
            {source === 'github' && health.data?.ghAvailable && health.data.authStatus !== 'ok' && (
                <Banner kind="warn">
                    <AlertTriangle className="h-4 w-4" />
                    <span><strong>gh not authenticated.</strong> Run <code className="font-mono">gh auth login</code> to populate the Workboard.</span>
                </Banner>
            )}

            {source === 'github' && issues.isLoading && <KanbanSkeleton />}
            {source === 'github' && issues.isError && <Empty tone="error">Failed to fetch issues via gh: {String(issues.error)}</Empty>}

            {/* PR-first repos have zero issues; render a real empty state, not six
                "drop a card here" columns (which read as a broken board). */}
            {source === 'github' && issues.isSuccess && !hasIssues && (
                <WorkboardEmpty repo={health.data?.repo ?? null} />
            )}

            {source === 'github' && issues.isSuccess && hasIssues && view === 'kanban' && (
                <KanbanView
                    issues={filtered}
                    onOpenIssue={(num) => setOpenIssue(num)}
                />
            )}
            {source === 'github' && issues.isSuccess && hasIssues && view === 'table' && (
                <TableView
                    issues={filtered}
                    onOpenIssue={(num) => setOpenIssue(num)}
                />
            )}

            <IssueDetailSheet
                num={openIssue}
                onOpenChange={(open) => { if (!open) setOpenIssue(null); }}
            />
        </div>
    );
}

function ViewToggle({
    id, current, setCurrent, children,
}: {
    id: ViewMode; current: ViewMode; setCurrent: (v: ViewMode) => void; children: React.ReactNode;
}) {
    const active = current === id;
    return (
        <button
            type="button"
            data-testid={`issues-view-${id}`}
            aria-pressed={active}
            onClick={() => setCurrent(id)}
            className={`px-2.5 py-1 text-label transition-colors ${
                id === 'table' ? 'border-l border-border' : ''
            } ${
                active
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:bg-secondary/50'
            }`}
        >
            {children}
        </button>
    );
}

function Banner({ kind, children }: { kind: 'error' | 'warn'; children: React.ReactNode }) {
    const tones = kind === 'error'
        ? 'bg-danger/[0.08] text-danger-text'
        : 'bg-warning/[0.08] text-warning-text';
    return (
        <div
            className={`flex items-start gap-2 border-b border-border px-4 py-2.5 text-small ${tones}`}
            data-testid={`issues-banner-${kind}`}
        >
            {children}
        </div>
    );
}

// Shown when the repo has zero open issues. A PR-first team has nothing here by
// design, so this names that state and routes to the next useful action rather
// than rendering an empty six-column board that looks broken.
function WorkboardEmpty({ repo }: { repo: string | null }) {
    return (
        <div className="flex flex-1 items-center justify-center p-8" data-testid="workboard-empty">
            <div className="flex max-w-md flex-col items-center gap-3 text-center">
                <KanbanSquare className="h-7 w-7 text-muted-foreground/50" />
                <div className="text-body-strong text-foreground">No open issues</div>
                <p className="text-small leading-relaxed text-muted-foreground">
                    Console maps GitHub issues onto this board. Plenty of teams work PR-first and never
                    file issues, so an empty board here is normal, not a problem.
                </p>
                {repo && (
                    <button
                        type="button"
                        onClick={() => void bridge.openExternal(`https://github.com/${repo}/pulls`)}
                        className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-small text-foreground transition-colors hover:bg-secondary/50"
                    >
                        View pull requests <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}

function Empty({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
    return (
        <div className={`flex flex-1 items-center justify-center px-6 py-12 text-sm ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {children}
        </div>
    );
}

// ── Severity scoring + column metadata ──────────────────────────────────

const SEVERITY_PRIORITY: SeverityKey[] = ['critical', 'high', 'medium', 'low', 'phase', 'other'];

function severity(issue: IssueRow): SeverityKey {
    const names = issue.labels.map((l) => l.name.toLowerCase());
    if (names.includes('severity:critical')) return 'critical';
    if (names.includes('severity:high'))     return 'high';
    if (names.includes('severity:medium'))   return 'medium';
    if (names.includes('severity:low'))      return 'low';
    if (names.some((n) => n.startsWith('phase:'))) return 'phase';
    return 'other';
}

function severityLabel(s: SeverityKey): string | null {
    if (s === 'critical') return 'severity:critical';
    if (s === 'high')     return 'severity:high';
    if (s === 'medium')   return 'severity:medium';
    if (s === 'low')      return 'severity:low';
    return null;
}

function emptyDropCopy(id: SeverityKey): string {
    switch (id) {
        case 'critical': return 'Drop here to mark as Critical';
        case 'high':     return 'Drop here to mark as High';
        case 'medium':   return 'Drop here to mark as Medium';
        case 'low':      return 'Drop here to mark as Low';
        case 'phase':    return 'Drop here for phase trackers';
        default:         return 'Drop here for Other';
    }
}

function isAreaLabel(name: string): boolean {
    return name.toLowerCase().startsWith('area:');
}

// Human-readable column name for toast copy (the SeverityKey is a lowercase id).
function columnLabel(id: SeverityKey): string {
    return COLUMNS.find((c) => c.id === id)?.label ?? id;
}

// A six-step ramp that stays one-glance readable: solid red, solid amber,
// hollow-neutral ring, solid green, then the two non-severity buckets split by
// SHAPE so they don't collide on bg-muted-foreground: Phase is a tiny square,
// Other a solid dot. Each entry carries its own radius because a hard-coded
// `rounded-full` on the render site is not a reliable Tailwind tiebreaker.
const SEVERITY_DOT: Record<SeverityKey, string> = {
    critical: 'rounded-full bg-danger',
    high:     'rounded-full bg-warning',
    medium:   'rounded-full bg-transparent ring-1 ring-inset ring-muted-foreground/70',
    low:      'rounded-full bg-success',
    phase:    'rounded-[2px] bg-muted-foreground/80',
    other:    'rounded-full bg-muted-foreground',
};

// `lean` columns (Phase / Other) are low-traffic, so they collapse to a thinner
// width. That, plus the flexible basis below, lets all six columns pack into
// common content widths before the horizontal scroll-hint has to kick in.
// `short` is the label used in the COLLAPSED compact header, which is too
// narrow for the full name (so "Phase trackers" does not read as a clipped
// "PHAS..."). The expanded/full header still uses `label`.
const COLUMNS: { id: SeverityKey; label: string; short?: string; dot: string; lean?: boolean }[] = [
    { id: 'critical', label: 'Critical',       dot: SEVERITY_DOT.critical },
    { id: 'high',     label: 'High',           dot: SEVERITY_DOT.high },
    { id: 'medium',   label: 'Medium',         dot: SEVERITY_DOT.medium },
    { id: 'low',      label: 'Low',            dot: SEVERITY_DOT.low },
    { id: 'phase',    label: 'Phase trackers', short: 'Phase', dot: SEVERITY_DOT.phase, lean: true },
    { id: 'other',    label: 'Other',          dot: SEVERITY_DOT.other, lean: true },
];

// Severity columns get a fixed ~244px width so two-line card titles don't cut
// mid-word. They do NOT flex-grow: a growing column would distribute slack to
// the right of the row and shove the fixed-width collapsed spines away from the
// Low column, leaving a visible gap. Fixed width packs the row flush-left.
const COLUMN_WIDTH = 'w-[244px] shrink-0';
// A lean column, once expanded (hover or active drag), matches the severity
// width so its cards read the same; collapsed it shrinks to a compact column.
const COLUMN_WIDTH_LEAN = 'w-[240px] shrink-0';
// Collapsed: a compact column (not a rotated rail) wide enough for a small
// horizontal header row of chevron + label + count, sitting flush after Low.
const COLUMN_WIDTH_COLLAPSED = 'w-[140px] shrink-0';

// ── Kanban view with column-level droppables ────────────────────────────

function KanbanView({
    issues, onOpenIssue,
}: {
    issues: IssueRow[];
    onOpenIssue: (num: number) => void;
}) {
    // Local optimistic state: per-column ordered card numbers. Sync when
    // the upstream issues array changes shape (filter changes, refetch).
    const [groups, setGroups] = useState<Record<SeverityKey, number[]>>(() => initialGroups(issues));
    useSyncGroups(issues, groups, setGroups);

    const [activeId, setActiveId] = useState<number | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const relabel = useIssueRelabel();

    const byNumber = useMemo(() => {
        const m = new Map<number, IssueRow>();
        for (const i of issues) m.set(i.number, i);
        return m;
    }, [issues]);

    function findColumn(itemId: number): SeverityKey | null {
        for (const col of SEVERITY_PRIORITY) {
            if (groups[col]?.includes(itemId)) return col;
        }
        return null;
    }

    function onDragStart(e: DragStartEvent) {
        setActiveId(Number(e.active.id));
    }

    function onDragOver(e: DragOverEvent) {
        const { active, over } = e;
        if (!over) return;
        const activeNum = Number(active.id);
        const overId = String(over.id);
        const sourceCol = findColumn(activeNum);
        if (!sourceCol) return;
        // Did we drop onto a column drop zone? Drop zone ids are 'col:<id>'.
        const targetCol: SeverityKey | null = overId.startsWith('col:')
            ? (overId.slice(4) as SeverityKey)
            : findColumn(Number(over.id));
        if (!targetCol || targetCol === sourceCol) return;
        // Move the card to the end of the target column (will be re-sorted
        // on drop end).
        setGroups((prev) => {
            const next = { ...prev };
            next[sourceCol] = prev[sourceCol].filter((n) => n !== activeNum);
            next[targetCol] = [...prev[targetCol].filter((n) => n !== activeNum), activeNum];
            return next;
        });
    }

    function onDragEnd(e: DragEndEvent) {
        setActiveId(null);
        const { active, over } = e;
        if (!over) return;
        const activeNum = Number(active.id);
        const overId = String(over.id);
        const sourceColAtDrop = findColumn(activeNum);
        if (!sourceColAtDrop) return;
        const targetCol: SeverityKey = overId.startsWith('col:')
            ? (overId.slice(4) as SeverityKey)
            : (findColumn(Number(over.id)) ?? sourceColAtDrop);

        if (targetCol === sourceColAtDrop) {
            // Same-column reorder.
            const list = groups[targetCol];
            const overIdx = list.indexOf(Number(over.id));
            const fromIdx = list.indexOf(activeNum);
            if (fromIdx >= 0 && overIdx >= 0 && fromIdx !== overIdx) {
                setGroups((prev) => ({ ...prev, [targetCol]: arrayMove(prev[targetCol], fromIdx, overIdx) }));
            }
            return;
        }

        // Cross-column drop: the card already moved visually via onDragOver;
        // commit the relabel through the same path the menu uses.
        commitRelabel(activeNum, targetCol);
    }

    // Shared relabel path for both drag-drop and the per-card severity menu.
    // The visual move into `targetCol` is assumed to have already happened
    // (drag) or is performed here (menu); on IPC failure we revert.
    function commitRelabel(num: number, targetCol: SeverityKey) {
        const row = byNumber.get(num);
        if (!row) return;
        const originalSeverity = severity(row);
        const original = severityLabel(originalSeverity);
        const target = severityLabel(targetCol);
        const addLabels: string[] = target ? [target] : [];
        const removeLabels: string[] = original && original !== target ? [original] : [];
        if (addLabels.length === 0 && removeLabels.length === 0) {
            // Moving to/from phase/other doesn't change severity:* labels;
            // skip the IPC. The visual move stays, so signal the no-op.
            toast(`Moved #${num}, no severity label changed`);
            return;
        }
        relabel.mutate(
            { number: num, addLabels, removeLabels },
            {
                onSuccess: (res) => {
                    if (res.ok) {
                        toast.success(`Relabeled #${num} to ${columnLabel(targetCol)}`);
                    } else {
                        revertMove(num, originalSeverity);
                        toast.error(`Couldn't relabel #${num}: ${res.error ?? 'unknown error'}`);
                    }
                },
                onError: (err) => {
                    revertMove(num, originalSeverity);
                    toast.error(`Couldn't relabel #${num}: ${String(err)}`);
                },
            },
        );
    }

    // Menu-driven move: re-bucket without dragging. Moves the card into the
    // target column optimistically, then commits the relabel.
    function moveToColumn(num: number, targetCol: SeverityKey) {
        const sourceCol = findColumn(num);
        if (!sourceCol || sourceCol === targetCol) return;
        setGroups((prev) => {
            const next = { ...prev };
            for (const col of SEVERITY_PRIORITY) next[col] = next[col].filter((n) => n !== num);
            next[targetCol] = [...next[targetCol], num];
            return next;
        });
        commitRelabel(num, targetCol);
    }

    function revertMove(num: number, sev: SeverityKey) {
        setGroups((prev) => {
            const next = { ...prev };
            for (const col of SEVERITY_PRIORITY) next[col] = next[col].filter((n) => n !== num);
            next[sev] = [...next[sev], num];
            return next;
        });
    }

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [hasOverflow, setHasOverflow] = useState(false);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const check = () => {
            const overflow = el.scrollWidth - el.clientWidth > 8;
            const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
            setHasOverflow(overflow && !atEnd);
        };
        check();
        el.addEventListener('scroll', check, { passive: true });
        const ro = new ResizeObserver(check);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', check);
            ro.disconnect();
        };
    }, [groups]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
        >
            <div className="relative flex min-h-0 flex-1">
                <div
                    ref={scrollRef}
                    // items-stretch so every column fills the row's full height
                    // (tall full-height drop zones, no void under short columns);
                    // justify-start so fixed-width columns pack flush-left and the
                    // collapsed spines sit tight against Low with no leading gap.
                    className="flex min-h-0 flex-1 snap-x snap-mandatory items-stretch justify-start gap-3 overflow-x-auto p-4 pr-8"
                    style={hasOverflow ? {
                        WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 32px), transparent 100%)',
                        maskImage: 'linear-gradient(to right, black calc(100% - 32px), transparent 100%)',
                    } : undefined}
                    data-testid="issues-kanban"
                >
                    {COLUMNS.map((col) => (
                        <Column key={col.id} column={col} ids={groups[col.id] ?? []} dragActive={activeId != null}>
                            {(groups[col.id] ?? []).map((num) => {
                                const row = byNumber.get(num);
                                if (!row) return null;
                                return (
                                    <SortableIssueCard
                                        key={num}
                                        issue={row}
                                        currentColumn={col.id}
                                        onOpen={() => onOpenIssue(row.number)}
                                        onMoveToColumn={(target) => moveToColumn(row.number, target)}
                                    />
                                );
                            })}
                        </Column>
                    ))}
                </div>
                {hasOverflow && (
                    <div
                        data-testid="issues-kanban-scroll-hint"
                        className="pointer-events-none absolute bottom-4 right-4 inline-flex items-center gap-1 rounded-full border border-border bg-background/90 px-2.5 py-1 text-label text-muted-foreground shadow-sm backdrop-blur"
                    >
                        Drag right
                        <ArrowRight className="h-3 w-3" />
                    </div>
                )}
            </div>

            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
                {activeId != null && byNumber.get(activeId)
                    ? <DragGhost issue={byNumber.get(activeId)!} />
                    : null}
            </DragOverlay>
        </DndContext>
    );
}

function initialGroups(issues: IssueRow[]): Record<SeverityKey, number[]> {
    const g: Record<SeverityKey, number[]> = {
        critical: [], high: [], medium: [], low: [], phase: [], other: [],
    };
    for (const i of issues) g[severity(i)].push(i.number);
    return g;
}

function useSyncGroups(
    issues: IssueRow[],
    groups: Record<SeverityKey, number[]>,
    setGroups: (next: Record<SeverityKey, number[]>) => void,
) {
    useMemo(() => {
        const upstream = new Set(issues.map((i) => i.number));
        const current = new Set<number>();
        for (const col of SEVERITY_PRIORITY) for (const n of groups[col]) current.add(n);
        if (current.size !== upstream.size || ![...upstream].every((n) => current.has(n))) {
            setGroups(initialGroups(issues));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [issues]);
}

function Column({
    column, ids, children, dragActive,
}: {
    column: typeof COLUMNS[number];
    ids: number[];
    children: React.ReactNode;
    dragActive: boolean;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });
    const [hovered, setHovered] = useState(false);
    // Lean (low-traffic) columns collapse to a narrow compact column so the four
    // severity columns breathe. They expand on hover or whenever a drag is active
    // so a card can still be dropped into them.
    const collapsed = column.lean === true && !hovered && !dragActive && !isOver;

    if (collapsed) {
        return (
            <section
                ref={setNodeRef}
                data-testid={`issues-col-${column.id}`}
                onMouseEnter={() => setHovered(true)}
                // A collapsed lean column is still a droppable; the ref above
                // keeps it a valid drop target. It reads as an intentional
                // compact column (horizontal header, full-height body), not a
                // rotated rail: hover or an active drag expands it to full width.
                className={`group/col flex min-h-full snap-start cursor-pointer flex-col rounded-lg border bg-card/40 transition-colors ${COLUMN_WIDTH_COLLAPSED} ${
                    isOver ? 'border-ring bg-card/70' : 'border-border hover:border-ring'
                }`}
                title={`${column.label} (${ids.length}). Hover to expand.`}
            >
                <header className="flex items-center gap-1.5 rounded-t-lg px-2.5 py-2.5">
                    <span className={`h-2 w-2 shrink-0 ${column.dot}`} />
                    <SectionLabel className="min-w-0 flex-1 truncate text-foreground">{column.short ?? column.label}</SectionLabel>
                    <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-mono tabular-nums text-label text-foreground">
                        {ids.length}
                    </span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover/col:text-muted-foreground" />
                </header>
                {/* Spacer keeps the collapsed column a tall drop zone so it
                    aligns with the full-height severity columns beside it. */}
                <div className="min-h-[120px] flex-1" />
            </section>
        );
    }

    return (
        <section
            data-testid={`issues-col-${column.id}`}
            onMouseLeave={() => setHovered(false)}
            // min-h-full so the column is a tall full-height drop zone that fills
            // the row (standard kanban: no void under short columns), with the
            // card list scrolling internally when it outgrows the viewport.
            className={`flex min-h-full snap-start flex-col rounded-lg border bg-card/40 transition-colors ${
                column.lean ? COLUMN_WIDTH_LEAN : COLUMN_WIDTH
            } ${
                isOver ? 'border-ring bg-card/70' : 'border-border'
            }`}
        >
            <header className="flex items-center gap-2 rounded-t-lg px-3 py-2.5">
                <span className={`h-2 w-2 shrink-0 ${column.dot}`} />
                <SectionLabel className="min-w-0 flex-1 truncate text-foreground">{column.label}</SectionLabel>
                <span className="ml-auto shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-mono tabular-nums text-label text-foreground">
                    {ids.length}
                </span>
            </header>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div
                    ref={setNodeRef}
                    // flex-1 so the card list fills the full-height column and the
                    // drop zone extends to the bottom edge, not just under the cards.
                    className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2.5"
                >
                    {children}
                    {ids.length === 0 && (
                        <div className="my-auto select-none rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-small text-muted-foreground/70">
                            {emptyDropCopy(column.id)}
                        </div>
                    )}
                </div>
            </SortableContext>
        </section>
    );
}

// Loading state: render the six-column board shape with greyed cards so the
// kanban silhouette is visible before issues resolve, matching the crafted
// quality of the Guided BucketSkeleton.
function KanbanSkeleton() {
    const counts: Record<SeverityKey, number> = {
        critical: 2, high: 3, medium: 2, low: 2, phase: 3, other: 2,
    };
    return (
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-hidden p-4 pr-8" data-testid="issues-kanban-skeleton">
            {COLUMNS.map((col) => (
                <section
                    key={col.id}
                    className={`flex min-h-full flex-col rounded-lg border border-border bg-card/40 ${
                        col.lean ? COLUMN_WIDTH_LEAN : COLUMN_WIDTH
                    }`}
                >
                    <header className="flex items-center gap-2 rounded-t-lg px-3 py-2.5">
                        <span className={`h-2 w-2 shrink-0 ${col.dot}`} />
                        <SectionLabel className="min-w-0 flex-1 truncate text-foreground">{col.label}</SectionLabel>
                        <Skeleton className="ml-auto h-4 w-6 shrink-0 rounded-md" />
                    </header>
                    <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2.5">
                        {Array.from({ length: counts[col.id] }).map((_, i) => (
                            <div
                                key={i}
                                className="rounded-xl border border-border bg-background px-3 py-2.5 shadow-sm"
                            >
                                <div className="flex items-center gap-1.5">
                                    <Skeleton className="h-3 w-8" />
                                    <Skeleton className="h-3 w-12" />
                                </div>
                                <Skeleton className="mt-2 h-4 w-full" />
                                <Skeleton className="mt-1.5 h-4 w-3/5" />
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

const MOVE_TARGETS: { id: SeverityKey; label: string }[] = [
    { id: 'critical', label: 'Critical' },
    { id: 'high',     label: 'High' },
    { id: 'medium',   label: 'Medium' },
    { id: 'low',      label: 'Low' },
    { id: 'other',    label: 'Other' },
];

function SortableIssueCard({
    issue, currentColumn, onOpen, onMoveToColumn,
}: {
    issue: IssueRow;
    currentColumn: SeverityKey;
    onOpen: () => void;
    onMoveToColumn: (target: SeverityKey) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: issue.number,
    });
    const style = { transform: CSS.Transform.toString(transform), transition };
    return (
        <div
            ref={setNodeRef}
            style={style}
            data-testid={`issue-card-${issue.number}`}
            className={`group relative rounded-xl border border-border bg-background text-left shadow-sm transition-shadow ${
                isDragging ? 'opacity-30' : 'hover:border-ring hover:shadow-md'
            }`}
        >
            <button
                type="button"
                className="cursor-grab touch-none px-1.5 py-2 align-middle text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-muted-foreground active:cursor-grabbing"
                aria-label={`Drag issue #${issue.number}. Use arrow keys to move between columns.`}
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-3 w-3" />
            </button>
            <button
                type="button"
                onClick={onOpen}
                className="absolute inset-0 left-7 right-7 cursor-pointer"
                aria-label={`Open issue #${issue.number}`}
            />
            <div className="pointer-events-none pl-7 pr-7 pt-2 pb-2.5">
                <CardBody issue={issue} />
            </div>
            <div className="absolute right-1 top-1.5 z-10">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            data-testid={`issue-card-menu-${issue.number}`}
                            aria-label={`Move issue #${issue.number} to a different severity`}
                            className="rounded p-1 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                        >
                            <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[9rem]">
                        <DropdownMenuLabel className="text-label uppercase text-muted-foreground">
                            Move to
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {MOVE_TARGETS.map((t) => (
                            <DropdownMenuItem
                                key={t.id}
                                data-testid={`issue-card-move-${issue.number}-${t.id}`}
                                disabled={t.id === currentColumn}
                                onSelect={() => onMoveToColumn(t.id)}
                            >
                                {t.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

function DragGhost({ issue }: { issue: IssueRow }) {
    return (
        <div className="rounded-xl border border-ring bg-popover px-3 py-2.5 shadow-xl ring-1 ring-primary/20">
            <CardBody issue={issue} />
        </div>
    );
}

function CardBody({ issue }: { issue: IssueRow }) {
    const areaLabels = issue.labels.filter((l) => isAreaLabel(l.name));
    return (
        // Title-first hierarchy: the title leads with body-strong weight + full
        // foreground contrast so it anchors the card; #num/author/chips drop to
        // muted small/label so the card no longer reads as one grey text blob.
        <div className="space-y-1">
            <div
                // line-clamp-2 so a long title wraps to two lines and ellipsizes
                // at a word/line boundary instead of cutting one line mid-token.
                className="line-clamp-2 text-body-strong leading-snug text-foreground"
                title={cleanIssueTitle(issue.title)}
            >
                {cleanIssueTitle(issue.title)}
            </div>
            <div className="flex items-center gap-1.5 text-label text-muted-foreground">
                <span className="font-mono tabular-nums">#{issue.number}</span>
                {issue.author && (
                    <>
                        <span className="text-muted-foreground/50">/</span>
                        <span>{issue.author}</span>
                    </>
                )}
                {issue.commentCount > 0 && (
                    <span className="ml-1 inline-flex items-center gap-0.5">
                        <MessageCircle className="h-2.5 w-2.5" />
                        <span className="tabular-nums">{issue.commentCount}</span>
                    </span>
                )}
                <ExternalLink className="ml-auto h-2.5 w-2.5 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            {areaLabels.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                    {areaLabels.slice(0, 4).map((l) => (
                        <span
                            key={l.name}
                            className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-label font-medium leading-none text-muted-foreground"
                            title={l.description ?? l.name}
                        >
                            {l.name.replace(/^area:/i, '')}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Issue detail Sheet ─────────────────────────────────────────────────

function IssueDetailSheet({
    num, onOpenChange,
}: {
    num: number | null;
    onOpenChange: (open: boolean) => void;
}) {
    const detail = useIssueDetail(num);
    const open = num !== null;
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[640px] flex-col border-l border-border bg-popover text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8"
                    data-testid="issue-detail-sheet"
                >
                    <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                        <div className="flex-1 min-w-0">
                            {detail.data && (
                                <>
                                    <div className="flex items-center gap-2 text-small text-muted-foreground">
                                        <span className="font-mono tabular-nums">#{detail.data.number}</span>
                                        <span>opened by {detail.data.author ?? 'unknown'}</span>
                                        <span>{new Date(detail.data.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <Dialog.Title className="mt-1 text-page-title leading-snug">
                                        {cleanIssueTitle(detail.data.title)}
                                    </Dialog.Title>
                                </>
                            )}
                            {!detail.data && detail.isLoading && (
                                <Dialog.Title className="text-body text-muted-foreground">Loading issue...</Dialog.Title>
                            )}
                            {!detail.data && !detail.isLoading && (
                                <Dialog.Title className="text-body text-muted-foreground">Issue not found. It may have been closed or transferred.</Dialog.Title>
                            )}
                        </div>
                        <Dialog.Close
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            aria-label="Close"
                        >
                            <X className="h-4 w-4" />
                        </Dialog.Close>
                    </header>

                    <div className="flex-1 overflow-y-auto px-5 py-4">
                        {detail.isLoading && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                <span>Loading issue...</span>
                            </div>
                        )}
                        {detail.data && (
                            <>
                                {detail.data.labels.length > 0 && (
                                    <div className="mb-4 flex flex-wrap gap-1">
                                        {detail.data.labels.map((l) => (
                                            <span
                                                key={l.name}
                                                className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-label font-medium leading-none text-muted-foreground"
                                                title={l.description ?? l.name}
                                            >
                                                {l.name}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {detail.data.body ? (
                                    <article
                                        data-testid="issue-body"
                                        className="prose-issue text-body leading-relaxed text-foreground"
                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.data.body) }}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground">No description.</p>
                                )}

                                {detail.data.comments.length > 0 && (
                                    <section className="mt-6" data-testid="issue-comments">
                                        <h3 className="mb-2 flex items-center gap-2 text-label uppercase text-muted-foreground">
                                            <MessageCircle className="h-3 w-3" />
                                            {detail.data.comments.length} comment{detail.data.comments.length === 1 ? '' : 's'}
                                        </h3>
                                        <div className="space-y-3">
                                            {detail.data.comments.map((c, idx) => (
                                                <div key={idx} className="rounded-md border border-border bg-card px-3.5 py-3">
                                                    <div className="mb-1.5 flex items-center gap-2 text-small text-muted-foreground">
                                                        <span className="font-medium text-foreground">{c.author}</span>
                                                        <Calendar className="h-2.5 w-2.5" />
                                                        <span>{c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}</span>
                                                    </div>
                                                    <article
                                                        className="prose-issue text-body leading-relaxed text-foreground"
                                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </>
                        )}
                    </div>

                    {detail.data && (
                        <footer className="border-t border-border px-5 py-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { void bridge.openExternal(detail.data!.url); }}
                            >
                                <ExternalLink className="h-3 w-3" />
                                View on GitHub
                            </Button>
                        </footer>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

// ── Flat table fallback ─────────────────────────────────────────────────

function TableView({
    issues, onOpenIssue,
}: {
    issues: IssueRow[];
    onOpenIssue: (num: number) => void;
}) {
    return (
        <div className="min-h-0 flex-1 overflow-auto" data-testid="issues-table">
            <table className="w-full min-w-[720px] text-xs">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                    <tr className="border-b border-border text-label uppercase text-muted-foreground">
                        <th className="px-3 py-2.5 text-left font-medium">#</th>
                        <th className="px-3 py-2.5 text-left font-medium">Title</th>
                        <th className="px-3 py-2.5 text-left font-medium">Labels</th>
                        <th className="px-3 py-2.5 text-left font-medium">Author</th>
                        <th className="px-3 py-2.5 text-right font-medium">Comments</th>
                        <th className="px-3 py-2.5 text-left font-medium">Updated</th>
                    </tr>
                </thead>
                <tbody>
                    {issues.map((iss) => (
                        <tr
                            key={iss.number}
                            data-testid={`issue-row-${iss.number}`}
                            onClick={() => onOpenIssue(iss.number)}
                            className="cursor-pointer border-b border-border transition-colors hover:bg-secondary/50"
                        >
                            <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">{iss.number}</td>
                            <td className="max-w-[420px] truncate px-3 py-2 text-foreground" title={cleanIssueTitle(iss.title)}>{cleanIssueTitle(iss.title)}</td>
                            <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-1">
                                    {iss.labels.slice(0, 4).map((l) => (
                                        <span
                                            key={l.name}
                                            className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-label font-medium leading-none text-muted-foreground"
                                        >
                                            {l.name}
                                        </span>
                                    ))}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{iss.author ?? '-'}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{iss.commentCount}</td>
                            <td className="px-3 py-2 text-muted-foreground">{new Date(iss.updatedAt).toLocaleDateString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
