import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FileText, FolderOpen, Search, Check, Loader2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderMarkdown } from '@/lib/markdown';
import type { ChatMessage, ChatToolUse } from '../../../lib/ai/useAiChat';

// A compact card for one agentic tool call: which tool, on what, and whether
// it has finished. Shows the user the assistant is reading the real project.
function ToolCard({ tool }: { tool: ChatToolUse }) {
    const Icon = tool.name === 'read_file' ? FileText
        : tool.name === 'list_files' ? FolderOpen
            : tool.name === 'search_code' ? Search
                : Wrench;
    const arg = (() => {
        const input = tool.input as Record<string, unknown> | undefined;
        if (!input || typeof input !== 'object') return '';
        return String(input.path ?? input.dir ?? input.query ?? '');
    })();
    return (
        <div className="ml-4 flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-label text-foreground">{tool.name}</span>
            {arg && <span className="min-w-0 flex-1 truncate font-mono text-label text-muted-foreground">{arg}</span>}
            <span className="ml-auto shrink-0">
                {tool.done
                    ? <Check className="h-3.5 w-3.5 text-success" />
                    : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </span>
        </div>
    );
}

/** Assistant text rendered as markdown to the right of a small bullet
 *  gutter. The bullet uses an accent dot. Markdown is GFM + line breaks,
 *  sanitized before injection. */
function AssistantBubble({ markdown, tools }: { markdown: string; tools?: ChatToolUse[] }) {
    const html = useMemo(() => renderMarkdown(markdown), [markdown]);
    const hasText = markdown.trim().length > 0;
    return (
        <div className="flex flex-col gap-1.5 px-1 py-2">
            {tools && tools.length > 0 && (
                <div className="flex flex-col gap-1">
                    {tools.map((t) => <ToolCard key={t.id} tool={t} />)}
                </div>
            )}
            {hasText && (
                <div className="flex items-start gap-2.5">
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <div
                        data-testid="docs-body"
                        className="ai-message min-w-0 flex-1 text-body leading-relaxed text-foreground"
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                </div>
            )}
        </div>
    );
}

/** User message rendered as a rounded card, right-aligned. */
function UserBubble({ text }: { text: string }) {
    return (
        <div className="flex justify-end px-1 py-1.5">
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl border border-border bg-secondary px-3.5 py-2 text-body leading-relaxed text-foreground">
                {text}
            </div>
        </div>
    );
}

/**
 * Scrolling transcript with stick-to-bottom: auto-scroll while pinned to
 * the bottom, a "scroll to latest" pill when the user has scrolled away,
 * and live append of streaming text.
 */
export function ChatMessages({
    messages,
    streaming,
}: {
    messages: ChatMessage[];
    streaming: boolean;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [atBottom, setAtBottom] = useState(true);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !atBottom) return;
        el.scrollTop = el.scrollHeight;
    }, [messages, streaming, atBottom]);

    function onScroll() {
        const el = scrollRef.current;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        setAtBottom(distance < 64);
    }

    return (
        <div className="relative min-h-0 flex-1">
            <div
                ref={scrollRef}
                onScroll={onScroll}
                data-testid="ai-transcript"
                className="h-full overflow-y-auto px-4 py-3"
            >
                <div className="mx-auto flex max-w-2xl flex-col gap-1">
                    {messages.map((m, i) =>
                        m.role === 'assistant' ? (
                            <AssistantBubble key={i} markdown={m.content} tools={m.tools} />
                        ) : (
                            <UserBubble key={i} text={m.content} />
                        ),
                    )}
                    {streaming &&
                        messages[messages.length - 1]?.role !== 'assistant' && (
                            <div className="flex items-center gap-2.5 px-1 py-2 text-small text-muted-foreground">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                                Thinking
                            </div>
                        )}
                </div>
            </div>
            {!atBottom && (
                <button
                    type="button"
                    onClick={() => setAtBottom(true)}
                    className={cn(
                        'absolute bottom-2 left-1/2 z-10 inline-flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card px-2.5',
                        'text-small text-muted-foreground shadow-sm hover:text-foreground',
                    )}
                >
                    <ChevronDown className="h-3 w-3" />
                    Scroll to latest
                </button>
            )}
        </div>
    );
}
