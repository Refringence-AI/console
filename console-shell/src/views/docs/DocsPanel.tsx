import { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { cn } from '@/lib/utils';
import { DOC_PAGES, renderDocMarkdown } from './console-docs-content';

/**
 * In-app documentation. A page list on the left, the selected page's rendered
 * markdown on the right. Content is PER-PERSONA: Guided teaches the underlying
 * software-engineering concept (with info callouts) without dumbing it down;
 * Operator is a complete feature / setting reference. No live component
 * projections, no dotted-canvas / live-badge framing (those were ported from
 * Flo and read vibe-coded).
 */
export function DocsPanel() {
    const { isNewbie } = usePersonaMode();
    const [activeKey, setActiveKey] = useState<string>(DOC_PAGES[0].key);
    const active = useMemo(
        () => DOC_PAGES.find((p) => p.key === activeKey) ?? DOC_PAGES[0],
        [activeKey],
    );
    const html = useMemo(
        () => renderDocMarkdown(isNewbie ? active.guided : active.operator),
        [active, isNewbie],
    );

    return (
        <div
            className="flex h-full min-h-0 flex-col"
            data-testid={isNewbie ? 'docs-newbie' : 'docs-panel'}
        >
            <PanelHeader
                icon={BookOpen}
                title="Docs"
                subtitle={isNewbie ? 'Learn Console while you use it' : `Complete reference, ${DOC_PAGES.length} pages`}
                testid="docs-panel-header"
            />
            <div className="flex min-h-0 flex-1">
                <nav
                    className="w-60 shrink-0 overflow-y-auto border-r border-border px-3 py-5"
                    aria-label="Documentation pages"
                    data-testid="docs-nav"
                >
                    {DOC_PAGES.map((p) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => setActiveKey(p.key)}
                            data-testid={`docs-nav-${p.key}`}
                            className={cn(
                                'mb-0.5 block w-full rounded-md px-3 py-2 text-left text-small transition',
                                p.key === active.key
                                    ? 'bg-accent-subtle font-medium text-accent'
                                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                            )}
                        >
                            {p.title}
                        </button>
                    ))}
                </nav>
                <div className="min-w-0 flex-1 overflow-y-auto">
                    <article
                        key={active.key}
                        data-testid="docs-body"
                        className="mx-auto max-w-3xl px-10 py-9"
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                </div>
            </div>
        </div>
    );
}
