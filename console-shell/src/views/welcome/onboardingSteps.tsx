import { useEffect, useState } from 'react';
import {
    CheckCircle2, Loader2, Circle, GitBranch, Plug, ScanText, AlignLeft,
    Boxes, KeyRound, Cpu, Cloud, ArrowRight, Mail, FolderCheck,
    Rocket, Lock, Download, Info,
} from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ExpandableTabs } from '@/components/ui/expandable-tabs';
import { cn } from '@/lib/utils';
import { DotPattern } from '@/components/DotPattern';
import { bridge, type AiProviderId, type ProjectProfile } from '../../lib/bridge';
import { useAiKeyStatus, useInvalidateAiKeys } from '../../lib/queries/ai';
import { useOllamaDetect } from '../../lib/queries/ollama';
import { useConnections } from '../../lib/queries/connections';
import { useMount } from '../../lib/onboarding/useMount';
import { INTENTS, type Intent, type AiMode } from '../../lib/onboarding/machine';
import { DEV_TOOLS, type DevTool } from '../../lib/devTools';
import reportDark from '../../assets/tour/report-dark.png';
import reportLight from '../../assets/tour/report-light.png';
import servicesDark from '../../assets/tour/services-dark.png';
import servicesLight from '../../assets/tour/services-light.png';
import repoDark from '../../assets/tour/repo-dark.png';
import repoLight from '../../assets/tour/repo-light.png';
import overviewDark from '../../assets/tour/overview-dark.png';
import overviewLight from '../../assets/tour/overview-light.png';

/* ------------------------------ shared bits -------------------------------- */

// data-onb-step-header lets the wizard hide the in-step header in the split
// layout, where the title + subtitle are shown on the left teaching panel.
export function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <div className="flex flex-col gap-1.5 text-center" data-onb-step-header>
            <h2 className="text-page-title text-foreground">{title}</h2>
            {subtitle && <p className="mx-auto max-w-md text-body leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
    );
}

// Single source for the per-stage title + subtitle, so the left teaching panel
// and the (now hidden) in-step header never drift. Persona-aware where the step
// copy differs between Guided and Operator.
export function stageCopy(stage: string, guided: boolean): { title: string; subtitle: string } {
    switch (stage) {
        case 'signin': return { title: 'Sign in to Console', subtitle: 'Optional. Signing in lets Console sync your setup across machines and answer questions about your repo.' };
        case 'tools': return guided
            ? { title: 'Which tools do you build with?', subtitle: 'Pick the AI coding tools you use. Console tailors its handoff to the tool you actually use. Skip if none apply.' }
            : { title: 'Your AI tools', subtitle: 'Pick the agents you use. Sets the handoff target (.cursor/rules, AGENTS.md, .claude).' };
        case 'ai': return guided
            ? { title: 'How should Console use AI?', subtitle: 'Console reads your project deeply and answers questions about it. Pick how it runs; change it later in Settings.' }
            : { title: 'AI provider', subtitle: 'Bring your own key or run a local model. Change it later in Settings.' };
        case 'connect': return guided
            ? { title: 'Point Console at your project', subtitle: 'Pick a local folder. Console reads it on the next step to learn what is there. Everything stays on your machine.' }
            : { title: 'Project root', subtitle: 'Pick the project root. Read locally, nothing uploaded.' };
        case 'permission': return guided
            ? { title: 'May Console read your .env?', subtitle: 'Console reads only the key NAMES (like STRIPE_SECRET_KEY), never the values, and nothing leaves your machine.' }
            : { title: 'Read .env key names?', subtitle: 'Detects services from .env key NAMES only. Values are never read or sent.' };
        case 'study': return { title: 'Studying your project', subtitle: 'Console is reading the files to learn what this project is, how it runs, and what it connects to.' };
        case 'report': return guided
            ? { title: 'Here is what Console learned', subtitle: 'A deep read of your project, all from its own files. This is your home base going forward.' }
            : { title: 'What Console learned', subtitle: 'Read entirely from the project files. The Overview keeps this live.' };
        case 'intent': return { title: 'What do you want to do?', subtitle: 'Pick a goal or two so Console can point you at the right next step.' };
        case 'services': return { title: 'Connect your services', subtitle: 'GitHub, Vercel, Sentry and more, detected from your project and managed in one place.' };
        default: return { title: 'Set up Console', subtitle: 'A few quick steps. Nothing leaves your machine.' };
    }
}

// A teaching aside shown only in Guided mode. It names the concept behind the
// step so a first-timer learns the engineering idea WHILE doing it - never to
// dumb it down, always to explain the "why". Operator never sees these.
function InfoCallout({ term, children }: { term?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-2.5 rounded-lg border border-accent/20 bg-accent-subtle/40 px-3 py-2.5" data-testid="onb-callout">
            <Info className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <p className="text-small leading-relaxed text-muted-foreground">
                {term && <span className="font-medium text-foreground">{term} </span>}
                {children}
            </p>
        </div>
    );
}

