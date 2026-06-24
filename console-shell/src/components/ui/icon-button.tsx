import * as React from 'react';
import { Button } from './button';

/**
 * IconButton — square icon-only Button (installed shadcn Button under the
 * hood). Defaults to ghost; pass variant="outline" for a resting border.
 */
export function IconButton({
    variant = 'ghost', label, children, ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
    return (
        <Button size="icon" variant={variant} aria-label={label} title={label} {...props}>
            {children}
        </Button>
    );
}
