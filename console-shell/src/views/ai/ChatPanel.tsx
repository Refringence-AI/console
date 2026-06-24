import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MessageSquare, RotateCcw, Cpu } from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { Button, EmptyState } from '@/components/ui';
import { useAiModels, useAiKeyStatus } from '../../lib/queries/ai';
import { useAiChat } from '../../lib/ai/useAiChat';
import { useActiveProject } from '../../lib/activeProject';
import { takeAiPrefill } from '../../lib/ai/prefill';
import { ChatMessages } from './components/ChatMessages';
import { ChatComposer } from './components/ChatComposer';
import { ModelPicker } from './components/ModelPicker';

/**
 * Operator AI chat. One conversation in component state (no persistence in
 * P4): a model picker grouped by provider, a transcript, and a composer.
 * When no provider has a key, a calm empty state points at Settings AI.
 *
 * `embedded` drops the full PanelHeader title row (the right-dock supplies
 * its own "Assistant" header + close) and renders just the model picker +
 * New-chat in a slim controls strip, so the dock shows ONE title not two.
 */
export function ChatPanel({ embedded = false }: { embedded?: boolean } = {}) {
    const models = useAiModels();
    const keyStatus = useAiKeyStatus();

    // Gate on AVAILABLE models, not raw key status: a keyed provider whose key
    // cannot reach any catalogued model contributes nothing, and a running
    // Ollama with no key still gives a usable chat.
    const hasModels = (models.data?.length ?? 0) > 0;

    const [modelId, setModelId] = useState('');
    // Default to the first available model once the list arrives, and keep a
    // valid selection if the list changes underneath us.
    useEffect(() => {
        const list = models.data ?? [];
        if (list.length === 0) return;
        if (!modelId || !list.some((m) => m.id === modelId)) {
            setModelId(list[0].id);
        }
    }, [models.data, modelId]);

    // Pass the picked project so the assistant gets read-only tools + context
    // and can ground answers in the real code.
    const { project } = useActiveProject();
    const chat = useAiChat(modelId, { projectRoot: project?.path });

    // A prompt sent from the library lands once in the composer (read-and-
    // clear). The user reviews it and presses Send, so we never auto-fire.
    const [prefill] = useState<string>(() => takeAiPrefill() ?? '');

    const loading = models.isLoading || keyStatus.isLoading;

    const controls = hasModels && (
        <>
            <ModelPicker
                models={models.data ?? []}
                value={modelId}
                onChange={setModelId}
            />
            {chat.messages.length > 0 && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={chat.reset}
                    title="Start a new conversation"
                    data-testid="ai-new-chat"
                    className="gap-1.5"
                >
                    <RotateCcw className="h-3.5 w-3.5" />
                    New chat
                </Button>
            )}
        </>
    );

    return (
        <div className="flex h-full flex-col" data-testid="ai-panel">
            {embedded ? (
                controls && (
                    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-card px-4">
                        {controls}
                    </div>
                )
            ) : (
                <PanelHeader icon={MessageSquare} title="Assistant" subtitle="Chat with your AI provider">
                    {controls}
                </PanelHeader>
            )}

            {loading ? (
                <div className="flex flex-1 items-center justify-center text-small text-muted-foreground">
                    Loading models...
                </div>
            ) : !hasModels ? (
                <div className="flex flex-1 items-center justify-center p-8">
                    <EmptyState
                        icon={Cpu}
                        title="Connect an AI provider"
                        action={
                            <Button asChild size="sm">
                                <Link to="/settings" data-testid="ai-empty-settings-link">
                                    Open Settings
                                </Link>
                            </Button>
                        }
                    >
                        No provider is connected yet. Add a key in Settings to start a chat,
                        or run a local model with Ollama.
                    </EmptyState>
                </div>
            ) : (
                <>
                    {chat.messages.length === 0 ? (
                        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                            <div className="text-section text-foreground">Ask anything</div>
                            <p className="mt-1 max-w-sm text-body text-muted-foreground">
                                Describe what you want to do. The reply streams in below.
                            </p>
                        </div>
                    ) : (
                        <ChatMessages messages={chat.messages} streaming={chat.streaming} />
                    )}

                    {chat.error && (
                        <div className="mx-auto w-full max-w-2xl px-4">
                            <div
                                role="alert"
                                className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-small text-danger"
                            >
                                {chat.error}
                            </div>
                        </div>
                    )}

                    <ChatComposer
                        streaming={chat.streaming}
                        disabled={!modelId}
                        initialText={prefill}
                        onSend={chat.send}
                        onStop={chat.stop}
                    />
                </>
            )}
        </div>
    );
}
