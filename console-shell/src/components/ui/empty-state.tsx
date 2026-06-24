import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * EmptyState — the standardized "nothing here yet" surface. Pass an icon,
 * a title, body copy, and an optional action (a <Button>).
 */
export function EmptyState({
    icon: Icon, title, children, action, className, ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    icon?: React.ComponentType<{ className?: string }>;
    title: string;
    action?: React.ReactNode;
}) {
    return (
        <div
            data-slot="empty-state"
            className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-10 text-center', className)}
            {...props}
        >
            {Icon && <Icon className="size-8 text-muted-foreground" />}
            <p className="text-section text-foreground">{title}</p>
            {children && <div className="max-w-sm text-body text-muted-foreground">{children}</div>}
            {action && <div className="pt-1">{action}</div>}
        </div>
    );
}
