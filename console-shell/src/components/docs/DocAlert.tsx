import type { ReactNode } from 'react';
import { Info, Lightbulb, TriangleAlert } from 'lucide-react';

type DocAlertKind = 'note' | 'tip' | 'warning';

/**
 * DocAlert is a token-tinted callout for a single aside in a doc body: a
 * neutral note, a tip, or a warning. Each kind maps to a status token (info /
 * success / warning) so the tint stays inside the design system and never
 * reaches for an off-palette colour or an emoji. The icon carries the meaning
 * for readers who do not parse the tint.
 *
 * Marked not-prose so the callout keeps its own compact layout instead of the
 * wide docs-body paragraph spacing.
 */
const KIND_STYLE: Record<DocAlertKind, { wrap: string; icon: typeof Info; iconClass: string; label: string }> = {
    note: {
        wrap: 'border-info/30 bg-info/[0.07]',
        icon: Info,
        iconClass: 'text-info-text',
        label: 'Note',
    },
    tip: {
        wrap: 'border-success/30 bg-success/[0.07]',
        icon: Lightbulb,
        iconClass: 'text-success-text',
        label: 'Tip',
    },
    warning: {
        wrap: 'border-warning/35 bg-warning/[0.07]',
        icon: TriangleAlert,
        iconClass: 'text-warning-text',
        label: 'Heads up',
    },
};

export function DocAlert({
    kind = 'note',
    title,
    children,
}: {
    kind?: DocAlertKind;
    /** Overrides the default kind label, e.g. "Before you start". */
    title?: string;
    children?: ReactNode;
}) {
    const style = KIND_STYLE[kind];
    const Icon = style.icon;
    return (
        <div
            data-testid={`doc-alert-${kind}`}
            className={`not-prose my-6 flex gap-3 rounded-xl border px-4 py-3 ${style.wrap}`}
        >
            <Icon className={`mt-0.5 size-4 shrink-0 ${style.iconClass}`} />
            <div className="min-w-0">
                <p className="text-body-strong text-foreground">{title ?? style.label}</p>
                <div className="mt-0.5 text-small leading-relaxed text-foreground/90">{children}</div>
            </div>
        </div>
    );
}
