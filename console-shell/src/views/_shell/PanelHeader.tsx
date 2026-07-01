import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Shared panel header bar.
 *
 * The TopBar now sits above every panel and reserves the right-side
 * overlay space, so PanelHeader no longer needs its own `pr-44` reserve.
 * Right-aligned children sit flush at the edge of the content area.
 *
 * Use it instead of writing `<header className="px-4 py-3">` directly.
 *
 *   <PanelHeader icon={KanbanSquare} title="Workboard" subtitle="...">
 *     <FilterChips ... />
 *   </PanelHeader>
 *
 * Layout: icon + title + optional subtitle on the left, `children`
 * pushed to the right. Children sit in the safe zone between the title
 * and the overlay.
 */
export function PanelHeader({
    icon: Icon,
    title,
    subtitle,
    children,
    testid,
}: {
    icon: LucideIcon;
    title: string;
    subtitle?: ReactNode;
    children?: ReactNode;
    testid?: string;
}) {
    return (
        <header
            data-testid={testid ?? 'panel-header'}
            className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-6 py-3"
        >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-page-title">{title}</h1>
            {subtitle && (
                <div className="text-small text-muted-foreground">{subtitle}</div>
            )}
            {children && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
        </header>
    );
}
