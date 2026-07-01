import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModelPicker } from './ModelPicker';
import type { AiModelOption } from '../../../lib/bridge';

// Unified prompt-box: an auto-grow textarea over a footer that carries the
// model picker (left) and the send-or-stop control (right). One control shows
// Stop while a turn is in flight, Send otherwise. Enter sends, Shift+Enter
// inserts a newline. Typing "/" opens the slash-command menu.
const MAX_TEXTAREA_HEIGHT = 160;

// Advisor-role slash commands. `clear` resets the chat; the rest scaffold a
// prompt prefix the user completes (the model reads real files via its tools).
type SlashCommand = { name: string; desc: string; insert?: string; clear?: boolean };
const SLASH_COMMANDS: SlashCommand[] = [
    { name: 'clear', desc: 'Start a new conversation', clear: true },
    { name: 'explain', desc: 'Explain an error or some code', insert: 'Explain this, grounded in the real files:\n' },
    { name: 'review', desc: 'Review a file for bugs and risks', insert: 'Review this file for bugs and risks:\n' },
    { name: 'plan', desc: 'Plan how to make a change', insert: 'Plan how to:\n' },
    { name: 'fix', desc: 'Diagnose and fix an error', insert: 'Diagnose and fix this error:\n' },
    { name: 'test', desc: 'Write tests for code', insert: 'Write tests for:\n' },
];

export function ChatComposer({
    streaming,
    disabled,
    placeholder,
    initialText,
    models,
    modelId,
    onModelChange,
    onSend,
    onStop,
    onClear,
    planMode,
    onPlanModeChange,
}: {
    streaming: boolean;
    disabled?: boolean;
    placeholder?: string;
    initialText?: string;
    models: AiModelOption[];
    modelId: string;
    onModelChange: (id: string) => void;
    onSend: (text: string) => void;
    onStop: () => void;
    onClear?: () => void;
    planMode?: boolean;
    onPlanModeChange?: (enabled: boolean) => void;
}) {
    const [text, setText] = useState(initialText ?? '');
    const [slashIndex, setSlashIndex] = useState(0);
    const [slashClosed, setSlashClosed] = useState(false);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = '0px';
        el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT) + 'px';
    }, [text]);

    const slashActive = /^\/[^\s]*$/.test(text) && !disabled && !streaming;
    const slashMatches = slashActive ? SLASH_COMMANDS.filter((c) => c.name.startsWith(text.slice(1).toLowerCase())) : [];
    const showSlash = slashActive && !slashClosed && slashMatches.length > 0;
    const slashSel = Math.min(slashIndex, slashMatches.length - 1);

    function selectCommand(c: SlashCommand) {
        if (c.clear) { onClear?.(); setText(''); }
        else { setText(c.insert ?? ''); }
        setSlashClosed(true);
        ref.current?.focus();
    }

    function send() {
        const t = text.trim();
        if (!t || disabled || streaming) return;
        onSend(t);
        setText('');
    }

    return (
        <div className="shrink-0 px-4 pb-4 pt-1" data-testid="ai-composer">
            <div className="relative mx-auto max-w-2xl rounded-xl border border-border bg-card shadow-sm focus-within:border-ring">
                {showSlash && (
                    <div
                        data-testid="ai-slash-menu"
                        className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-md"
                    >
                        {slashMatches.map((c, i) => (
                            <button
                                key={c.name}
                                type="button"
                                onMouseEnter={() => setSlashIndex(i)}
                                onClick={() => selectCommand(c)}
                                className={cn(
                                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors',
                                    i === slashSel ? 'bg-secondary' : 'hover:bg-secondary/60',
                                )}
                            >
                                <span className="font-mono text-small text-foreground">/{c.name}</span>
                                <span className="truncate text-label text-muted-foreground">{c.desc}</span>
                            </button>
                        ))}
                    </div>
                )}
                <textarea
                    ref={ref}
                    value={text}
                    onChange={(e) => { setText(e.target.value); setSlashIndex(0); setSlashClosed(false); }}
                    onKeyDown={(e) => {
                        if (showSlash) {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashMatches.length); return; }
                            if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
                            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectCommand(slashMatches[slashSel]); return; }
                            if (e.key === 'Escape') { e.preventDefault(); setSlashClosed(true); return; }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                    rows={1}
                    disabled={disabled}
                    placeholder={placeholder ?? 'Ask anything, or / for commands'}
                    className={cn(
                        'block max-h-40 min-h-[40px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-body leading-relaxed',
                        'text-foreground outline-none placeholder:text-muted-foreground/60',
                    )}
                />
                <div className="flex items-center justify-between gap-2 px-2 pb-2">
                    <ModelPicker subtle models={models} value={modelId} onChange={onModelChange} />
                    {onPlanModeChange && (
                        <button
                            type="button"
                            data-testid="ai-plan-mode-toggle"
                            aria-pressed={!!planMode}
                            title="Plan mode (read-only): the assistant can read and propose but cannot write files or run commands"
                            onClick={() => onPlanModeChange(!planMode)}
                            className={cn(
                                'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-small transition-colors',
                                planMode ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-secondary',
                            )}
                        >
                            <ClipboardList className="h-3.5 w-3.5" /> Plan
                        </button>
                    )}
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
                            aria-label="Send message"
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
