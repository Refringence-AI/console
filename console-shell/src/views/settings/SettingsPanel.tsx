import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
    Settings,
    Monitor,
    Cpu,
    FolderOpen,
    Server,
    Eye,
    EyeOff,
    PanelsTopLeft,
} from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { Button, Card, Badge, SectionLabel } from '@/components/ui';
import { readPersona, writePersona, type Persona } from '../../lib/persona';
import { writeDensity, type Density } from '../../lib/density';
import { bridge, type AiProviderId } from '../../lib/bridge';
import { useOllamaDetect } from '../../lib/queries/ollama';
import { useAiKeyStatus, useInvalidateAiKeys } from '../../lib/queries/ai';
import { useLangsmithStatus, useRunEval, useInvalidateLangsmith } from '../../lib/queries/evals';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { SettingsNewbie } from './SettingsNewbie';
import { SidebarEditor } from './SidebarEditor';
import { StartOverCard } from './StartOverCard';

type SectionId = 'display' | 'ai' | 'sidebar' | 'project' | 'services';

const SECTIONS: { id: SectionId; label: string; icon: typeof Monitor }[] = [
    { id: 'display', label: 'Display', icon: Monitor },
    { id: 'ai', label: 'AI', icon: Cpu },
    { id: 'sidebar', label: 'Sidebar', icon: PanelsTopLeft },
    { id: 'project', label: 'Project', icon: FolderOpen },
    { id: 'services', label: 'Services', icon: Server },
];

export function SettingsPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <SettingsNewbie />;
    return <SettingsSeasoned />;
}

