import * as React from 'react';
import { cn } from '../../lib/utils';

/** Kbd — a keyboard-hint chip. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
    return (
        <kbd
            data-slot="kbd"
            className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground',
                className,
            )}
            {...props}
        />
    );
}
