import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

// Auto-grow textarea + send-or-stop control: one control that shows Stop
// while the turn is in flight, Send otherwise. Enter sends, Shift+Enter
// inserts a newline.
const MAX_TEXTAREA_HEIGHT = 160;

export function ChatComposer({
    streaming,
    disabled,
    placeholder,
    initialText,
    onSend,
    onStop,
}: {
    streaming: boolean;
    disabled?: boolean;
    placeholder?: string;
    initialText?: string;
    onSend: (text: string) => void;
    onStop: () => void;
}) {
    const [text, setText] = useState(initialText ?? '');
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = '0px';
        el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT) + 'px';
    }, [text]);

    function send() {
        const t = text.trim();
        if (!t || disabled || streaming) return;
        onSend(t);
        setText('');
    }

    return (
        <div className="shrink-0 px-4 pb-4 pt-1" data-testid="ai-composer">
            <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card shadow-sm focus-within:border-ring">
                <textarea
                    ref={ref}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                    rows={1}
                    disabled={disabled}
                    placeholder={placeholder ?? 'Ask anything'}
                    className={cn(
                        'block max-h-40 min-h-[40px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-body leading-relaxed',
                        'text-foreground outline-none placeholder:text-muted-foreground/60',
                    )}
                />
                <div className="flex items-center justify-end px-2 pb-2">
                    {streaming ? (
                        <button
                            type="button"
                            onClick={onStop}
                            title="Stop generating"
                            data-testid="ai-stop"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-danger/15 text-danger transition-colors hover:bg-danger/25"
                        >
                            <Square className="h-2.5 w-2.5" fill="currentColor" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={send}
                            disabled={!text.trim() || disabled}
                            title="Send"
                            data-testid="ai-send"
                            className={cn(
                                'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                                text.trim() && !disabled
                                    ? 'bg-accent text-accent-foreground hover:opacity-90'
                                    : 'bg-secondary text-muted-foreground/50',
                            )}
                        >
                            <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
