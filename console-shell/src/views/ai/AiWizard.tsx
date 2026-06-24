import { useEffect, useMemo, useState } from 'react';
import { Check, Cpu, Sparkle } from 'lucide-react';
import { GuidedSteps, type GuidedStep } from '@/components/GuidedSteps';
import { Card, Button, Badge } from '@/components/ui';
import { bridge, type AiProviderId, type PromptEntry } from '../../lib/bridge';
import { useAiModels, useAiKeyStatus, useInvalidateAiKeys } from '../../lib/queries/ai';
import { useOllamaDetect } from '../../lib/queries/ollama';
import { usePrompts } from '../../lib/queries/prompts';
import { useActiveProject } from '../../lib/activeProject';
import { interpolate } from '../../lib/ai/interpolate';
import { useAiChat } from '../../lib/ai/useAiChat';
import { ChatMessages } from './components/ChatMessages';

/**
 * Guided AI wizard: one step at a time. (1) connect a provider, (2) say
 * what you want to do, (3) review the prompt, (4) send and watch it stream.
 * Built on the shared GuidedSteps step bar.
 */

const STEPS: GuidedStep[] = [
    { id: 'connect', label: 'Connect your AI' },
    { id: 'describe', label: 'What to do' },
    { id: 'review', label: 'Review' },
    { id: 'send', label: 'Send' },
];

