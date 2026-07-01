import { useState } from 'react';
import { MessageCircleQuestion, Send } from 'lucide-react';
import type { AiQuestionRequest } from '../../../lib/bridge';

// The composer morphs into this card when the assistant pauses mid-turn to ask a
// clarifying question. The user picks one of the offered options or types a free
// answer; the answer is fed back to the model so it continues grounded instead of
// guessing. Mirrors PermissionStickyCard's shape so the two morphs feel the same.
export function AskQuestionStickyCard({
    request,
    onRespond,
}: {
    request: AiQuestionRequest;
    onRespond: (answer: string) => void;
}) {
    const [text, setText] = useState('');
    const submit = (answer: string) => { if (answer.trim()) onRespond(answer.trim()); };
    const hasOptions = Boolean(request.options && request.options.length > 0);
    return (
        <div className="shrink-0 px-4 pb-4 pt-1" data-testid="ai-question-card">
            <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
                    <MessageCircleQuestion className="h-4 w-4 shrink-0 text-accent" />
                    <span className="shrink-0 text-small font-medium text-foreground">The assistant is asking</span>
                </div>
                <p className="px-3.5 py-2.5 text-small leading-relaxed text-foreground" data-testid="ai-question-text">{request.question}</p>
                {hasOptions && (
                    <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5" data-testid="ai-question-options">
                        {request.options!.map((o) => (
                            <button
                                key={o}
                                type="button"
                                onClick={() => submit(o)}
                                className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-small text-foreground transition-colors hover:border-accent hover:bg-secondary"
                            >
                                {o}
                            </button>
                        ))}
                    </div>
                )}
                <form
                    className="flex items-center gap-2 border-t border-border px-2.5 py-2"
                    onSubmit={(e) => { e.preventDefault(); submit(text); }}
                >
                    <input
                        autoFocus
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={request.placeholder ?? (hasOptions ? 'Or type your own answer…' : 'Type your answer…')}
                        data-testid="ai-question-input"
                        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-small text-foreground outline-none focus:border-accent"
                    />
                    <button
                        type="submit"
                        disabled={!text.trim()}
                        data-testid="ai-question-send"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-small text-accent-foreground transition-colors hover:opacity-90 disabled:opacity-40"
                    >
                        <Send className="h-3.5 w-3.5" /> Send
                    </button>
                </form>
            </div>
        </div>
    );
}
