import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    closestCenter,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff, Lock, type LucideIcon } from 'lucide-react';
import { GROUPS } from '../_shell/Sidebar';
import {
    useSidebarLayout,
    orderItems,
    LOCKED,
} from '../../lib/sidebarLayout';
import { Button, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui';

type Row = {
    to: string;
    label: string;
    icon: LucideIcon;
    group: string;
};

/**
 * Reversible sidebar editor. Drag to reorder, eye toggle to show/hide.
 * Locked panels (Overview, Release, Pipeline) show a lock instead of an
 * eye. All edits write through useSidebarLayout so the live rail updates
 * immediately.
 */
export function SidebarEditor() {
    const { layout, setHidden, setOrder, reset } = useSidebarLayout();

    const rows: Row[] = GROUPS.flatMap((g) =>
        orderItems(g.items, layout.order).map((it) => ({
            to: it.to,
            label: it.label,
            icon: it.icon,
            group: g.label,
        })),
    );
    const ids = rows.map((r) => r.to);
    const hidden = new Set(layout.hidden);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    function onDragEnd(e: DragEndEvent) {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(active.id as string);
        const to = ids.indexOf(over.id as string);
        if (from === -1 || to === -1) return;
        setOrder(arrayMove(ids, from, to));
    }

    return (
        <div className="flex max-w-2xl flex-col gap-6" data-testid="sidebar-editor">
            <div className="flex flex-col gap-0.5">
                <h2 className="text-page-title text-foreground">Sidebar</h2>
                <p className="text-small text-muted-foreground">
                    Reorder the rail and hide panels you rarely use. Every panel
                    stays reachable from the command palette (Ctrl+K). Overview,
                    Release, and Pipeline are always visible.
                </p>
            </div>

            <TooltipProvider>
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onDragEnd}
                >
                    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                        <ul className="flex flex-col gap-1">
                            {rows.map((row) => (
                                <SidebarEditorRow
                                    key={row.to}
                                    row={row}
                                    isHidden={hidden.has(row.to)}
                                    isLocked={LOCKED.has(row.to)}
                                    onToggle={() => setHidden(row.to, !hidden.has(row.to))}
                                />
                            ))}
                        </ul>
                    </SortableContext>
                </DndContext>
            </TooltipProvider>

            <div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={reset}
                    data-testid="sidebar-editor-reset"
                >
                    Reset to default
                </Button>
            </div>
        </div>
    );
}

function SidebarEditorRow({
    row,
    isHidden,
    isLocked,
    onToggle,
}: {
    row: Row;
    isHidden: boolean;
    isLocked: boolean;
    onToggle: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: row.to });
    const Icon = row.icon;

    return (
        <li
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            data-testid={`sidebar-editor-row-${row.label.toLowerCase()}`}
            className={
                'flex items-center gap-3 rounded-md border border-border bg-card px-2 py-2 ' +
                (isDragging ? 'opacity-70 shadow-md' : '') +
                (isHidden ? ' opacity-60' : '')
            }
        >
            <button
                type="button"
                {...attributes}
                {...listeners}
                aria-label={`Reorder ${row.label}`}
                className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
            >
                <GripVertical className="h-4 w-4" />
            </button>
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
                <span className="truncate text-body text-foreground">{row.label}</span>
                <span className="truncate text-small text-muted-foreground">{row.group}</span>
            </span>

            {isLocked ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span
                            aria-disabled
                            data-testid={`sidebar-editor-lock-${row.label.toLowerCase()}`}
                            className="ml-auto inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/60"
                        >
                            <Lock className="h-4 w-4" />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>Always visible</TooltipContent>
                </Tooltip>
            ) : (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-pressed={!isHidden}
                    aria-label={isHidden ? `Show ${row.label}` : `Hide ${row.label}`}
                    data-testid={`sidebar-editor-toggle-${row.label.toLowerCase()}`}
                    className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                    {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
            )}
        </li>
    );
}

export default SidebarEditor;
