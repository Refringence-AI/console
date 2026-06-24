import type { ReactNode } from 'react';

/**
 * DocSection is a semantic H2 with consistent spacing, used to structure a
 * doc body by Diataxis (onboarding / how-to / reference / explanation). It
 * renders a real <section> with an <h2> so the docs-body prose CSS gives the
 * heading its weight, and the optional kicker labels which Diataxis quadrant
 * the section belongs to without leaning on colour alone.
 *
 * Children render inside the prose flow, so plain <p>/<ul> below the heading
 * pick up the same typography as the rest of the page.
 */
export function DocSection({
    title,
    kicker,
    children,
}: {
    title: string;
    /** A small uppercase label above the heading, e.g. "How-to" or "Reference". */
    kicker?: string;
    children?: ReactNode;
}) {
    return (
        <section className="mt-10 first:mt-0" data-testid="doc-section">
            {kicker && (
                <p className="not-prose mb-1 text-label uppercase tracking-wider text-muted-foreground">
                    {kicker}
                </p>
            )}
            <h2>{title}</h2>
            {children}
        </section>
    );
}
