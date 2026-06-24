import { useEffect, useState } from 'react';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { bridge } from '../../lib/bridge';
import { Card } from '@/components/ui';

/**
 * Newbie-mode Settings.
 *
 * Two choices, plain English: Theme and AI mode. Everything else
 * (key, density, project, services) is hidden behind a 'See more
 * settings' link that flips persona to seasoned.
 */

type Theme = 'light' | 'dark' | 'system';
type AiMode = 'on-device' | 'on-device-optional-cloud' | 'cloud-first';

const THEME_KEY = 'refringence-console-theme';
const AI_MODE_KEY = 'refringence-console-ai-tier';
const LEGACY_ANTHROPIC_KEY = 'refringence-console-anthropic-key';
const MIGRATED_FLAG = 'refringence-console-ai-keys-migrated';

// Same one-shot migration as the seasoned Settings: move any old
// localStorage Anthropic key into the keystore via the bridge, once.
function migrateLegacyAiKey() {
    if (typeof window === 'undefined') return;
    try {
        if (window.localStorage.getItem(MIGRATED_FLAG) === '1') return;
        const legacy = window.localStorage.getItem(LEGACY_ANTHROPIC_KEY);
        const finish = () => {
            try {
                window.localStorage.removeItem(LEGACY_ANTHROPIC_KEY);
                window.localStorage.setItem(MIGRATED_FLAG, '1');
            } catch {
                /* noop */
            }
        };
        if (legacy && legacy.trim()) {
            void bridge.ai.setKey('anthropic', legacy.trim()).then(finish).catch(finish);
        } else {
            finish();
        }
    } catch {
        /* noop */
    }
}

function readTheme(): Theme {
    if (typeof window === 'undefined') return 'system';
    try {
        const v = window.localStorage.getItem(THEME_KEY);
        if (v === 'dark' || v === 'light' || v === 'system') return v;
    } catch { /* noop */ }
    return 'system';
}

function applyTheme(t: Theme) {
    if (typeof document === 'undefined') return;
    const prefersDark =
        t === 'dark' ||
        (t === 'system' &&
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', !!prefersDark);
}

function writeTheme(t: Theme) {
    try {
        window.localStorage.setItem(THEME_KEY, t);
        applyTheme(t);
        window.dispatchEvent(new CustomEvent('console-theme-change', { detail: t }));
    } catch { /* noop */ }
}

function readAiMode(): AiMode {
    if (typeof window === 'undefined') return 'on-device';
    try {
        const v = window.localStorage.getItem(AI_MODE_KEY);
        if (v === 'on-device' || v === 'on-device-optional-cloud' || v === 'cloud-first') return v;
    } catch { /* noop */ }
    return 'on-device';
}

function writeAiMode(m: AiMode) {
    try {
        window.localStorage.setItem(AI_MODE_KEY, m);
    } catch { /* noop */ }
}

const AI_MODES: { id: AiMode; title: string; body: string }[] = [
    {
        id: 'on-device',
        title: 'On-device only',
        body: 'Every AI request runs on your laptop. Nothing leaves the machine.',
    },
    {
        id: 'on-device-optional-cloud',
        title: 'On-device with cloud help',
        body: 'Run locally by default. Ask before sending anything to the cloud.',
    },
    {
        id: 'cloud-first',
        title: 'Cloud first',
        body: 'Use the cloud for every request. Faster, but uses your API key.',
    },
];

const THEMES: { id: Theme; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'Match my system' },
];

export function SettingsNewbie() {
    const { setPersona } = usePersonaMode();
    const [theme, setThemeState] = useState<Theme>(readTheme);
    const [aiMode, setAiModeState] = useState<AiMode>(readAiMode);

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        migrateLegacyAiKey();
    }, []);

    function pickTheme(t: Theme) {
        setThemeState(t);
        writeTheme(t);
    }

    function pickAiMode(m: AiMode) {
        setAiModeState(m);
        writeAiMode(m);
    }

    return (
        <div
            className="flex h-full flex-col overflow-y-auto px-10 py-10"
            data-testid="settings-newbie"
        >
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-10">
                <header className="flex flex-col gap-3">
                    <h1 className="text-display text-foreground">
                        Settings
                    </h1>
                    <p className="text-body leading-relaxed text-muted-foreground">
                        A few choices to make Console feel right.
                    </p>
                </header>

                <Card
                    data-testid="newbie-settings-theme"
                    className="gap-4 p-5"
                >
                    <div className="flex flex-col gap-1">
                        <h2 className="text-section text-foreground">Theme</h2>
                        <p className="text-body leading-relaxed text-muted-foreground">
                            Pick a look. Dark is gentler at night.
                        </p>
                    </div>
                    <div className="relative">
                        <select
                            value={theme}
                            onChange={(e) => pickTheme(e.target.value as Theme)}
                            className="w-full appearance-none rounded-md border border-border bg-background px-4 py-3 text-body text-foreground"
                        >
                            {THEMES.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </Card>

                <Card
                    data-testid="newbie-settings-ai"
                    className="gap-4 p-5"
                >
                    <div className="flex flex-col gap-1">
                        <h2 className="text-section text-foreground">AI mode</h2>
                        <p className="text-body leading-relaxed text-muted-foreground">
                            Where should the AI assistant run? You can change this any time.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3">
                        {AI_MODES.map((m) => {
                            const checked = aiMode === m.id;
                            return (
                                <label
                                    key={m.id}
                                    className={
                                        'flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-5 transition ' +
                                        (checked
                                            ? 'border-accent ring-2 ring-ring/50'
                                            : 'border-border hover:bg-secondary/40')
                                    }
                                >
                                    <input
                                        type="radio"
                                        name="newbie-ai-mode"
                                        value={m.id}
                                        checked={checked}
                                        onChange={() => pickAiMode(m.id)}
                                        className="mt-1 h-4 w-4 accent-[var(--accent)]"
                                    />
                                    <div className="flex flex-col gap-1">
                                        <span className="text-card-title text-foreground">
                                            {m.title}
                                        </span>
                                        <span className="text-body leading-relaxed text-muted-foreground">
                                            {m.body}
                                        </span>
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                </Card>

                <Card
                    data-testid="newbie-settings-about"
                    className="gap-4 p-5"
                >
                    <div className="flex flex-col gap-1">
                        <h2 className="text-section text-foreground">About</h2>
                        <p className="text-body leading-relaxed text-muted-foreground">
                            What you are running.
                        </p>
                    </div>
                    <div className="flex flex-col">
                        <div className="flex items-baseline justify-between border-b border-border/60 py-3">
                            <span className="text-body text-muted-foreground">App</span>
                            <span className="text-body text-foreground">Console</span>
                        </div>
                        <div className="flex items-baseline justify-between py-3">
                            <span className="text-body text-muted-foreground">Version</span>
                            <span className="text-body text-foreground">v0.1</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setPersona('seasoned')}
                        data-testid="newbie-settings-see-more"
                        className="self-start text-body text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                        See full settings
                    </button>
                </Card>
            </div>
        </div>
    );
}
