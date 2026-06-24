import { createElement, type ReactNode } from 'react';
import { DocDemo } from '../../components/docs/DocDemo';
import { DocSection } from '../../components/docs/DocSection';
import { DocAlert } from '../../components/docs/DocAlert';
import { WorkboardCardDemo } from './demos/WorkboardCardDemo';
import { OverviewTilesDemo } from './demos/OverviewTilesDemo';
import { ReleaseGatesDemo } from './demos/ReleaseGatesDemo';
import { ServicesPillsDemo } from './demos/ServicesPillsDemo';
import { ObservabilityRunDemo } from './demos/ObservabilityRunDemo';
import { ArchNodeDemo } from './demos/ArchNodeDemo';
import { PipelineWorkflowsDemo } from './demos/PipelineWorkflowsDemo';

/**
 * Tiny prose helpers so the inline body() entries below read as a document
 * rather than a wall of createElement calls. The page body renders inside a
 * [data-testid="docs-body"] container, so plain p / ul / li / code pick up the
 * docs typography; DocSection / DocDemo / DocAlert opt into the richer visual
 * structure. This file stays .ts (no JSX) so the createElement helpers are the
 * seam between prose and the live projections.
 */
const para = (...children: ReactNode[]): ReactNode =>
    createElement('p', null, ...children);

const bullets = (items: ReactNode[]): ReactNode =>
    createElement(
        'ul',
        null,
        ...items.map((item, i) => createElement('li', { key: i }, item)),
    );

const strong = (text: string): ReactNode => createElement('strong', null, text);

const code = (text: string): ReactNode => createElement('code', null, text);

const doc = (...children: ReactNode[]): ReactNode =>
    createElement('div', null, ...children);

// A Diataxis-labelled section: kicker names the quadrant (Onboarding / How-to
// / Reference / Explanation), then the heading and its prose flow.
const section = (kicker: string, title: string, ...children: ReactNode[]): ReactNode =>
    createElement(DocSection, { kicker, title }, ...children);

// A live projection of a real Console component, framed in the doc stage.
const demo = (
    component: () => ReactNode,
    opts: { caption?: string; annotation?: ReactNode; scale?: number } = {},
): ReactNode =>
    createElement(DocDemo, opts, createElement(component));

const note = (title: string, ...children: ReactNode[]): ReactNode =>
    createElement(DocAlert, { kind: 'note', title }, ...children);

const tip = (...children: ReactNode[]): ReactNode =>
    createElement(DocAlert, { kind: 'tip' }, ...children);

const warn = (title: string, ...children: ReactNode[]): ReactNode =>
    createElement(DocAlert, { kind: 'warning', title }, ...children);

/**
 * The Console docs page index: single source of truth for the docs sidebar
 * groups and the active page lookup. Body can be:
 *   - inline JSX (a function returning ReactNode, lazy so we don't pay the
 *     tree cost upfront), OR
 *   - a relative path under the repo's docs/ folder, fetched via
 *     bridge.docs.read() and rendered with marked.
 *
 * Six groups: Welcome, Build, Ship, Workbench, Architecture, Reference.
 */
export type ConsoleDocsGroup =
    | 'Welcome'
    | 'Build'
    | 'Ship'
    | 'Workbench'
    | 'Architecture'
    | 'Reference';

export const CONSOLE_DOCS_GROUP_ORDER: ConsoleDocsGroup[] = [
    'Welcome',
    'Build',
    'Ship',
    'Workbench',
    'Architecture',
    'Reference',
];

export interface ConsoleDocEntry {
    path: string;
    title: string;
    group: ConsoleDocsGroup;
    blurb?: string;
    lead?: string;
    /** Inline body, called lazily when the page is shown. */
    body?: () => ReactNode;
    /** Or, instead of inline body, a path under docs/ to fetch via bridge.docs.read(). */
    sourceDoc?: string;
}

