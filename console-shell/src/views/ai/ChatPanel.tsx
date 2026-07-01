import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MessageSquare, RotateCcw, Cpu } from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { Button, EmptyState } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useAiModels, useAiKeyStatus, useAiSpend } from '../../lib/queries/ai';
import { useAiChat } from '../../lib/ai/useAiChat';
import { useActiveProject } from '../../lib/activeProject';
import { takeAiPrefill } from '../../lib/ai/prefill';
import { ChatMessages } from './components/ChatMessages';
import { LocalModelGuide } from './components/LocalModelGuide';
import { ChatComposer } from './components/ChatComposer';
import { PermissionStickyCard } from './components/PermissionStickyCard';
import { AskQuestionStickyCard } from './components/AskQuestionStickyCard';

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
    const [planMode, setPlanMode] = useState(false);
    const chat = useAiChat(modelId, { projectRoot: project?.path, planMode });
    const queryClient = useQueryClient();
    const spend = useAiSpend(30);

    // A finished turn appends a usage event; refresh the per-model spend so the
    // header total reflects it.
    useEffect(() => {
        if (!chat.streaming) void queryClient.invalidateQueries({ queryKey: ['ai', 'spend'] });
    }, [chat.streaming, queryClient]);

    // A prompt sent from the library lands once in the composer (read-and-
    // clear). The user reviews it and presses Send, so we never auto-fire.
    const [prefill] = useState<string>(() => takeAiPrefill() ?? '');

    const loading = models.isLoading || keyStatus.isLoading;

    // Context usage for the header bar: the latest turn's input tokens against
    // the selected model's window (amber past 80%, like the Desktop dock).
    const currentModel = (models.data ?? []).find((m) => m.id === modelId);
    const ctxWindow = currentModel?.context;
    const tokenPct = chat.usage && ctxWindow ? Math.min(100, Math.round((chat.usage.contextTokens / ctxWindow) * 100)) : null;

    // The model picker now lives in the composer footer (a unified prompt-box);
    // the header keeps the context bar + New chat, once a conversation exists.
    const controls = hasModels && chat.messages.length > 0 ? (
        <div className="flex items-center gap-2.5">
            {spend.data && spend.data.total.costUsd.total > 0 && (
                <span
                    className="font-mono text-label text-muted-foreground"
                    data-testid="ai-spend"
                    title={`${spend.data.byModel.map((m) => `${m.model}: $${m.costUsd.total.toFixed(4)}`).join('\n')}\n(${spend.data.windowDays}-day assistant spend)`}
                >
                    {spend.data.total.costUsd.total < 1 ? `$${spend.data.total.costUsd.total.toFixed(4)}` : `$${spend.data.total.costUsd.total.toFixed(2)}`}
                </span>
            )}
            {chat.usage && (
                <div
                    className="flex items-center gap-1.5"
                    data-testid="ai-token-bar"
                    title={`${chat.usage.contextTokens.toLocaleString()} context tokens${ctxWindow ? ` of ${Math.round(ctxWindow / 1000)}k` : ''}; ${chat.usage.totalTokens.toLocaleString()} total this session`}
                >
                    {tokenPct !== null && (
                        <div className="h-1 w-14 overflow-hidden rounded-full bg-secondary">
                            <div className={`h-full rounded-full ${tokenPct >= 80 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${tokenPct}%` }} />
                        </div>
                    )}
                    <span className="font-mono text-label text-muted-foreground">
                        {tokenPct !== null ? `${tokenPct}%` : `${Math.round(chat.usage.contextTokens / 1000)}k`}
                    </span>
                </div>
            )}
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
        </div>
    ) : null;

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
                <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
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
                        Add a key in Settings to start a chat, or run a local model with Ollama -
                        Console can recommend and install one for your machine below.
                    </EmptyState>
                    <div className="w-full max-w-md">
                        <LocalModelGuide />
                    </div>
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

                    {chat.pendingQuestion ? (
                        <AskQuestionStickyCard request={chat.pendingQuestion} onRespond={chat.respondQuestion} />
                    ) : chat.pendingPermission ? (
                        <PermissionStickyCard request={chat.pendingPermission} onRespond={chat.respondPermission} />
                    ) : (
                        <ChatComposer
                            streaming={chat.streaming}
                            disabled={!modelId}
                            initialText={prefill}
                            models={models.data ?? []}
                            modelId={modelId}
                            onModelChange={setModelId}
                            onSend={chat.send}
                            onStop={chat.stop}
                            onClear={chat.reset}
                            planMode={planMode}
                            onPlanModeChange={setPlanMode}
                        />
                    )}
                </>
            )}
        </div>
    );
}