// The Vercel "Starter / Pro Plan" selectable card: a radio dot + icon + title +
// one-line description. Used for the AI mode picks.
function OptionCard({ selected, onClick, disabled, icon: Icon, title, desc, trailing }: {
    selected: boolean; onClick: () => void; disabled?: boolean;
    icon: React.ComponentType<{ className?: string }>; title: string; desc: string; trailing?: React.ReactNode;
}) {
    return (
        <button
            type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
            className={cn(
                'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition',
                selected ? 'border-foreground/30 bg-secondary/50 ring-1 ring-foreground/15'
                    : 'border-border bg-card hover:bg-secondary/40',
                disabled && 'cursor-not-allowed opacity-55 hover:bg-card',
            )}
        >
            <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                selected ? 'border-foreground' : 'border-muted-foreground/40')}>
                {selected && <span className="size-2 rounded-full bg-foreground" />}
            </span>
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-card-title text-foreground">{title}{trailing}</span>
                <span className="text-small text-muted-foreground">{desc}</span>
            </span>
        </button>
    );
}

function SuccessRow({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-small text-success-text">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            {children}
        </div>
    );
}

function OrDivider({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-label uppercase tracking-wide text-muted-foreground">{label}</span>
            <span className="h-px flex-1 bg-border" />
        </div>
    );
}

/* ---------------------------------- Tour ----------------------------------- */

const TOUR_SLIDES = [
    { tab: 'Read', icon: ScanText, title: 'Console reads your project', body: 'Point it at a repo and it maps the stack, structure, health, and services from the files alone. No AI required.', dark: reportDark, light: reportLight },
    { tab: 'Connect', icon: Plug, title: 'Connect services, then ship', body: 'GitHub, Vercel, Sentry, PostHog and more, detected from your project and controlled in one place. Connect Vercel and deploy the project straight from Console, no config needed, no browser tabs.', dark: servicesDark, light: servicesLight },
    { tab: 'Check', icon: Lock, title: 'Catch what is not ready', body: 'Vulnerable dependencies, exposed secrets, a missing CI or license, all flagged with a one-click fix prompt for your dev tool.', dark: repoDark, light: repoLight },
    { tab: 'Ship', icon: Rocket, title: 'Ship it, then watch it', body: 'Release gates, build status, test runs, and AI cost in one glance, so you always know what is left before you ship.', dark: overviewDark, light: overviewLight },
];

// Feature carousel. LEFT = the matching screenshot floating over a subtle ASCII
// field on a dark mat (the SHOW half); RIGHT = serif title + body + nav on the
// light surface (the TELL half). The right half is a fixed 3-row grid
// (header / stage / footer) with the copy ABSOLUTELY stacked, so the title,
// dots, and buttons never move when the slide changes - only opacity cross-fades.
export function TourStep({ onDone }: { onDone: () => void }) {
    const [i, setI] = useState(0);
    const count = TOUR_SLIDES.length;
    const last = i === count - 1;
    return (
        <div className="grid h-full w-full md:grid-cols-[minmax(0,1.22fr)_minmax(0,1fr)]" data-testid="onb-tour">
            {/* LEFT = DARK + ASCII + SCREENSHOT. Fixed 16:10 frame so every shot
                presents at the same size; dark screenshots blend into the mat. */}
            <div className="dark relative hidden items-center justify-center overflow-hidden bg-background p-10 md:flex lg:p-14">
                <DotPattern className="text-white/[0.07]" gap={24} radius={1} />
                <div className="relative z-10 aspect-[16/10] w-full max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl">
                    {TOUR_SLIDES.map((s, idx) => (
                        <img
                            key={s.tab}
                            src={s.dark}
                            alt={`Console ${s.tab} panel`}
                            className={cn(
                                'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-200 ease-out',
                                idx === i ? 'opacity-100' : 'opacity-0',
                            )}
                        />
                    ))}
                </div>
            </div>

            {/* RIGHT = LIGHT + COPY + NAV. Fixed 3-row grid keeps the footer Y constant. */}
            <div className="grid grid-rows-[auto_1fr_auto] overflow-hidden bg-muted/30 px-8 py-10 sm:px-12">
                {/* HEADER: counter + Skip (invisible, not unmounted, on the last slide) */}
                <div className="flex h-10 shrink-0 items-center justify-between">
                    <span className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground">Welcome to Console</span>
                    <Button
                        variant="ghost" size="sm" onClick={onDone} data-testid="onb-tour-skip"
                        className={cn('text-muted-foreground', last && 'invisible')}
                    >
                        Skip tour
                    </Button>
                </div>

                {/* STAGE: absolutely-stacked copy - contributes zero height, so it
                    can never push the footer regardless of body length. */}
                <div className="relative overflow-hidden">
                    {TOUR_SLIDES.map((s, idx) => (
                        <div
                            key={s.tab}
                            aria-hidden={idx !== i}
                            className={cn(
                                'absolute inset-0 flex flex-col justify-center transition-opacity duration-200 ease-out',
                                idx === i ? 'opacity-100' : 'pointer-events-none opacity-0',
                            )}
                        >
                            <h2 className="max-w-[15ch] font-serif text-[clamp(1.9rem,3vw,2.6rem)] leading-[1.05] tracking-tight text-foreground">{s.title}</h2>
                            <p className="mt-4 min-h-[96px] max-w-md text-body leading-relaxed text-muted-foreground">{s.body}</p>
                        </div>
                    ))}
                </div>

                {/* FOOTER: Back (invisible on slide 0) / dots / Next (fixed min-w). */}
                <div className="flex h-12 shrink-0 items-center justify-between">
                    <Button
                        variant="ghost" size="sm" onClick={() => setI(i - 1)} data-testid="onb-tour-prev"
                        className={cn('text-muted-foreground', i === 0 && 'invisible')}
                    >
                        Back
                    </Button>
                    <div className="flex items-center gap-2" role="tablist" aria-label="Feature tour">
                        {TOUR_SLIDES.map((s, idx) => (
                            <button
                                key={s.tab} type="button" role="tab" aria-selected={idx === i}
                                onClick={() => setI(idx)} aria-label={`Go to ${s.tab}`}
                                className={cn('h-1.5 rounded-full transition-all', idx === i ? 'w-6 bg-accent' : 'w-1.5 bg-border hover:bg-muted-foreground')}
                            />
                        ))}
                    </div>
                    <Button
                        variant="primary" size="default" onClick={() => (last ? onDone() : setI(i + 1))}
                        data-testid="onb-tour-next" className="min-w-[124px] justify-center"
                    >
                        {last ? 'Get started' : <>Next <ArrowRight className="size-4" /></>}
                    </Button>
                </div>
            </div>
        </div>
    );
}