// data-testid="settings-panel" lives on the root below for test targeting.
function SettingsSeasoned() {
    const [active, setActive] = useState<SectionId>('display');

    return (
        <div className="flex h-full flex-col" data-testid="settings-panel">
            <PanelHeader
                icon={Settings}
                title="Settings"
                subtitle="Display, AI, project, services"
            />
            <div className="flex flex-1 min-h-0">
                <nav className="w-40 shrink-0 border-r border-border bg-card/40 p-2 sm:w-48">
                    <ul className="flex flex-col gap-0.5">
                        {SECTIONS.map((s) => {
                            const Icon = s.icon;
                            const isActive = active === s.id;
                            return (
                                <li key={s.id}>
                                    <button
                                        type="button"
                                        onClick={() => setActive(s.id)}
                                        className={
                                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body ' +
                                            (isActive
                                                ? 'bg-accent-subtle text-accent font-medium'
                                                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground')
                                        }
                                    >
                                        <Icon className="h-4 w-4" />
                                        {s.label}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
                <main className="flex-1 overflow-auto p-6">
                    {active === 'display' && <DisplaySection />}
                    {active === 'ai' && <AiSection />}
                    {active === 'sidebar' && <SidebarEditor />}
                    {active === 'project' && <ProjectSection />}
                    {active === 'services' && <ServicesSection />}
                </main>
            </div>
        </div>
    );
}

/* ----------------------------- Display ----------------------------- */

const THEME_KEY = 'refringence-console-theme';

type Theme = 'light' | 'dark' | 'system';

function readTheme(): Theme {
    if (typeof window === 'undefined') return 'system';
    try {
        const v = window.localStorage.getItem(THEME_KEY);
        if (v === 'dark' || v === 'light' || v === 'system') return v;
    } catch {
        /* noop */
    }
    return 'system';
}

function resolveDark(theme: Theme): boolean {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return (
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
    );
}

function writeTheme(theme: Theme): void {
    try {
        window.localStorage.setItem(THEME_KEY, theme);
        document.documentElement.classList.toggle('dark', resolveDark(theme));
        window.dispatchEvent(new CustomEvent('console-theme-change', { detail: theme }));
    } catch {
        /* noop */
    }
}

const PERSONA_KEY_FOR_DENSITY = 'refringence-console-persona';
const DENSITY_KEY_FOR_PERSONA = 'refringence-console-density';

function pickInitialDensity(): Density {
    if (typeof window === 'undefined') return 'compact';
    try {
        const existing = window.localStorage.getItem(DENSITY_KEY_FOR_PERSONA);
        if (existing === 'compact' || existing === 'roomy') return existing;
        const persona = window.localStorage.getItem(PERSONA_KEY_FOR_DENSITY);
        if (persona === 'newbie') return 'roomy';
        return 'compact';
    } catch {
        return 'compact';
    }
}

function DisplaySection() {
    const [theme, setTheme] = useState<Theme>(readTheme);
    const [persona, setPersona] = useState<Persona>(() => readPersona() ?? 'seasoned');
    const [density, setDensity] = useState<Density>(pickInitialDensity);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('dark', resolveDark(theme));
    }, [theme]);

    useEffect(() => {
        if (theme !== 'system' || typeof window === 'undefined') return;
        const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
        if (!mq) return;
        const onChange = () =>
            document.documentElement.classList.toggle('dark', resolveDark('system'));
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [theme]);

    useEffect(() => {
        // Persist the density chosen by persona default on first mount so
        // future reads (and other panels) see a stable value.
        writeDensity(density);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function pickTheme(t: Theme) {
        setTheme(t);
        writeTheme(t);
    }

    function pickPersona(p: Persona) {
        setPersona(p);
        writePersona(p);
    }

    function pickDensity(d: Density) {
        setDensity(d);
        writeDensity(d);
    }

    return (
        <div className="flex max-w-2xl flex-col gap-6">
            <SectionHeading title="Display" description="Theme, persona, and layout density." />

            <Card className="flex flex-col gap-6 p-5">
                <Field label="Theme" hint="System follows your OS. Dark mode is gentler at night.">
                    <SegmentedGroup
                        value={theme}
                        onChange={(v) => pickTheme(v as Theme)}
                        options={[
                            { value: 'light', label: 'Light' },
                            { value: 'dark', label: 'Dark' },
                            { value: 'system', label: 'System' },
                        ]}
                    />
                </Field>

                <Field
                    label="Mode"
                    hint="Guided surfaces explainers and roomier defaults. Operator is a dense status cockpit that hides them."
                >
                    <SegmentedGroup
                        value={persona}
                        onChange={(v) => pickPersona(v as Persona)}
                        options={[
                            { value: 'newbie', label: 'Guided' },
                            { value: 'seasoned', label: 'Operator' },
                        ]}
                    />
                </Field>

                <Field label="Density" hint="Compact packs more on screen. Roomy adds breathing room.">
                    <SegmentedGroup
                        value={density}
                        onChange={(v) => pickDensity(v as Density)}
                        options={[
                            { value: 'compact', label: 'Compact' },
                            { value: 'roomy', label: 'Roomy' },
                        ]}
                    />
                </Field>
            </Card>

            <Card className="flex flex-col gap-3 p-5">
                <SectionLabel>About</SectionLabel>
                <div className="flex flex-col">
                    <div className="flex items-baseline justify-between border-b border-border/60 py-2.5">
                        <span className="text-small text-muted-foreground">App</span>
                        <span className="text-small text-foreground">Console</span>
                    </div>
                    <div className="flex items-baseline justify-between py-2.5">
                        <span className="text-small text-muted-foreground">Version</span>
                        <span className="text-small text-foreground">v0.1</span>
                    </div>
                </div>
            </Card>

            <StartOverCard />
        </div>
    );
}

/* -------------------------------- AI ------------------------------- */

type AiTier = 'on-device' | 'on-device-optional-cloud' | 'cloud-first';

const TIER_KEY = 'refringence-console-ai-tier';
// Legacy localStorage key. Migrated once into the main-process keystore via
// bridge.ai.setKey('anthropic', ...) then removed (see useAiKeyMigration).
const LEGACY_ANTHROPIC_KEY = 'refringence-console-anthropic-key';
const MIGRATED_FLAG = 'refringence-console-ai-keys-migrated';

const TIERS: { id: AiTier; title: string; body: string }[] = [
    {
        id: 'on-device',
        title: 'On-device only',
        body: 'All AI runs locally via Ollama. No data leaves the machine. Default.',
    },
    {
        id: 'on-device-optional-cloud',
        title: 'On-device with optional cloud',
        body: 'Local first. Cloud calls allowed when you opt in per task.',
    },
    {
        id: 'cloud-first',
        title: 'Cloud-first',
        body: 'Use the cloud provider for every request. Requires an API key.',
    },
];

// Cloud providers we surface a key field for in Settings. Boolean status
// comes from bridge.ai.getKeyStatus(); the raw key never crosses back.
const CLOUD_PROVIDERS: { id: AiProviderId; name: string; placeholder: string }[] = [
    { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
    { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...' },
    { id: 'google', name: 'Google', placeholder: 'AIza...' },
];

// One-shot move of the old localStorage Anthropic key into the keystore.
// Guarded by a flag so a returning user only migrates once.
function useAiKeyMigration(onMigrated: () => void) {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        let done = false;
        try {
            if (window.localStorage.getItem(MIGRATED_FLAG) === '1') return;
            const legacy = window.localStorage.getItem(LEGACY_ANTHROPIC_KEY);
            const finish = () => {
                if (done) return;
                done = true;
                try {
                    window.localStorage.removeItem(LEGACY_ANTHROPIC_KEY);
                    window.localStorage.setItem(MIGRATED_FLAG, '1');
                } catch {
                    /* noop */
                }
            };
            if (legacy && legacy.trim()) {
                void bridge.ai
                    .setKey('anthropic', legacy.trim())
                    .then(() => {
                        finish();
                        onMigrated();
                    })
                    .catch(finish);
            } else {
                finish();
            }
        } catch {
            /* noop */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}

function AiSection() {
    const [tier, setTier] = useState<AiTier>(() => {
        if (typeof window === 'undefined') return 'on-device';
        try {
            const v = window.localStorage.getItem(TIER_KEY);
            if (v === 'on-device' || v === 'on-device-optional-cloud' || v === 'cloud-first') return v;
        } catch {
            /* noop */
        }
        return 'on-device';
    });
    const detect = useOllamaDetect();
    const keyStatus = useAiKeyStatus();
    const invalidateKeys = useInvalidateAiKeys();

    useAiKeyMigration(invalidateKeys);

    function pickTier(t: AiTier) {
        setTier(t);
        try {
            window.localStorage.setItem(TIER_KEY, t);
        } catch {
            /* noop */
        }
    }

    function detectOllama() {
        detect.refetch();
    }

    function openOllamaSite() {
        bridge.openExternal('https://ollama.com').catch(() => {
            window.open('https://ollama.com', '_blank', 'noopener');
        });
    }

    return (
        <div className="flex max-w-2xl flex-col gap-6">
            <SectionHeading title="AI" description="Choose where AI runs and supply credentials." />

            <Field label="Tier">
                <div className="flex flex-col gap-2">
                    {TIERS.map((t) => {
                        const checked = tier === t.id;
                        return (
                            <label
                                key={t.id}
                                className={
                                    'flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 transition ' +
                                    (checked
                                        ? 'border-accent ring-2 ring-ring/50'
                                        : 'border-border hover:bg-secondary/40')
                                }
                            >
                                <input
                                    type="radio"
                                    name="ai-tier"
                                    value={t.id}
                                    checked={checked}
                                    onChange={() => pickTier(t.id)}
                                    className="mt-0.5 accent-[var(--accent)]"
                                />
                                <div className="flex flex-col gap-0.5">
                                    <h3 className="text-card-title text-foreground">{t.title}</h3>
                                    <p className="text-small text-muted-foreground">{t.body}</p>
                                </div>
                            </label>
                        );
                    })}
                </div>
            </Field>

            <Field
                label="Provider keys"
                hint="Keys are held by the app, not this browser. Status below is connected or not - the key itself is never shown back."
            >
                <div className="flex flex-col gap-2">
                    {CLOUD_PROVIDERS.map((p) => (
                        <ProviderKeyRow
                            key={p.id}
                            providerId={p.id}
                            name={p.name}
                            placeholder={p.placeholder}
                            connected={keyStatus.data?.[p.id] ?? false}
                            onChanged={invalidateKeys}
                        />
                    ))}
                </div>
            </Field>

            <Field label="Ollama" hint="Local AI runtime for on-device tiers.">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={detectOllama}
                            disabled={detect.isFetching}
                        >
                            {detect.isFetching ? 'Detecting...' : 'Detect Ollama'}
                        </Button>
                        {detect.data ? (
                            detect.data.running ? (
                                <Badge variant="success">
                                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                                    Ollama{detect.data.version ? ` v${detect.data.version}` : ''}, {detect.data.models?.length ?? 0} model{(detect.data.models?.length ?? 0) === 1 ? '' : 's'} installed
                                </Badge>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground">
                                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                                    Ollama not detected on localhost:11434. Install from{' '}
                                    <button
                                        type="button"
                                        onClick={openOllamaSite}
                                        className="text-accent underline underline-offset-2 hover:opacity-90"
                                    >
                                        https://ollama.com
                                    </button>
                                    .
                                </span>
                            )
                        ) : detect.isError ? (
                            <span className="text-small text-muted-foreground">Detection failed.</span>
                        ) : null}
                    </div>
                </div>
            </Field>

            <Field
                label="Eval tools"
                hint="Connect LangSmith to trace + grade your AI runs. A key from smith.langchain.com lets Console run a small dev eval through your OpenAI model and report it to your LangSmith project."
            >
                <EvalToolsRow />
            </Field>
        </div>
    );
}

// LangSmith connection + a one-click eval run. The eval calls the user's OpenAI
// model over a small fixed dataset, traced + scored to their LangSmith account.
function EvalToolsRow() {
    const status = useLangsmithStatus();
    const invalidate = useInvalidateLangsmith();
    const runEval = useRunEval();
    const connected = status.data?.connected ?? false;
    const [value, setValue] = useState('');
    const [show, setShow] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save() {
        const key = value.trim();
        if (!key) return;
        setSaving(true);
        setError(null);
        try {
            const res = await bridge.evals.setLangsmithKey(key);
            if (!res.ok || res.valid === false) setError(res.error ?? 'That key did not check out.');
            else { setValue(''); invalidate(); }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    }

    async function clear() {
        await bridge.evals.clearLangsmithKey();
        setValue('');
        invalidate();
    }

    const result = runEval.data;

    return (
        <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-card-title text-foreground">LangSmith</span>
                {connected ? <Badge variant="success">Connected</Badge> : <Badge variant="outline">Not connected</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <input
                        type={show ? 'text' : 'password'}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
                        placeholder={connected ? 'Replace key' : 'lsv2_...'}
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 pr-8 font-mono text-small"
                    />
                    <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShow((v) => !v)}
                        aria-label={show ? 'Hide input' : 'Show input'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                    >
                        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                </div>
                <Button type="button" size="sm" onClick={save} disabled={saving || !value.trim()}>
                    {saving ? 'Checking...' : connected ? 'Replace' : 'Set'}
                </Button>
                {connected && (
                    <Button type="button" variant="outline" size="sm" onClick={clear}>
                        Clear
                    </Button>
                )}
            </div>
            {error && <p className="mt-1.5 text-small text-danger">{error}</p>}

            {connected && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => runEval.mutate()}
                        disabled={runEval.isPending}
                        data-testid="langsmith-run-eval"
                    >
                        {runEval.isPending ? 'Running eval...' : 'Run eval'}
                    </Button>
                    {result?.ok && (
                        <span className="text-small text-muted-foreground">
                            {result.passed}/{result.total} passed -{' '}
                            <a href="https://smith.langchain.com" className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer">
                                view in LangSmith
                            </a>
                        </span>
                    )}
                    {result && !result.ok && <span className="text-small text-danger">{result.error}</span>}
                </div>
            )}
        </div>
    );
}

// One provider's key row: a masked input + Save/Clear, with a boolean
// connected badge. The input is write-only - we never read the key back.
function ProviderKeyRow({
    providerId,
    name,
    placeholder,
    connected,
    onChanged,
}: {
    providerId: AiProviderId;
    name: string;
    placeholder: string;
    connected: boolean;
    onChanged: () => void;
}) {
    const [value, setValue] = useState('');
    const [show, setShow] = useState(false);
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
        setValue('');
        onChanged();
    }

    return (
        <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-card-title text-foreground">{name}</span>
                {connected ? (
                    <Badge variant="success">Connected</Badge>
                ) : (
                    <Badge variant="outline">Not connected</Badge>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <input
                        type={show ? 'text' : 'password'}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void save();
                        }}
                        placeholder={connected ? 'Replace key' : placeholder}
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 pr-8 font-mono text-small"
                    />
                    <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShow((v) => !v)}
                        aria-label={show ? 'Hide input' : 'Show input'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                    >
                        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                </div>
                <Button type="button" size="sm" onClick={save} disabled={saving || !value.trim()}>
                    {saving ? 'Checking...' : connected ? 'Replace' : 'Set'}
                </Button>
                {connected && (
                    <Button type="button" variant="outline" size="sm" onClick={clear}>
                        Clear
                    </Button>
                )}
            </div>
            {error && <p className="mt-1.5 text-small text-danger">{error}</p>}
        </div>
    );
}

/* ----------------------------- Project ----------------------------- */

function ProjectSection() {
    const { project, setProject, clear } = useActiveProject();
    const [picking, setPicking] = useState(false);

    async function pick() {
        setPicking(true);
        try {
            const result = await bridge.project.pickFolder();
            if (!result.canceled && result.path) {
                setProject(result.path);
            }
        } finally {
            setPicking(false);
        }
    }

    return (
        <div className="flex max-w-2xl flex-col gap-6">
            <SectionHeading title="Project" description="The folder Console treats as active." />

            <Field label="Active project folder">
                <div className="flex flex-wrap items-center gap-2">
                    <code
                        data-testid="settings-project-path"
                        className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-small"
                        title={project?.path || 'No active project'}
                    >
                        {project?.path || 'No active project'}
                    </code>
                    <Button
                        type="button"
                        size="sm"
                        data-testid="settings-project-pick"
                        onClick={pick}
                        disabled={picking}
                    >
                        {picking ? 'Opening...' : project ? 'Change folder' : 'Pick a folder'}
                    </Button>
                    {project && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={clear}
                        >
                            Clear
                        </Button>
                    )}
                </div>
                {project?.pickedAt ? (
                    <p className="mt-2 text-small text-muted-foreground">
                        Picked {new Date(project.pickedAt).toLocaleString()}.
                    </p>
                ) : null}
            </Field>
        </div>
    );
}

/* ----------------------------- Services ---------------------------- */

function ServicesSection() {
    return (
        <div className="flex max-w-2xl flex-col gap-4">
            <SectionHeading
                title="Services"
                description="Background workers and integrations Console talks to."
            />
            <p className="text-small text-muted-foreground">
                Service health, restart controls, and connection details live in the
                dedicated Services panel.
            </p>
            <Button asChild variant="outline" size="sm" className="w-fit">
                <Link to="/services">
                    <Server className="h-4 w-4" />
                    Open Services
                </Link>
            </Button>
        </div>
    );
}

/* ------------------------------ helpers ---------------------------- */

function SectionHeading({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex flex-col gap-0.5">
            <h2 className="text-page-title text-foreground">{title}</h2>
            <p className="text-small text-muted-foreground">{description}</p>
        </div>
    );
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="mt-4 flex flex-col gap-2 first:mt-0">
            <div className="flex flex-col gap-0.5">
                <div className="text-body-strong text-foreground">{label}</div>
                {hint && <div className="text-small text-muted-foreground">{hint}</div>}
            </div>
            {children}
        </div>
    );
}

function SegmentedGroup({
    value,
    onChange,
    options,
}: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        onClick={() => onChange(o.value)}
                        className={
                            'rounded-sm px-3 py-1 text-body transition ' +
                            (active
                                ? 'bg-secondary text-foreground font-medium'
                                : 'text-muted-foreground hover:text-foreground')
                        }
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

export default SettingsPanel;
