import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { WindowControls } from '../_shell/WindowControls';
import { ArrowRight, ArrowLeft, Check, Rocket, Compass } from 'lucide-react';
import { Button } from '@/components/ui';
import {
    Stepper, StepperItem, StepperTrigger, StepperIndicator, StepperSeparator, StepperTitle, StepperNav,
} from '@/components/stepper';
import { cn } from '@/lib/utils';
import { writePersona, type Persona } from '../../lib/persona';
import { writeActiveProject, readActiveProject } from '../../lib/activeProject';
import { writeOnboarded } from '../../lib/onboarded';
import { writeOnboardedForWindow } from '../../lib/onboardedWindow';
import { markProjectOnboarded } from '../../lib/onboardedProjects';
import { type ProjectProfile } from '../../lib/bridge';
import { HeroBackground } from './HeroBackground';
import {
    type OnbStage, type Intent, type AiMode, stepDefs, milestoneFor, nextStage, prevStage,
} from '../../lib/onboarding/machine';
import {
    TourStep, SignInStep, ToolsStep, AiSetupStep, ConnectRepoStep, PermissionStep, StudyStep, ReportStep, IntentStep, ServicesStep, DoneStep, stageCopy,
} from './onboardingSteps';
import { readDevTools, writeDevTools, type DevTool } from '../../lib/devTools';
import { DelicateAsciiDots } from './DelicateAsciiDots';
import overviewLight from '../../assets/tour/overview-light.png';
import overviewDark from '../../assets/tour/overview-dark.png';

/**
 * Multi-stage first-run onboarding. persona + tour are full-screen; the rest is a
 * bounded panel (Account -> AI -> Your project -> Goals -> Connect) that scrolls
 * INTERNALLY so there is never a page-level scrollbar. ONE machine, two render
 * densities (persona is the hint). Window-scoped via ?wid= (see router).
 */

// The reactive-ascii left panel is a solid canvas, so its colours can't come
// from CSS tokens; pick a pair that matches the active theme at render.
function asciiColors(): { bg: string; text: string } {
    const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    return dark ? { bg: '#0b0b0d', text: '125, 135, 158' } : { bg: '#f4f4f5', text: '150, 150, 166' };
}

