import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * SectionLabel — the one uppercase tracked eyebrow. Replaces every ad-hoc
 * `text-[11px] uppercase tracking-[0.14em] text-muted-foreground` header.
 */
export function SectionLabel({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    return (
        <h2
            data-slot="section-label"
            className={cn('text-label uppercase text-muted-foreground', className)}
            {...props}
        />
    );
}