/* --------------------------------- Sign in --------------------------------- */

export function SignInStep({ onContinue }: { onContinue: () => void }) {
    const conns = useConnections();
    const [busy, setBusy] = useState(false);
    const gh = conns.data?.github;
    async function connectGithub() {
        setBusy(true);
        try { await bridge.connections.github.connect(); await conns.refetch(); } catch { /* noop */ }
        setBusy(false);
    }
    return (
        <div className="mx-auto flex w-full max-w-sm flex-col gap-5" data-testid="onb-signin">
            <StepHeader title="Sign in to Console"
                subtitle="Optional. Signing in lets Console sync your setup across machines and answer questions about your repo." />
            {gh?.connected ? (
                <SuccessRow>Signed in as <span className="font-medium text-foreground">{gh.login ?? 'you'}</span> via GitHub</SuccessRow>
            ) : (
                <Button variant="outline" size="lg" className="w-full" onClick={connectGithub} disabled={busy} data-testid="onb-signin-github">
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />}
                    Continue with GitHub
                </Button>
            )}
            <OrDivider label="or" />
            <p className="flex items-center justify-center gap-2 text-small text-muted-foreground">
                <Mail className="size-3.5 shrink-0" /> Email sign-in is coming with Console cloud
            </p>
            <p className="text-center text-small text-muted-foreground">
                You can <button type="button" onClick={onContinue} className="text-accent underline underline-offset-2">skip and stay local</button> for now.
            </p>
        </div>
    );
}

/* --------------------------------- Your tools ------------------------------ */

