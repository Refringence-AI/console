import { createMemoryRouter, Navigate } from 'react-router';
import { ConsoleShell } from './views/_shell/ConsoleShell';
import { OverviewPanel } from './views/overview/OverviewPanel';
import { IssuesPanel } from './views/issues/IssuesPanel';
import { DocsPanel } from './views/docs/DocsPanel';
import { RepoPanel } from './views/repo/RepoPanel';
import { ArchPanel } from './views/arch/ArchPanel';
import { ObservabilityPanel } from './views/observability/ObservabilityPanel';
import { ReleasePanel } from './views/release/ReleasePanel';
import { ServicesPanel } from './views/services/ServicesPanel';
import { ActivityPanel } from './views/activity/ActivityPanel';
import { PipelinePanel } from './views/pipeline/PipelinePanel';
import { TutorialsPanel } from './views/tutorials/TutorialsPanel';
import { SettingsPanel } from './views/settings/SettingsPanel';
import { LibraryPanel } from './views/library/LibraryPanel';
import { PromptLibraryPanel } from './views/prompts/PromptLibraryPanel';
import { AiPanel } from './views/ai/AiPanel';
import { ProjectReport } from './views/intel/ProjectReport';
import { GuidedStepsDemo } from './views/_shell/GuidedStepsDemo';
import { OnboardingWizard } from './views/welcome/OnboardingWizard';
import { readPersona } from './lib/persona';
import { readActiveProject, writeActiveProject } from './lib/activeProject';
import { readOnboardedForWindow } from './lib/onboardedWindow';

// A project path passed on the window URL (?project=) - from the `console <path>`
// CLI launcher or a second-instance open (main.ts puts it on the window URL).
// Adopt it as this window's active project so we boot straight to the overview,
// skipping onboarding. URLSearchParams decodes the percent-encoding for us.
const bootProject = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('project')
    : null;
if (bootProject) {
    try { writeActiveProject(bootProject); } catch { /* ignore a bad path */ }
}

// First-launch routing, decided PER WINDOW. The wizard runs on a true first
// launch (no persona) AND for any window that has neither its own active
// project nor its own finished onboarding - so a brand-new window shows the
// landing even if the user onboarded earlier in another window. The GLOBAL
// onboarded flag is intentionally NOT consulted here (consulting it was the
// bug: it short-circuited the per-window check). The seeded test/capture path
// sets an active project per window, so it still boots into /overview.
const onboarded = bootProject != null || (readPersona() != null
    && (readActiveProject() != null || readOnboardedForWindow()));
const initialPath = onboarded ? '/overview' : '/welcome';

export const router = createMemoryRouter(
    [
        // Onboarding lives OUTSIDE the ConsoleShell so the sidebar and
        // panel chrome don't render during the first-run wizard. The old
        // /welcome/{tour,walkthrough,connect} sub-routes folded into it.
        { path: '/welcome',          element: <OnboardingWizard /> },
        { path: '/welcome/*',        element: <Navigate to="/welcome" replace /> },

        {
            path: '/',
            element: <ConsoleShell />,
            children: [
                { index: true, element: <Navigate to="/overview" replace /> },
                { path: 'overview/*',      element: <OverviewPanel /> },
                { path: 'report/*',        element: <ProjectReport /> },
                { path: 'issues/*',        element: <IssuesPanel /> },
                { path: 'docs/*',          element: <DocsPanel /> },
                { path: 'repo/*',          element: <RepoPanel /> },
                { path: 'arch/*',          element: <ArchPanel /> },
                { path: 'observability/*', element: <ObservabilityPanel /> },
                // Evals + Metrics folded into Observability + Overview; keep
                // old links and Ctrl+K shortcuts from 404-ing.
                { path: 'evals/*',         element: <Navigate to="/observability" replace /> },
                { path: 'metrics/*',       element: <Navigate to="/observability" replace /> },
                { path: 'release/*',       element: <ReleasePanel /> },
                { path: 'services/*',      element: <ServicesPanel /> },
                { path: 'activity/*',      element: <ActivityPanel /> },
                { path: 'pipeline/*',      element: <PipelinePanel /> },
                { path: 'tutorials/*',     element: <TutorialsPanel /> },
                { path: 'settings/*',      element: <SettingsPanel /> },
                { path: 'library/*',       element: <LibraryPanel /> },
                { path: 'prompts/*',       element: <PromptLibraryPanel /> },
                { path: 'ai/*',            element: <AiPanel /> },
                // Demo-only route for the reusable GuidedSteps shell; real
                // Guided-mode panels reuse the component in later phases.
                { path: 'guided-demo',     element: <GuidedStepsDemo /> },
            ],
        },
    ],
    { initialEntries: [initialPath] },
);
