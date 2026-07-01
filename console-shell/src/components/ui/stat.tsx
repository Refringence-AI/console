import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Stat — the standardized metric readout. Compose:
 *   <Stat><StatLabel icon={Coins}>Cost today</StatLabel>
 *         <StatValue>$0.00</StatValue><StatHint>of $50 cap</StatHint></Stat>
 * StatValue uses text-metric (tabular). Wrap in a <Card> for the tile frame.
 */
export function Stat({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div data-slot="stat" className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function StatLabel({
    icon: Icon, className, children, ...props
}: React.HTMLAttributes<HTMLSpanElement> & { icon?: React.ComponentType<{ className?: string }> }) {
    return (
        <span data-slot="stat-label" className={cn('flex items-center gap-1.5 text-label uppercase text-muted-foreground', className)} {...props}>
            {Icon && <Icon className="size-3.5" />}
            {children}
        </span>
    );
}

export function StatValue({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
    return <span data-slot="stat-value" className={cn('text-metric tabular-nums text-foreground', className)} {...props} />;
}

export function StatHint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
    return <p data-slot="stat-hint" className={cn('text-small text-muted-foreground', className)} {...props} />;
}

export function StatDelta({ up, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { up?: boolean }) {
    return (
        <span
            data-slot="stat-delta"
            className={cn('text-small tabular-nums', up ? 'text-success-text' : 'text-danger-text', className)}
            {...props}
        />
    );
}