export function ToolsStep({ value, onChange, guided = true }: { value: DevTool[]; onChange: (v: DevTool[]) => void; guided?: boolean }) {
    const toggle = (id: DevTool) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4" data-testid="onb-tools">
            <StepHeader
                title={guided ? 'Which tools do you build with?' : 'Your AI tools'}
                subtitle={guided
                    ? 'Pick the AI coding tools you use. Console tailors its handoff - it writes the right rules file and sends fixes to the tool you actually use. Skip if none apply.'
                    : 'Pick the agents you use. Sets the handoff target (.cursor/rules, AGENTS.md, .claude).'}
            />
            {guided && (
                <InfoCallout term="A handoff">
                    is when Console hands a ready-to-run prompt to your coding tool instead of doing the edit itself. Telling it which tools you use lets it write to the right place (a Cursor rule, an AGENTS.md, a Claude skill) automatically.
                </InfoCallout>
            )}
            <div className="grid grid-cols-2 gap-2.5">
                {DEV_TOOLS.map((t) => {
                    const on = value.includes(t.id);
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => toggle(t.id)}
                            data-testid={`onb-tool-${t.id}`}
                            className={cn('flex items-center gap-2 rounded-xl border p-3 text-left text-small transition',
                                on ? 'border-foreground/30 bg-secondary/50 text-foreground ring-1 ring-foreground/15'
                                    : 'border-border bg-card text-muted-foreground hover:bg-secondary/40')}
                        >
                            <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-[5px] border',
                                on ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground/40')}>
                                {on && <CheckCircle2 className="size-3" />}
                            </span>
                            {t.name}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* ------------------------------ .env permission ---------------------------- */

export function PermissionStep({ root, value, onChange, guided = true }: {
    root: string; value: boolean | null; onChange: (allow: boolean) => void; guided?: boolean;
}) {
    function choose(allow: boolean) {
        onChange(allow);
        // Persist the consent now so the study mount (and every later profile)
        // respects it before any .env is read.
        void bridge.intel.setEnvConsent(root, allow);
    }
    return (
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4" data-testid="onb-permission">
            <StepHeader
                title={guided ? 'May Console read your .env?' : 'Read .env key names?'}
                subtitle={guided
                    ? 'Console can detect which services you use from your .env file. It reads only the key NAMES (like STRIPE_SECRET_KEY), never the values, and nothing leaves your machine.'
                    : 'Detects services from .env key NAMES only. Values are never read or sent.'}
            />
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="text-small leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Names, not values.</span> Console reads the left side of each line in .env to spot providers. It never reads, stores, logs, or sends the secret values, and you can change this later in Settings.
                </p>
            </div>
            <div className="flex flex-col gap-2.5">
                <OptionCard icon={FolderCheck} title="Allow .env key-name detection"
                    desc="Recommended. Spots services like Stripe, Supabase, or Sentry from your .env."
                    selected={value === true} onClick={() => choose(true)} />
                <OptionCard icon={Lock} title="Skip - do not read .env"
                    desc="Console still maps your project from package files and code, just without .env detection."
                    selected={value === false} onClick={() => choose(false)} />
            </div>
        </div>
    );
}

/* --------------------------------- AI setup -------------------------------- */

const AI_PROVIDERS: { id: AiProviderId; name: string; ph: string }[] = [
    { id: 'openai', name: 'OpenAI', ph: 'sk-...' },
    { id: 'anthropic', name: 'Anthropic', ph: 'sk-ant-...' },
    { id: 'google', name: 'Google', ph: 'AIza...' },
];

function AiKeysPanel() {
    const keyStatus = useAiKeyStatus();
    const invalidate = useInvalidateAiKeys();
    const [provider, setProvider] = useState<AiProviderId>('openai');
    const [val, setVal] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const connected = AI_PROVIDERS.filter((p) => keyStatus.data?.[p.id]);
    const meta = AI_PROVIDERS.find((p) => p.id === provider)!;
    async function save() {
        if (!val.trim()) return;
        setBusy(true); setErr(null);
        try {
            const r = await bridge.ai.setKey(provider, val.trim());
            if (r.ok && r.valid !== false) { setVal(''); invalidate(); }
            else setErr(r.error ?? 'That key did not validate.');
        } catch { setErr('Could not save the key.'); }
        setBusy(false);
    }
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4">
            <div className="grid grid-cols-[10rem_1fr] gap-2">
                <div className="flex flex-col gap-1.5">
                    <Label className="text-muted-foreground">Provider</Label>
                    <Select value={provider} onValueChange={(v) => { setProvider(v as AiProviderId); setErr(null); }}>
                        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {AI_PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="onb-key" className="text-muted-foreground">API key</Label>
                    <div className="flex gap-2">
                        <Input id="onb-key" type="password" value={val} placeholder={meta.ph} className="h-9"
                            onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
                        <Button variant="outline" size="sm" className="h-9" onClick={save} loading={busy} disabled={!val.trim()}>
                            Connect
                        </Button>
                    </div>
                </div>
            </div>
            {err && <p className="text-small text-danger-text">{err}</p>}
            {connected.length > 0 && (
                <SuccessRow>{connected.map((p) => p.name).join(', ')} connected. You are set.</SuccessRow>
            )}
            <p className="text-small text-muted-foreground">Keys are held by the app, never shown back, never sent anywhere but the provider.</p>
        </div>
    );
}

function AiLocalPanel() {
    const ollama = useOllamaDetect();
    const running = ollama.data?.running;
    const models = ollama.data?.models ?? [];
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4">
            <div className="flex items-center justify-between">
                <span className="text-small text-foreground">Ollama runs models on your machine, fully offline.</span>
                <Button size="sm" variant="outline" onClick={() => ollama.refetch()} disabled={ollama.isFetching}>
                    {ollama.isFetching ? 'Detecting…' : 'Detect'}
                </Button>
            </div>
            {running ? (
                <>
                    <SuccessRow>Ollama running with {models.length} model{models.length === 1 ? '' : 's'} installed.</SuccessRow>
                    {models.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {models.slice(0, 6).map((m) => <Badge key={m} variant="secondary">{m}</Badge>)}
                        </div>
                    )}
                </>
            ) : ollama.data ? (
                <div className="flex flex-col items-start gap-2">
                    <p className="text-small text-muted-foreground">No local Ollama found. Install it to run AI fully offline.</p>
                    <Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://ollama.com/download')}>
                        <Download className="size-3.5" /> Install Ollama
                    </Button>
                    <p className="text-small text-muted-foreground">
                        Then pull a code-savvy model like <code className="rounded bg-muted px-1 py-0.5 font-mono text-label">qwen2.5-coder</code> or <code className="rounded bg-muted px-1 py-0.5 font-mono text-label">llama3.1</code>.
                    </p>
                </div>
            ) : (
                <p className="text-small text-muted-foreground">Click Detect to look for a local Ollama on this machine.</p>
            )}
        </div>
    );
}

export function AiSetupStep({ mode, onMode, guided = true }: { mode: AiMode | null; onMode: (m: AiMode) => void; guided?: boolean }) {
    return (
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4" data-testid="onb-ai">
            <StepHeader title={guided ? 'How should Console use AI?' : 'AI provider'}
                subtitle={guided
                    ? 'Console reads your project deeply and answers questions about it. Pick how it runs - you can change this later in Settings.'
                    : 'Bring your own key or run a local model. Change it later in Settings.'} />
            {guided && (
                <InfoCallout term="An API key">
                    is a secret password that lets Console talk to an AI provider as you. You paste it once; Console stores it encrypted on this machine and never shows it again. Want everything to stay on your computer? Pick a local model instead.
                </InfoCallout>
            )}
            <div className="flex flex-col gap-2.5">
                <OptionCard icon={Cloud} title="Console cloud" desc="Use our hosted AI. Nothing to set up."
                    selected={mode === 'cloud'} disabled onClick={() => onMode('cloud')}
                    trailing={<Badge variant="secondary">soon</Badge>} />
                <OptionCard icon={KeyRound} title="Your own API key" desc="Bring an OpenAI, Anthropic, or Google key."
                    selected={mode === 'keys'} onClick={() => onMode('keys')} />
                {mode === 'keys' && <AiKeysPanel />}
                <OptionCard icon={Cpu} title="Local model" desc="Run fully offline with Ollama. Private by default."
                    selected={mode === 'local'} onClick={() => onMode('local')} />
                {mode === 'local' && <AiLocalPanel />}
            </div>
        </div>
    );
}

/* ------------------------------ connect repo ------------------------------- */

export function ConnectRepoStep({ folder, onPick, guided = true }: { folder: string; onPick: (p: string) => void; guided?: boolean }) {
    const [picking, setPicking] = useState(false);
    async function pick() {
        setPicking(true);
        try {
            const r = await bridge.project.pickFolder();
            if (!r.canceled && r.path) onPick(r.path);
        } finally { setPicking(false); }
    }
    const name = folder ? folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
    return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4" data-testid="onb-connect">
            <StepHeader title={guided ? 'Point Console at your project' : 'Project root'}
                subtitle={guided
                    ? 'Pick a local folder. Console reads it on the next step to learn what is there. Everything stays on your machine.'
                    : 'Pick the project root. Read locally, nothing uploaded.'} />
            {guided && (
                <InfoCallout term="A repository (repo)">
                    is just the folder that holds a project&rsquo;s code and its history. Console opens it read-only to map the stack, dependencies, and services - it never changes your files or sends them anywhere.
                </InfoCallout>
            )}
            {folder ? (
                <>
                    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50">
                                <FolderCheck className="size-4 text-success" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-card-title text-foreground">{name}</p>
                                <p className="truncate font-mono text-label text-muted-foreground" title={folder} data-testid="welcome-connect-folder-path">{folder}</p>
                            </div>
                        </div>
                        <Button variant="ghost" size="sm" className="w-fit" onClick={pick} disabled={picking} data-testid="welcome-connect-pick-folder">
                            {picking ? <Loader2 className="size-3.5 animate-spin" /> : null} Pick a different folder
                        </Button>
                    </div>
                    <SuccessRow>Ready. Console reads this folder on the next step.</SuccessRow>
                </>
            ) : (
                <Button variant="outline" size="lg" className="w-full" onClick={pick} disabled={picking} data-testid="welcome-connect-pick-folder">
                    {picking ? <Loader2 className="size-4 animate-spin" /> : <FolderCheck className="size-4" />}
                    {picking ? 'Opening picker' : 'Pick a folder'}
                </Button>
            )}
        </div>
    );
}

