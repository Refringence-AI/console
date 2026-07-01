import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * DeviceFrame - wraps a screenshot (or any children) in a calm browser-window
 * chrome: a 30px top bar with 3 muted dots over a rounded-xl, hairline-bordered
 * bg-popover surface. Used by onboarding/tutorial to present real Console shots.
 *
 * Pass `src` to render an object-contain image (no size cap - the frame fills its
 * container), or pass `children` for arbitrary content.
 */
export function DeviceFrame({
    src,
    alt,
    title,
    children,
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    src?: string;
    alt?: string;
    title?: string;
}) {
    return (
        <div
            data-slot="device-frame"
            className={cn(
                'overflow-hidden rounded-xl border border-border bg-popover',
                className,
            )}
            {...props}
        >
            {/* Window chrome: 30px bar + 3 muted traffic-light dots. */}
            <div className="flex h-[30px] items-center gap-1.5 border-b border-border px-3">
                <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/40" />
                <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/40" />
                <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/40" />
                {title && (
                    <span className="ml-2 truncate text-small text-muted-foreground">{title}</span>
                )}
            </div>
            {src ? (
                <img src={src} alt={alt ?? ''} className="block w-full object-contain" />
            ) : (
                children
            )}
        </div>
    );
}
