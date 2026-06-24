// console-shell/src/views/_shell/ConsoleChatDock.tsx
//
// Right-hand AI dock. The Assistant moved out of the left nav (it was a
// full panel) and now lives here, opened from the TopBar Assistant button.
// The dock is a fixed ~360px column flanking the content; it reuses the
// seasoned ChatPanel (model picker + transcript + composer) in `embedded`
// mode so the dock owns the single "Assistant" header + a close button.
// Width animates like the left rail so the content area reflows smoothly.
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquareText, X } from 'lucide-react';
import { ChatPanel } from '../ai/ChatPanel';
import { useConsoleLayout } from '../../lib/consoleLayout';

const DOCK_WIDTH = 360;

export function ConsoleChatDock({ open }: { open: boolean }) {
    const { toggleChat } = useConsoleLayout();

    return (
        <AnimatePresence initial={false}>
            {open && (
                <motion.aside
                    key="console-chat-dock"
                    data-testid="console-chat-dock"
                    aria-label="Assistant"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: DOCK_WIDTH, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="flex shrink-0 flex-col overflow-hidden border-l border-border bg-card"
                >
                    {/* Fixed inner width so the chat does not reflow while the
                        outer width animates open and closed. */}
                    <div className="flex h-full flex-col" style={{ width: DOCK_WIDTH }}>
                        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
                            <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="text-body-strong text-foreground">Assistant</span>
                            <button
                                type="button"
                                onClick={toggleChat}
                                data-testid="console-chat-dock-close"
                                aria-label="Close the assistant dock"
                                className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1">
                            <ChatPanel embedded />
                        </div>
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
}