/* --------------------------------- Study ----------------------------------- */

export function StudyStep({ root, onComplete }: { root: string; onComplete: (p: ProjectProfile | null) => void }) {
    const { steps, profile, done } = useMount(root, true);
    useEffect(() => {
        if (done) {
            const t = setTimeout(() => onComplete(profile), 450);
            return () => clearTimeout(t);
        }
    }, [done, profile, onComplete]);
    return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4" data-testid="onb-study">
            <StepHeader title="Studying your project"
                subtitle="Console is reading the files to learn what this project is, how it runs, and what it connects to. Nothing leaves your machine." />
            <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-5">
                {steps.length === 0 && <div className="flex items-center gap-2.5 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Starting…</div>}
                {steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-2.5">
                        {s.status === 'done' ? <CheckCircle2 className="size-4 shrink-0 text-success" />
                            : s.status === 'active' ? <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
                                : <Circle className="size-4 shrink-0 text-muted-foreground/40" />}
                        <span className={s.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>{s.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* --------------------------------- Report ---------------------------------- */

function ringColor(score: number) {
    return score >= 80 ? 'var(--color-success)' : score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
}

export function ReportStep({ profile, guided = true }: { profile: ProjectProfile | null; guided?: boolean }) {
    if (!profile) {
        return (
            <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-6 text-center" data-testid="onb-report-empty">
                <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-secondary/40">
                    <ScanText className="size-6 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1.5">
                    <h2 className="text-page-title text-foreground">Not much to read here yet</h2>
                    <p className="text-body leading-relaxed text-muted-foreground">
                        Console could not map this folder - it may be empty or not a code project. You can still continue and open it in the app, or go back and pick another folder.
                    </p>
                </div>
            </div>
        );
    }
    const { identity, stack, metrics, services, health } = profile;
    const about = profile.ai?.narrative || identity.description;
    const r = 22, c = 2 * Math.PI * r, off = c * (1 - health.score / 100);
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4" data-testid="onb-report">
            <StepHeader title="Here is what Console learned"
                subtitle={guided
                    ? 'A deep read of your project, all from its own files. This is your home base going forward.'
                    : 'Read entirely from the project files. The Overview keeps this live.'} />
            <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-5">
                <div className="flex shrink-0 flex-col items-center gap-1" title={`Read confidence: how completely Console could map this project (${health.score}/100)`}>
                    <div className="relative flex size-14 items-center justify-center">
                        <svg viewBox="0 0 56 56" className="size-14 -rotate-90">
                            <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-border)" strokeWidth="5" />
                            <circle cx="28" cy="28" r={r} fill="none" stroke={ringColor(health.score)} strokeWidth="5" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
                        </svg>
                        <span className="absolute text-small tabular-nums text-foreground">{health.score}</span>
                    </div>
                    <span className="text-label uppercase tracking-wide text-muted-foreground">Health</span>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-section text-foreground">{identity.title}</h3>
                        {profile.shape.projectType !== 'Unknown' && <Badge variant="outline">{profile.shape.projectType}</Badge>}
                    </div>
                    {about && <p className="mt-1 text-small leading-relaxed text-muted-foreground">{about}</p>}
                    {stack.notableFrameworks.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {stack.notableFrameworks.slice(0, 5).map((f) => <Badge key={f.name} variant="secondary">{f.name} {f.version.split('.')[0]}</Badge>)}
                        </div>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {[
                    { icon: ScanText, label: 'Language', value: stack.primaryLanguage },
                    { icon: Boxes, label: 'Packages', value: String(profile.shape.packageCount || profile.packages.length || 1) },
                    { icon: Plug, label: 'Services', value: String(services.length) },
                    { icon: AlignLeft, label: 'Lines', value: metrics.totalLoc.toLocaleString() },
                ].map((t) => (
                    <div key={t.label} className="flex flex-col gap-0.5 rounded-xl bg-secondary/40 p-3.5">
                        <span className="flex items-center gap-1.5 text-label uppercase text-muted-foreground"><t.icon className="size-3" />{t.label}</span>
                        <span className="truncate text-section tabular-nums text-foreground">{t.value}</span>
                    </div>
                ))}
            </div>
            {guided && (
                <InfoCallout term="The health score">
                    measures how completely Console could map the project, not how good the code is. A lower number usually means missing metadata - a README, a license, or a CI workflow - which the Repo panel can walk you through adding.
                </InfoCallout>
            )}
        </div>
    );
}

/* --------------------------------- Intent ---------------------------------- */

export function IntentStep({ value, onChange, guided = true }: { value: Intent[]; onChange: (v: Intent[]) => void; guided?: boolean }) {
    const toggle = (id: Intent) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4" data-testid="onb-intent">
            <StepHeader title="What do you want to do?"
                subtitle={guided
                    ? 'Pick as many as you like. Console uses this to suggest next steps and surface the services you will need. You can change it any time.'
                    : 'Pick any. Drives next-step suggestions and service hints.'} />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {INTENTS.map((it) => {
                    const on = value.includes(it.id);
                    return (
                        <button key={it.id} type="button" onClick={() => toggle(it.id)} data-testid={`onb-intent-${it.id}`}
                            className={cn('flex items-start gap-3 rounded-xl border p-4 text-left transition',
                                on ? 'border-foreground/30 bg-secondary/50 ring-1 ring-foreground/15' : 'border-border bg-card hover:bg-secondary/40')}>
                            <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border',
                                on ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground/40')}>
                                {on && <CheckCircle2 className="size-3" />}
                            </span>
                            <span className="flex flex-col gap-1">
                                <span className="text-card-title text-foreground">{it.title}</span>
                                <span className="text-small text-muted-foreground">{it.body}</span>
                                {/* The "needs" hint is hand-holding - Operator already knows what each goal implies. */}
                                {guided && (
                                    <span className="mt-0.5 flex items-center gap-1.5 text-label uppercase tracking-wide text-muted-foreground/70">
                                        <Plug className="size-3 shrink-0" />{it.needs}
                                    </span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* -------------------------------- Services --------------------------------- */

// Services worth suggesting when the project does not already wire them. Kept
// light here; the Services panel carries the full comparison + budget flow.
const SUGGESTED_SERVICES: { name: string; category: string; blurb: string }[] = [
    { name: 'Vercel', category: 'hosting', blurb: 'Deploy a frontend or full-stack app with zero config. Free hobby tier.' },
    { name: 'Sentry', category: 'errors', blurb: 'Catch and triage runtime errors in production. Free developer tier.' },
    { name: 'PostHog', category: 'analytics', blurb: 'Product analytics and session replay. Generous free tier.' },
];

// Resolve a service name to a real connector. null means there is no in-app
// connector yet, so the row points the user to the Services panel.
type LinkKind = 'github' | 'vercel' | 'sentry' | 'slack' | 'openai' | 'anthropic' | 'google' | null;
function linkKindFor(name: string): LinkKind {
    const n = name.toLowerCase();
    if (n.includes('openai')) return 'openai';
    if (n.includes('anthropic')) return 'anthropic';
    if (n.includes('google')) return 'google';
    if (n.includes('github')) return 'github';
    if (n.includes('vercel')) return 'vercel';
    if (n.includes('sentry')) return 'sentry';
    if (n.includes('slack')) return 'slack';
    return null;
}

// One service row with a real Link action: tap Link, paste the key/token, and it
// is stored (encrypted, app-side) and the connection is tested via the provider.
function ServiceLinkRow({ name, category, blurb }: { name: string; category: string; blurb?: string }) {
    const conns = useConnections();
    const keyStatus = useAiKeyStatus();
    const invalidate = useInvalidateAiKeys();
    const kind = linkKindFor(name);
    const [open, setOpen] = useState(false);
    const [token, setToken] = useState('');
    const [org, setOrg] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const connected = kind === 'github' ? conns.data?.github.connected
        : kind === 'vercel' ? conns.data?.vercel?.connected
            : kind === 'sentry' ? conns.data?.sentry?.connected
                : kind === 'openai' || kind === 'anthropic' || kind === 'google' ? keyStatus.data?.[kind]
                    : false;

    async function doLink() {
        setBusy(true); setErr(null);
        try {
            let r: { ok: boolean; error?: string };
            if (kind === 'github') r = await bridge.connections.github.connect();
            else if (kind === 'vercel') r = await bridge.connections.vercel.connect(token.trim());
            else if (kind === 'sentry') r = await bridge.connections.sentry.connect(token.trim(), org.trim());
            else if (kind === 'slack') r = await bridge.connections.slack.connect(token.trim());
            else if (kind === 'openai' || kind === 'anthropic' || kind === 'google') r = await bridge.ai.setKey(kind, token.trim());
            else r = { ok: false, error: 'Set this one up from the Services panel.' };
            if (r.ok) { setOpen(false); setToken(''); setOrg(''); void conns.refetch(); invalidate(); }
            else setErr(r.error ?? 'Could not link.');
        } catch { setErr('Could not link.'); }
        setBusy(false);
    }

    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-1.5">
                        <span className="truncate text-small font-medium text-foreground">{name}</span>
                        <span className="shrink-0 text-label uppercase tracking-wide text-muted-foreground">{category}</span>
                    </p>
                    {blurb && <p className="truncate text-small text-muted-foreground">{blurb}</p>}
                </div>
                {connected
                    ? <Badge variant="success"><span className="size-1.5 rounded-full bg-success" />linked</Badge>
                    : kind
                        ? <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen((o) => !o)}>Link</Button>
                        : <span className="shrink-0 text-label uppercase text-muted-foreground">in Services</span>}
            </div>
            {open && !connected && kind && (
                <div className="flex flex-col gap-2 border-t border-border pt-2">
                    {kind === 'github' ? (
                        <Button size="sm" onClick={doLink} loading={busy}>Connect with gh CLI</Button>
                    ) : (
                        <>
                            {kind === 'sentry' && <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Organization slug" className="h-8" />}
                            <div className="flex gap-2">
                                <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={kind === 'slack' ? 'Bot token (xoxb-…)' : 'API key / token'} className="h-8"
                                    onKeyDown={(e) => { if (e.key === 'Enter') void doLink(); }} />
                                <Button size="sm" onClick={doLink} loading={busy} disabled={!token.trim()}>Link</Button>
                            </div>
                        </>
                    )}
                    {err && <span className="text-small text-danger-text">{err}</span>}
                    <span className="text-label uppercase tracking-wide text-muted-foreground/70">Stored encrypted by the app. Never shown back.</span>
                </div>
            )}
        </div>
    );
}

export function ServicesStep({ profile, guided = true }: { profile: ProjectProfile | null; guided?: boolean }) {
    const conns = useConnections();
    const [busy, setBusy] = useState(false);
    const gh = conns.data?.github;
    async function connectGithub() {
        setBusy(true);
        try { await bridge.connections.github.connect(); await conns.refetch(); } catch { /* noop */ }
        setBusy(false);
    }
    const detected = (profile?.services ?? []).filter((s) => s.id !== 'github').slice(0, 8);
    const suggested = SUGGESTED_SERVICES.filter((s) => !(profile?.services ?? []).some((d) => d.name.toLowerCase() === s.name.toLowerCase()));
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3" data-testid="onb-services">
            <StepHeader title="Connect your services"
                subtitle={guided
                    ? 'Start with GitHub, then link what your project already uses or add a new one. Each link is optional - you can do this later from the Services panel.'
                    : 'GitHub first, then link detected or suggested services.'} />
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50">
                    <GitBranch className="size-4 text-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-small font-medium text-foreground">GitHub</p>
                    <p className="text-small text-muted-foreground">{gh?.connected ? `Connected as ${gh.login ?? 'you'}` : 'Reuses your gh CLI login. No token to paste.'}</p>
                </div>
                {gh?.connected
                    ? <Badge variant="success"><span className="h-1.5 w-1.5 rounded-full bg-success" />connected</Badge>
                    : <Button size="sm" variant="outline" onClick={connectGithub} loading={busy}>Connect</Button>}
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="text-small leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Your keys stay private.</span> Console detects services from your dependency, config, and <code className="font-mono text-label">.env</code> key NAMES, never the values. A key you Link is stored encrypted by the app, used only to call that provider, and never shown back or sent to AI.
                </p>
            </div>

            <div className={cn('grid gap-3', !guided && 'sm:grid-cols-2')}>
                {detected.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
                        <div className="flex items-center gap-2">
                            <Plug className="size-3.5 text-muted-foreground" />
                            <span className="text-small font-medium text-foreground">Detected</span>
                            <Badge variant="secondary" className="ml-auto">{detected.length}</Badge>
                        </div>
                        {detected.map((s) => <ServiceLinkRow key={s.id} name={s.name} category={s.category} />)}
                    </div>
                )}
                {suggested.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
                        <div className="flex items-center gap-2">
                            <Rocket className="size-3.5 text-muted-foreground" />
                            <span className="text-small font-medium text-foreground">Suggested</span>
                        </div>
                        {suggested.slice(0, 3).map((s) => <ServiceLinkRow key={s.name} name={s.name} category={s.category} />)}
                    </div>
                )}
            </div>
        </div>
    );
}

/* --------------------------------- Done ------------------------------------ */

// What a first-timer should do once they land in the app. Guided-only - it turns
// "now what?" into three concrete moves. Operator gets the terse close.
const NEXT_STEPS: { icon: React.ComponentType<{ className?: string }>; label: string; hint: string }[] = [
    { icon: ScanText, label: 'Read the Report', hint: 'Your project mapped end to end - start here.' },
    { icon: Lock, label: 'Check the Repo panel', hint: 'Fix anything flagged before you ship.' },
    { icon: Rocket, label: 'Connect Vercel and deploy', hint: 'Go from localhost to live, no config.' },
];

export function DoneStep({ onFinish, guided = true }: { onFinish: () => void; guided?: boolean }) {
    const [going, setGoing] = useState(false);
    return (
        <div className={cn('mx-auto flex w-full flex-col items-center gap-5 text-center duration-500 animate-in fade-in', guided ? 'max-w-md' : 'max-w-sm')} data-testid="onb-done">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-success/30 bg-success/10 delay-100 duration-500 animate-in zoom-in-50 fade-in fill-mode-backwards">
                <CheckCircle2 className="size-7 text-success" />
            </div>
            <div className="flex flex-col gap-1.5">
                <h2 className="text-page-title text-foreground">You are all set</h2>
                <p className="text-body leading-relaxed text-muted-foreground">
                    {guided
                        ? 'Console has read your project, your AI is wired, and your services are within reach. Here is where to go next.'
                        : 'Project read, AI wired, services within reach. The Overview is home base.'}
                </p>
            </div>
            {guided && (
                <ul className="flex w-full flex-col gap-2 text-left" data-testid="onb-next-steps">
                    {NEXT_STEPS.map((s, i) => (
                        <li key={s.label} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50 text-label tabular-nums text-muted-foreground">{i + 1}</span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="flex items-center gap-1.5 text-card-title text-foreground"><s.icon className="size-3.5 text-muted-foreground" />{s.label}</span>
                                <span className="text-small text-muted-foreground">{s.hint}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            <Button variant="primary" size="lg" className="w-full" disabled={going} onClick={() => { setGoing(true); onFinish(); }} data-testid="welcome-connect-done">
                {going ? <Loader2 className="size-4 animate-spin" /> : <>Open the Overview <ArrowRight className="size-4" /></>}
            </Button>
        </div>
    );
}