export function OnboardingWizard() {
    const navigate = useNavigate();
    const [stage, setStage] = useState<OnbStage>('persona');
    const [persona, setPersona] = useState<Persona | null>(null);
    const [aiMode, setAiMode] = useState<AiMode | null>(null);
    const [projectRoot, setProjectRoot] = useState<string>(() => readActiveProject()?.path ?? '');
    const [intents, setIntents] = useState<Intent[]>(['understand']);
    const [profile, setProfile] = useState<ProjectProfile | null>(null);
    const [devTools, setDevTools] = useState<DevTool[]>(() => readDevTools());
    const [envConsent, setEnvConsent] = useState<boolean | null>(null);
    const guided = persona !== 'seasoned';

    const finish = useCallback(() => {
        writeOnboarded();
        writeOnboardedForWindow();
        // Mark THIS project set up so re-opening it later skips onboarding, while
        // a different, never-seen folder still gets taken through setup.
        markProjectOnboarded(readActiveProject()?.path ?? projectRoot);
        navigate('/overview');
    }, [navigate, projectRoot]);

    function choosePersona(p: Persona) {
        writePersona(p);
        setPersona(p);
        // Operator skips the tour and lands on the AI step; Guided starts the tour.
        setStage(nextStage('persona', p));
    }

    function goNext() {
        // connect now leads to the .env permission gate, then study.
        if (stage === 'connect') { if (projectRoot) setStage(nextStage('connect', persona)); return; }
        if (stage === 'done') { finish(); return; }
        setStage(nextStage(stage, persona));
    }
    function goBack() { setStage(prevStage(stage, persona)); }

    // Each stage fills the frameless window. None of them have the TopBar, so we
    // overlay our own drag strip + window controls below so the window can be
    // moved / minimized / maximized / closed during onboarding too.
    let content: ReactNode;

    if (stage === 'persona') {
        // The calm hero: copy + inline persona buttons on the left, the product
        // shot bleeding in from the bottom-right glass frame, over the ASCII field.
        content = <PersonaLanding onPick={choosePersona} />;
    } else if (stage === 'tour') {
        // Feature tour is a skippable full-page carousel (fills the screen, no card).
        content = (
            <div className="relative h-full w-full overflow-hidden bg-background" data-testid="onboarding-wizard">
                <TourStep onDone={() => setStage('signin')} />
            </div>
        );
    } else {
        // The stepped flow lives in one bounded panel that scrolls internally.
        const milestone = milestoneFor(stage, persona);
        const footerHidden = stage === 'study' || stage === 'done';
        const nextDisabled = (stage === 'connect' && !projectRoot) || (stage === 'permission' && envConsent === null);
        const nextLabel = stage === 'report' ? 'Looks good'
            : stage === 'services' ? 'Finish'
                : stage === 'permission' ? 'Study it'
                    : 'Continue';
        const skippable = stage === 'signin' || stage === 'ai' || stage === 'services' || stage === 'tools';
        const ascii = asciiColors();
        const total = stepDefs(persona).length;
        const copy = stageCopy(stage, guided);
        content = (
            <div
                className="relative grid h-full w-full grid-cols-1 overflow-hidden bg-card lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
                data-testid="onboarding-wizard"
            >
                {/* LEFT 2/3: the teaching panel - a pointer-reactive ascii field
                    carrying the stepper and THIS step's title + description, so the
                    right panel can be only the inputs. Hidden under lg. */}
                <aside className="relative hidden overflow-hidden bg-muted dark:bg-background lg:flex lg:flex-col">
                    <div className="absolute inset-0">
                        <DelicateAsciiDots backgroundColor={ascii.bg} textColor={ascii.text} animationSpeed={0.4} />
                    </div>
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-background/45" />
                    <div className="relative z-10 flex h-full flex-col gap-9 p-9 xl:p-12">
                        <Eyebrow />
                        <OnboardingStepper steps={stepDefs(persona)} current={milestone} />
                        <div className="flex flex-1 flex-col justify-center gap-4">
                            <h2 className="max-w-[16ch] font-serif text-[clamp(1.9rem,2.6vw,2.7rem)] leading-[1.06] tracking-tight text-foreground" data-testid="onb-stage-title">
                                {copy.title}
                            </h2>
                            <p className="max-w-md text-body leading-relaxed text-muted-foreground">{copy.subtitle}</p>
                        </div>
                        <span className="font-mono text-label text-muted-foreground">Step {milestone + 1} / {total}</span>
                    </div>
                </aside>
                {/* RIGHT 1/3: ONLY the inputs - vertically + horizontally centered
                    (m-auto) and padded clear of the window controls (pt). The in-step
                    header is hidden; its copy lives on the left. */}
                {/* At lg+ the left aside carries the title/subtitle, so hide the
                    in-step header there. Below lg the aside is gone, so the in-step
                    header stays visible - the step always has a heading. */}
                <section className="relative flex min-h-0 flex-col bg-card lg:[&_[data-onb-step-header]]:hidden">
                    <div className="shrink-0 border-b border-border px-6 py-4 lg:hidden">
                        <OnboardingStepper steps={stepDefs(persona)} current={milestone} />
                    </div>
                    <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-8 pt-16 sm:px-8 lg:pt-20">
                        <div className="m-auto w-full max-w-md" data-testid="onb-inputs">
                            {stage === 'signin' && <SignInStep onContinue={goNext} />}
                            {stage === 'tools' && <ToolsStep value={devTools} onChange={(v) => { setDevTools(v); writeDevTools(v); }} guided={guided} />}
                            {stage === 'ai' && <AiSetupStep mode={aiMode} onMode={setAiMode} guided={guided} />}
                            {stage === 'connect' && <ConnectRepoStep folder={projectRoot} onPick={(p) => { writeActiveProject(p); setProjectRoot(p); }} guided={guided} />}
                            {stage === 'permission' && <PermissionStep root={projectRoot} value={envConsent} onChange={setEnvConsent} guided={guided} />}
                            {stage === 'study' && <StudyStep root={projectRoot} onComplete={(p) => { setProfile(p); setStage('report'); }} />}
                            {stage === 'report' && <ReportStep profile={profile} guided={guided} />}
                            {stage === 'intent' && <IntentStep value={intents} onChange={setIntents} guided={guided} />}
                            {stage === 'services' && <ServicesStep profile={profile} guided={guided} />}
                            {stage === 'done' && <DoneStep onFinish={finish} guided={guided} />}
                        </div>
                    </div>
                    {!footerHidden && (
                        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4 sm:px-8">
                            <Button variant="ghost" size="sm" onClick={goBack} data-testid="onb-back">
                                <ArrowLeft className="size-3.5" /> Back
                            </Button>
                            <div className="flex items-center gap-2">
                                {skippable && (
                                    <Button variant="ghost" size="sm" onClick={goNext} data-testid="onb-skip">Skip</Button>
                                )}
                                <Button variant="primary" size="sm" onClick={goNext} disabled={nextDisabled} data-testid="onb-next">
                                    {nextLabel} <ArrowRight className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        );
    }

    return (
        <>
            {content}
            {/* Drag strip + window controls for the frameless window (no TopBar here). */}
            <div
                data-testid="onboarding-drag"
                className="fixed inset-x-0 top-0 z-50 flex h-9 items-stretch justify-end"
            >
                <WindowControls />
            </div>
        </>
    );
}

/* ------------------------------ the stepper -------------------------------- */

// The fetched 21st.dev stepper, used as shipped. Console's --accent token is a
// brand blue (the component assumes a neutral accent), so the only change is to
// render upcoming circles with --muted instead of --accent; active/completed keep
// the component's filled --primary + check. Inert - progress is driven by `current`.
function OnboardingStepper({ steps, current }: { steps: readonly { id: string; label: string }[]; current: number }) {
    return (
        <Stepper value={current + 1} indicators={{ completed: <Check className="size-3.5" /> }}>
            <StepperNav>
                {steps.map((s, i) => (
                    <StepperItem key={s.id} step={i + 1} className="not-last:flex-1">
                        <StepperTrigger className="pointer-events-none gap-2.5">
                            <StepperIndicator className="bg-muted text-muted-foreground">{i + 1}</StepperIndicator>
                            <StepperTitle className="hidden whitespace-nowrap text-muted-foreground data-[state=active]:text-foreground data-[state=completed]:text-foreground sm:block">
                                {s.label}
                            </StepperTitle>
                        </StepperTrigger>
                        {i < steps.length - 1 && <StepperSeparator />}
                    </StepperItem>
                ))}
            </StepperNav>
        </Stepper>
    );
}

/* ------------------------------- persona ----------------------------------- */

function Eyebrow() {
    return <span className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground">Console</span>;
}

function PersonaLanding({ onPick }: { onPick: (p: Persona) => void }) {
    return (
        <div className="relative h-full w-full overflow-hidden bg-muted dark:bg-background" data-testid="onboarding-wizard">
            <HeroBackground />

            {/* The product (Overview) bleeding in from the bottom-right in a
                translucent glass frame; hidden where there is no room. */}
            <div className="pointer-events-none absolute -bottom-20 -right-24 z-0 hidden w-[58%] max-w-3xl lg:block" aria-hidden>
                <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 shadow-2xl ring-1 ring-black/5 backdrop-blur-sm">
                    <img src={overviewLight} alt="" className="block w-full dark:hidden" />
                    <img src={overviewDark} alt="" className="hidden w-full dark:block" />
                </div>
            </div>

            {/* Copy + inline persona buttons, on the left. */}
            <div className="relative z-10 flex h-full items-center px-8 sm:px-14 lg:px-20" data-testid="persona-pick">
                <div className="flex max-w-xl flex-col gap-6">
                    <Eyebrow />
                    <div className="flex flex-col gap-3.5">
                        <h1 className="max-w-[14ch] font-serif text-[clamp(2.2rem,4vw,3.25rem)] leading-[1.04] tracking-tight text-foreground">
                            You built it. Let&rsquo;s ship it.
                        </h1>
                        <p className="max-w-md text-body leading-relaxed text-muted-foreground">
                            Console reads your project, maps the stack, surfaces what is breaking, and walks you from localhost to live. Which sounds like you?
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row" data-testid="persona-cards">
                        <button
                            type="button"
                            onClick={() => onPick('seasoned')}
                            data-testid="persona-seasoned"
                            className="group flex flex-1 flex-col gap-2 rounded-2xl border border-border bg-card/70 p-5 text-left backdrop-blur-sm transition hover:border-foreground/30 hover:bg-card"
                        >
                            <span className="flex size-9 items-center justify-center rounded-xl bg-secondary text-foreground">
                                <Rocket className="size-5" />
                            </span>
                            <span className="mt-1 flex items-center gap-1.5 text-body font-semibold text-foreground">
                                I know my way around
                                <ArrowRight className="size-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                            </span>
                            <span className="text-small leading-relaxed text-muted-foreground">
                                A dense cockpit. Every panel, no hand-holding.
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onPick('newbie')}
                            data-testid="persona-newbie"
                            className="group flex flex-1 flex-col gap-2 rounded-2xl border border-border bg-card/70 p-5 text-left backdrop-blur-sm transition hover:border-foreground/30 hover:bg-card"
                        >
                            <span className="flex size-9 items-center justify-center rounded-xl bg-secondary text-foreground">
                                <Compass className="size-5" />
                            </span>
                            <span className="mt-1 flex items-center gap-1.5 text-body font-semibold text-foreground">
                                I&rsquo;m new to this
                                <ArrowRight className="size-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                            </span>
                            <span className="text-small leading-relaxed text-muted-foreground">
                                Guided, step by step, with plain-English explanations.
                            </span>
                        </button>
                    </div>
                    <span className="text-small text-muted-foreground">You can switch modes anytime.</span>
                </div>
            </div>
        </div>
    );
}