// Cloud providers the wizard offers a key field for. Ollama is handled
// separately (detect, no key). Other ids stay reachable via Operator mode.
const CLOUD_PROVIDERS: { id: AiProviderId; name: string; placeholder: string }[] = [
    { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
    { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...' },
];

export function AiWizard() {
    const [current, setCurrent] = useState(0);
    const [provider, setProvider] = useState<AiProviderId | null>(null);
    const [task, setTask] = useState('');

    const models = useAiModels();
    const keyStatus = useAiKeyStatus();
    const invalidateKeys = useInvalidateAiKeys();

    // Pick a model that belongs to the chosen provider so the send step uses
    // the right one. Falls back to the first model overall.
    const modelId = useMemo(() => {
        const list = models.data ?? [];
        if (list.length === 0) return '';
        const forProvider = provider ? list.find((m) => m.provider === provider) : undefined;
        return (forProvider ?? list[0]).id;
    }, [models.data, provider]);

    const chat = useAiChat(modelId);

    const connected = !!provider && (keyStatus.data?.[provider] ?? false);

    const nextDisabled =
        (current === 0 && !connected) ||
        (current === 1 && task.trim().length === 0);

    function onComplete() {
        // Last step is Send; the Done button is wired to fire the chat.
        if (!chat.streaming && chat.messages.length === 0) {
            void chat.send(task.trim());
        }
    }

    // When the user steps onto Send, kick off the request once.
    useEffect(() => {
        if (current === 3 && chat.messages.length === 0 && !chat.streaming && task.trim()) {
            void chat.send(task.trim());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current]);

    return (
        <div className="flex h-full flex-col p-6" data-testid="ai-wizard">
            <header className="mb-4 flex flex-col gap-1">
                <h1 className="text-display text-foreground">AI assistant</h1>
                <p className="text-small text-muted-foreground">
                    Four steps to your first answer. You can change any choice later.
                </p>
            </header>

            <div className="min-h-0 flex-1 rounded-lg border border-border bg-card p-4">
                <GuidedSteps
                    steps={STEPS}
                    current={current}
                    onStepChange={setCurrent}
                    nextDisabled={nextDisabled}
                    onComplete={onComplete}
                >
                    {current === 0 && (
                        <ConnectStep
                            provider={provider}
                            connected={connected}
                            keyStatus={keyStatus.data ?? {}}
                            onPick={setProvider}
                            onKeysChanged={() => {
                                invalidateKeys();
                            }}
                        />
                    )}
                    {current === 1 && <DescribeStep task={task} onChange={setTask} />}
                    {current === 2 && <ReviewStep task={task} />}
                    {current === 3 && (
                        <SendStep chat={chat} task={task} />
                    )}
                </GuidedSteps>
            </div>
        </div>
    );
}

/* --------------------------- Step 1: Connect --------------------------- */

function ConnectStep({
    provider,
    connected,
    keyStatus,
    onPick,
    onKeysChanged,
}: {
    provider: AiProviderId | null;
    connected: boolean;
    keyStatus: Record<string, boolean>;
    onPick: (id: AiProviderId) => void;
    onKeysChanged: () => void;
}) {
    const ollama = useOllamaDetect();

    return (
        <div className="flex flex-col gap-4 p-2">
            <div className="flex flex-col gap-1">
                <h2 className="text-body-strong text-foreground">Connect your AI</h2>
                <p className="text-body text-muted-foreground">
                    Pick where the AI runs. A cloud provider needs a key. Ollama runs on
                    your machine with no key.
                </p>
            </div>

            <div className="flex flex-col gap-3">
                {CLOUD_PROVIDERS.map((p) => (
                    <ProviderCard
                        key={p.id}
                        name={p.name}
                        selected={provider === p.id}
                        connected={!!keyStatus[p.id]}
                        onSelect={() => onPick(p.id)}
                    >
                        {provider === p.id && (
                            <KeyField
                                providerId={p.id}
                                placeholder={p.placeholder}
                                connected={!!keyStatus[p.id]}
                                onChanged={onKeysChanged}
                            />
                        )}
                    </ProviderCard>
                ))}

                <ProviderCard
                    name="Ollama (on your machine)"
                    selected={provider === 'ollama'}
                    connected={!!keyStatus['ollama'] || (ollama.data?.running ?? false)}
                    onSelect={() => onPick('ollama')}
                >
                    {provider === 'ollama' && (
                        <div className="flex flex-col gap-2 pt-1">
                            <div className="flex items-center gap-3">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => ollama.refetch()}
                                    disabled={ollama.isFetching}
                                >
                                    {ollama.isFetching ? 'Detecting...' : 'Detect Ollama'}
                                </Button>
                                {ollama.data?.running ? (
                                    <Badge variant="success">
                                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                                        {ollama.data.models?.length ?? 0} local model
                                        {(ollama.data.models?.length ?? 0) === 1 ? '' : 's'}
                                    </Badge>
                                ) : ollama.data ? (
                                    <span className="text-small text-muted-foreground">
                                        Not detected. Install from{' '}
                                        <button
                                            type="button"
                                            className="text-accent underline underline-offset-2"
                                            onClick={() =>
                                                bridge.openExternal('https://ollama.com').catch(() => {
                                                    window.open('https://ollama.com', '_blank', 'noopener');
                                                })
                                            }
                                        >
                                            ollama.com
                                        </button>
                                        .
                                    </span>
                                ) : null}
                            </div>
                            {(ollama.data?.models?.length ?? 0) > 0 && (
                                <ul className="flex flex-wrap gap-1.5">
                                    {ollama.data!.models!.map((m) => (
                                        <li
                                            key={m}
                                            className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-label text-muted-foreground"
                                        >
                                            {m}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </ProviderCard>
            </div>

            {connected && (
                <p className="flex items-center gap-1.5 text-small text-success-text">
                    <Check className="h-3.5 w-3.5" />
                    Connected. Press Next.
                </p>
            )}
        </div>
    );
}

function ProviderCard({
    name,
    selected,
    connected,
    onSelect,
    children,
}: {
    name: string;
    selected: boolean;
    connected: boolean;
    onSelect: () => void;
    children?: React.ReactNode;
}) {
    return (
        <Card className={`gap-2 p-4 ${selected ? 'border-accent ring-2 ring-ring/40' : ''}`}>
            <button
                type="button"
                onClick={onSelect}
                className="flex items-center justify-between gap-2 text-left"
            >
                <span className="flex items-center gap-2 text-card-title text-foreground">
                    <Cpu className="h-4 w-4 text-muted-foreground" />
                    {name}
                </span>
                {connected ? (
                    <Badge variant="success">Connected</Badge>
                ) : (
                    <Badge variant="outline">Not connected</Badge>
                )}
            </button>
            {children}
        </Card>
    );
}

function KeyField({
    providerId,
    placeholder,
    connected,
    onChanged,
}: {
    providerId: AiProviderId;
    placeholder: string;
    connected: boolean;
    onChanged: () => void;
}) {
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save() {
        const key = value.trim();
        if (!key) return;
        setSaving(true);
        setError(null);
        try {
            const res = await bridge.ai.setKey(providerId, key);
            if (!res.ok || res.valid === false) {
                setError(res.error ?? 'That key did not check out.');
            } else {
                setValue('');
                onChanged();
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    }

    async function clear() {
        await bridge.ai.clearKey(providerId);
        onChanged();
    }

    return (
        <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center gap-2">
                <input
                    type="password"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void save();
                    }}
                    placeholder={connected ? 'Replace key' : placeholder}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-small text-foreground"
                />
                <Button type="button" size="sm" onClick={save} disabled={saving || !value.trim()}>
                    {saving ? 'Checking...' : 'Save key'}
                </Button>
                {connected && (
                    <Button type="button" variant="secondary" size="sm" onClick={clear}>
                        Clear
                    </Button>
                )}
            </div>
            {error && <p className="text-small text-danger">{error}</p>}
            <p className="text-label text-muted-foreground">
                The key stays on this machine. It is never shown back to you.
            </p>
        </div>
    );
}

/* --------------------------- Step 2: Describe -------------------------- */

function DescribeStep({ task, onChange }: { task: string; onChange: (v: string) => void }) {
    const { project } = useActiveProject();
    const prompts = usePrompts(project?.path ?? null);
    const templates = prompts.data ?? [];

    // Picking a template drops its body (with each variable's default already
    // filled where present) into the task box, which the user then tweaks.
    function pickTemplate(p: PromptEntry) {
        const defaults: Record<string, string> = {};
        for (const v of p.variables) if (v.default) defaults[v.name] = v.default;
        onChange(interpolate(p.body, defaults));
    }

    return (
        <div className="flex flex-col gap-4 p-2">
            <div className="flex flex-col gap-1">
                <h2 className="text-body-strong text-foreground">What do you want to do?</h2>
                <p className="text-body text-muted-foreground">
                    Say it in plain words, or start from a saved prompt template.
                </p>
            </div>

            {templates.length > 0 && (
                <div className="flex flex-col gap-1.5" data-testid="ai-wizard-templates">
                    <span className="text-small text-muted-foreground">Start from a template</span>
                    <div className="flex flex-wrap gap-1.5">
                        {templates.slice(0, 8).map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => pickTemplate(p)}
                                className="rounded-full border border-border px-2.5 py-0.5 text-label text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                {p.title}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <textarea
                value={task}
                onChange={(e) => onChange(e.target.value)}
                rows={6}
                autoFocus
                placeholder="For example: explain what this repo does, or draft a release note from the latest commits."
                data-testid="ai-wizard-task"
                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-body leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
            />
        </div>
    );
}

/* ---------------------------- Step 3: Review --------------------------- */

function ReviewStep({ task }: { task: string }) {
    return (
        <div className="flex flex-col gap-4 p-2">
            <div className="flex flex-col gap-1">
                <h2 className="text-body-strong text-foreground">Review the prompt</h2>
                <p className="text-body text-muted-foreground">
                    This is exactly what gets sent. Step back to edit it.
                </p>
            </div>
            <Card className="gap-0 p-4">
                <div className="whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">
                    {task.trim() || (
                        <span className="text-muted-foreground">Nothing written yet.</span>
                    )}
                </div>
            </Card>
        </div>
    );
}

/* ----------------------------- Step 4: Send --------------------------- */

function SendStep({
    chat,
    task,
}: {
    chat: ReturnType<typeof useAiChat>;
    task: string;
}) {
    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-2">
            <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-body-strong text-foreground">
                    <Sparkle className="h-4 w-4 text-accent" />
                    The answer
                </h2>
                {chat.streaming ? (
                    <Button type="button" variant="secondary" size="sm" onClick={chat.stop}>
                        Stop
                    </Button>
                ) : (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            chat.reset();
                            void chat.send(task.trim());
                        }}
                    >
                        Ask again
                    </Button>
                )}
            </div>

            {chat.error && (
                <div
                    role="alert"
                    className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-small text-danger"
                >
                    {chat.error}
                </div>
            )}

            <div className="min-h-0 flex-1 rounded-md border border-border bg-background">
                {chat.messages.length === 0 && !chat.streaming ? (
                    <div className="flex h-full items-center justify-center text-small text-muted-foreground">
                        Starting...
                    </div>
                ) : (
                    <ChatMessages messages={chat.messages} streaming={chat.streaming} />
                )}
            </div>
        </div>
    );
}