export const CONSOLE_DOC_PAGES: ConsoleDocEntry[] = [
    {
        path: '/docs',
        title: 'Welcome to the Console',
        group: 'Welcome',
        blurb: 'What the Console is, what it gives you, where to look next.',
        lead: 'The Console is the operations cockpit for your project. It surfaces the issue board, the release gates, the architecture, and the live services in one window so the team can see the state of the system at a glance.',
        body: () => doc(
            section(
                'Onboarding',
                'What the Console shows you',
                para(
                    'The Console reads your repository and turns it into a set of always-on views. ',
                    'Open issues become a board you can sort and relabel. CI workflows become a pipeline you can watch. ',
                    'Release checklists become gates that go green when their evidence lands. Nothing here asks you to leave the window or run a command by hand.',
                ),
                para(
                    'The landing surface is the Overview. Its vitals row is the fastest read on the project: release readiness, cost against the daily cap, eval pass rate, and recent automation. ',
                    'Every tile below is the real component the Overview renders, with sample numbers in place of your live data.',
                ),
                demo(OverviewTilesDemo, {
                    caption: 'The Overview vitals tiles, rendered from the same viz primitives the panel uses.',
                    annotation: doc(
                        'Each tile links into the panel that owns it. The release donut, for example, opens the ',
                        strong('Release'),
                        ' gates.',
                    ),
                }),
            ),
            section(
                'Explanation',
                'It reflects the repo, it does not store a copy',
                para(
                    'Everything you see is derived from files already in the repo: ',
                    'GitHub issues, ',
                    code('.github/workflows'),
                    ', the checklists under ',
                    code('release/'),
                    ', and the run records under ',
                    code('.refringence-qa/'),
                    '. The Console does not keep a second copy of your project state; it shows you the truth on disk.',
                ),
                note(
                    'Empty is a signal, not a failure',
                    'If a panel looks empty, it is usually telling you the underlying file is missing, not that the Console crashed. Add the file and the panel fills in on the next read.',
                ),
            ),
            section(
                'Onboarding',
                'Two ways to read it',
                para(
                    'The Console ships in two modes. You pick the one that matches how much you already know, and you can switch at any time.',
                ),
                bullets([
                    doc(
                        strong('Guided mode'),
                        ' explains as it goes. Each page carries a plain-English lead, a "Before you read" note, and larger body text. Start here if you are new to the build or to the Console itself.',
                    ),
                    doc(
                        strong('Operator mode'),
                        ' is denser and faster. The same data, fewer words, sidebars collapsed to titles. Switch here once the layout is in your hands and you want to move quickly.',
                    ),
                ]),
            ),
            section(
                'How-to',
                'Where to look next',
                para(
                    'Read ',
                    strong('Design principles'),
                    ' to understand why every screen looks and reads the way it does. ',
                    'Open ',
                    strong('Workboard'),
                    ' for the day-to-day issue flow, or ',
                    strong('Architecture'),
                    ' if you want to know how the window is wired together under the surface.',
                ),
            ),
        ),
    },
    {
        path: '/docs/principles',
        title: 'Design principles',
        group: 'Welcome',
        blurb: 'How every panel reads, talks, and behaves.',
        lead: 'Plain language, one accent colour per screen, no chatbot widget, no banned filler words. These rules are enforced in CI and reviewed on every doc change.',
        sourceDoc: 'CONSOLE-DESIGN-PRINCIPLES.md',
    },
    {
        path: '/docs/q3-plan',
        title: 'Q3 plan',
        group: 'Build',
        blurb: 'The active quarter plan that drives everything in here.',
        lead: 'The Q3 plan is the steering file for the Console build. The Workboard mirrors its tracker labels; the Pipeline panel watches its CI gates; the Release panel checks off its acceptance criteria.',
        sourceDoc: 'CONSOLE-Q3-PLAN.md',
    },
    {
        path: '/docs/pipeline',
        title: 'Pipeline',
        group: 'Build',
        blurb: 'CI workflows, hosting providers, and what each step gates on.',
        lead: 'The Pipeline panel reads .github/workflows and reports which workflows fire on push, pull request, and tag. It also detects Vercel and Netlify so the deploy story is in one place.',
        body: () => doc(
            section(
                'Explanation',
                'What runs when I push',
                para(
                    'The Pipeline panel answers one question: what runs when I push? ',
                    'It parses every workflow file under ',
                    code('.github/workflows'),
                    ' and shows each one next to the events that trigger it, so you never have to open the YAML to remember which job fires on a pull request versus a tag.',
                ),
                demo(PipelineWorkflowsDemo, {
                    caption: 'One row per workflow, tagged with its trigger events, as the panel reads them.',
                    annotation: doc(
                        'A workflow with more than one trigger appears under each event. Reading top to bottom tells you the order a change moves through: commit, merge, release.',
                    ),
                }),
            ),
            section(
                'Reference',
                'What each row carries',
                para('Each workflow contributes one row, built from three fields the Console pulls out of the YAML.'),
                bullets([
                    doc(strong('Push'), ' workflows that run on every commit to a branch, such as lint and unit tests.'),
                    doc(strong('Pull request'), ' workflows that gate a merge, such as type checks and the QA suite.'),
                    doc(strong('Tag'), ' workflows that build and publish a release when a version tag lands.'),
                ]),
            ),
            section(
                'Explanation',
                'Hosting providers',
                para(
                    'Deployment is part of the pipeline even when it lives outside GitHub Actions. ',
                    'The panel also detects Vercel and Netlify from their config files, so the deploy step appears alongside the CI steps and the whole path from push to live site sits in one place.',
                ),
                tip(
                    'A blank Pipeline panel usually means there are no workflow files yet, not that detection failed. Add a file under ',
                    code('.github/workflows'),
                    ' and it appears on the next read.',
                ),
            ),
        ),
    },
    {
        path: '/docs/release',
        title: 'Release gates',
        group: 'Ship',
        blurb: 'Versioned checklists with green / amber / red / blocked gates.',
        lead: 'A release checklist is a YAML file under release/. Each gate names an artifact: a workflow run, a generated report, a tag, a signed binary. The panel rolls those up into one status per version.',
        body: () => doc(
            section(
                'Explanation',
                'A release is a checklist in the repo',
                para(
                    'Each version gets a YAML file under ',
                    code('release/'),
                    ' that lists the gates the version must clear before it ships. The Release panel reads those files and turns each one into a single, honest status.',
                ),
                demo(ReleaseGatesDemo, {
                    caption: 'The real summary bar and gate rows, with sample gates standing in for a live checklist.',
                    annotation: doc(
                        'The summary bar at the top is never more optimistic than the weakest gate below it. One blocked gate holds the whole version back.',
                    ),
                }),
            ),
            section(
                'Reference',
                'What each gate colour means',
                para('A gate is one thing that must be true, tied to a real artifact rather than a checkbox someone ticked by hand.'),
                bullets([
                    doc(strong('Green'), ' means the artifact exists and passed. The gate is clear.'),
                    doc(strong('Amber'), ' means the work is in progress or the evidence is partial. Worth a look, not yet a stop.'),
                    doc(strong('Red'), ' means the gate ran and failed. Something needs fixing before the version moves.'),
                    doc(strong('Blocked'), ' means the gate cannot run yet because an earlier gate has not cleared.'),
                ]),
            ),
            section(
                'How-to',
                'Add a release',
                para(
                    'Create a new YAML file under ',
                    code('release/'),
                    ', name its gates, and point each gate at the artifact that proves it: a workflow run, a generated report, a tag, or a signed binary. ',
                    'The panel picks up the new file on its next read and starts tracking it with no further wiring.',
                ),
            ),
        ),
    },
    {
        path: '/docs/observability',
        title: 'Observability',
        group: 'Ship',
        blurb: 'Run history, error counters, and the cost ticker.',
        lead: 'Every QA run, every Promptfoo eval, every codebase audit writes to .refringence-qa/. The Observability panel reads those records and counts them so you can see your runs are healthy.',
        body: () => doc(
            section(
                'Explanation',
                'Watch a run as it happens',
                para(
                    'The Observability panel can start a run from a button and stream its output live. ',
                    'The strip below is the real running indicator and terminal the panel mounts: a spinner with an elapsed clock, then the process output line by line, stderr in the danger token.',
                ),
                demo(ObservabilityRunDemo, {
                    caption: 'The live RunningIndicator and LiveConsole components, mounted with sample output.',
                    annotation: doc(
                        'When the run finishes, its artifacts land under ',
                        code('.refringence-qa/runs/'),
                        ' and the run shows up in the table below as a completed row.',
                    ),
                }),
            ),
            section(
                'Reference',
                'What it counts',
                para(
                    'Below the run surface, the panel counts what your runs have produced: runs total and in the last 24 hours, errors total and in the last 24 hours, and a runs-per-day sparkline. ',
                    'These are read straight from the run records, so the numbers move only when real work lands.',
                ),
                note(
                    'Errors in the last 24 hours turn red',
                    'A non-zero 24-hour error count is the one counter the panel tints, because it is the one that usually needs you today.',
                ),
            ),
        ),
    },
    {
        path: '/docs/workboard',
        title: 'Workboard',
        group: 'Workbench',
        blurb: 'The kanban of open issues, grouped by severity.',
        lead: 'The Workboard pulls open issues from GitHub via the gh CLI and groups them by severity: critical / high / medium / low / phase / other. Drag a card across columns to relabel the issue in place.',
        body: () => doc(
            section(
                'Explanation',
                'One card per open issue',
                para(
                    'Each card carries the issue number, the author, the title, and the GitHub labels. ',
                    'The grip handle on the left is the drag affordance; the rest of the card opens the issue detail sheet.',
                ),
                demo(WorkboardCardDemo, {
                    caption: 'A live IssueCard, rendered exactly as the Workboard panel does, minus the drag wiring.',
                    annotation: doc(
                        'The coloured chips are the real GitHub label colours. The Console reads them from the issue rather than recolouring them.',
                    ),
                }),
            ),
            section(
                'How-to',
                'Relabel by dragging',
                para(
                    'Drag a card between columns and the panel calls ',
                    code('bridge.issues.relabel'),
                    ', which shells out to ',
                    code('gh issue edit'),
                    '. If that call fails, the move is reverted and the failure is surfaced in a toast, so the board never drifts out of step with GitHub.',
                ),
                warn(
                    'You need gh signed in',
                    'The Workboard is empty until the GitHub CLI is authenticated. Run ',
                    code('gh auth login'),
                    ' once, then check the Services panel to confirm the connection turned green.',
                ),
            ),
        ),
    },
    {
        path: '/docs/tutorials',
        title: 'Tutorials',
        group: 'Workbench',
        blurb: 'Step-by-step walkthroughs for first-time operators.',
        lead: 'Each tutorial is a short, opinionated path through a specific Console flow: opening a release, triaging an issue, wiring up a new pipeline. Run them with a fresh checkout to verify the dev loop end to end.',
    },
    {
        path: '/docs/services',
        title: 'Services',
        group: 'Workbench',
        blurb: 'Local daemons the Console talks to: gh, Ollama, MCP.',
        lead: 'The Services panel reports which local processes are running and at what version, so missing dependencies become a visible state rather than a silent failure.',
        body: () => doc(
            section(
                'Explanation',
                'Connections, not silent failures',
                para(
                    'The Console leans on a handful of local tools and hosted services instead of its own cloud backend. ',
                    'The Services panel lists each one, says whether it is connected, and shows the detail it found, so a gap is something you can see at a glance rather than a feature that quietly does nothing.',
                ),
                demo(ServicesPillsDemo, {
                    caption: 'The real connection cards and status pills: connected, checking, and not connected.',
                    annotation: doc(
                        'The pill never asserts "Not connected" before the check has settled. While it is in flight it reads ',
                        strong('Checking'),
                        ', which is why a failed backend never hides behind a false negative.',
                    ),
                }),
            ),
            section(
                'Reference',
                'What it checks',
                bullets([
                    doc(strong('GitHub'), ', via the ', code('gh'), ' CLI, which backs the Workboard. Sign in with ', code('gh auth login'), ' and the issue board fills in.'),
                    doc(strong('Vercel'), ', with an encrypted token, for deploy status and project env vars.'),
                    doc(strong('Optional services'), ' such as a local model runner or a database, listed as not connected until you wire them up.'),
                ]),
            ),
            section(
                'How-to',
                'Fix a gap',
                para(
                    'Install or connect the missing tool, make sure it is on your path, and revisit the panel. ',
                    'The Console re-checks on each read, so there is nothing to restart and no setting to flip; a freshly connected service simply turns green.',
                ),
            ),
        ),
    },
    {
        path: '/docs/architecture',
        title: 'Architecture',
        group: 'Architecture',
        blurb: 'The Electron-main, preload, and renderer surfaces.',
        lead: 'The Console is an Electron app: main owns the OS and IPC, preload exposes a typed bridge, the renderer is React 19 + Vite + Tailwind v4. Each IPC handler is a thin file under console-electron/src/main/ipc/.',
        body: () => doc(
            section(
                'Explanation',
                'A graph of the codebase',
                para(
                    'The Architecture panel walks the repo and draws a dependency graph: one node per package, edges for who imports whom, coloured by tier. ',
                    'Clicking a node highlights its neighbours and opens a sidebar explaining what the package is and what it depends on.',
                ),
                demo(ArchNodeDemo, {
                    caption: 'One graph node and the tier legend, rendered from the same styling the canvas uses.',
                    annotation: doc(
                        'The dot and tint encode the tier. The legend below maps each colour to a layer: Shell, Presentation, Domain, Data, Infra.',
                    ),
                }),
            ),
            section(
                'Reference',
                'The three runtime layers',
                para(
                    'Under the graph, the Console itself is an Electron app: three cooperating layers in one window. ',
                    'Keeping them separate is what lets the renderer stay a plain React app while file reads and tool calls happen safely out of the page.',
                ),
                bullets([
                    doc(strong('Main'), ' owns the operating system: it opens the window, reads the repo, runs the GitHub CLI, and answers requests over IPC. It is the only layer with file and process access.'),
                    doc(strong('Preload'), ' exposes a small, typed bridge between main and the page. The renderer can only call the functions the bridge offers, which keeps the surface area honest and reviewable.'),
                    doc(strong('Renderer'), ' is the React 19, Vite, and Tailwind v4 app you are reading right now. It draws every panel and never touches the disk directly; it asks the bridge instead.'),
                ]),
            ),
            section(
                'Explanation',
                'Why it is split this way',
                para(
                    'The split keeps trust where it belongs. The page can be reloaded, swapped, or restyled without granting it OS access, and every action it can take is named in the bridge. ',
                    'If you want to know exactly what the Console is allowed to do, the bridge is the complete list.',
                ),
            ),
        ),
    },
    {
        path: '/docs/ai-fabric',
        title: 'AI fabric',
        group: 'Architecture',
        blurb: 'How agent calls flow through the Console without a chatbot widget.',
        lead: 'AI is a fabric, not a panel: classifiers, summarisers, and ranking models are spliced into the views that need them. The fabric exposes typed RPCs through the bridge, so the renderer never holds a long-lived agent session.',
    },
    {
        path: '/docs/conventions',
        title: 'Conventions',
        group: 'Reference',
        blurb: 'PanelHeader, IPC, Tailwind tokens, banned phrases.',
        lead: 'Every top-level panel uses PanelHeader. Every IPC is a four-file slice: main handler, preload bridge, typed renderer interface, useQuery hook. Every Tailwind token comes from the theme block in globals.css.',
        body: () => doc(
            section(
                'Explanation',
                'Conventions remove decisions',
                para(
                    'A few conventions keep the Console consistent from panel to panel. ',
                    'They are not style for its own sake; each one removes a decision so new work looks like old work and a reviewer knows where to look.',
                ),
            ),
            section(
                'Reference',
                'The four-file IPC slice',
                para('Any data the renderer needs travels the same four-step path, one small file per step.'),
                bullets([
                    doc(strong('Main handler'), ' does the actual work and returns a typed result.'),
                    doc(strong('Preload bridge'), ' exposes that handler to the page as a named function.'),
                    doc(strong('Renderer interface'), ' gives the page a typed view of the bridge function.'),
                    doc(strong('Query hook'), ' wraps the call so panels fetch, cache, and refetch the same way.'),
                ]),
                note(
                    'Skip a file and the compiler stops you',
                    'Adding a capability means adding all four files, in that order. Missing one breaks the type chain, which is the point: a half-wired feature fails the type check before it ships.',
                ),
            ),
            section(
                'Reference',
                'Tokens and copy',
                para(
                    'Every colour and size comes from the theme block in ',
                    code('globals.css'),
                    ', so a single accent colour stays single and status colours never bleed into navigation. ',
                    'Copy is held to the same bar: plain language, no filler, and a short list of banned phrases the review step rejects. ',
                    'The goal across both is that nothing on screen is arbitrary.',
                ),
            ),
        ),
    },
];

export function findDocByPath(path: string): ConsoleDocEntry | undefined {
    return CONSOLE_DOC_PAGES.find((p) => p.path === path);
}

export function findDocNeighbours(path: string): {
    prev?: { path: string; title: string };
    next?: { path: string; title: string };
} {
    const idx = CONSOLE_DOC_PAGES.findIndex((p) => p.path === path);
    if (idx < 0) return {};
    const prev = idx > 0 ? CONSOLE_DOC_PAGES[idx - 1] : undefined;
    const next = idx < CONSOLE_DOC_PAGES.length - 1 ? CONSOLE_DOC_PAGES[idx + 1] : undefined;
    return {
        prev: prev ? { path: prev.path, title: prev.title } : undefined,
        next: next ? { path: next.path, title: next.title } : undefined,
    };
}
