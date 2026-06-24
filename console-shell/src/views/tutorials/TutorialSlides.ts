import type { LucideIcon } from 'lucide-react';
import {
    LayoutDashboard, FileText, Network, Workflow, ShieldCheck, Plug, Sparkles, Rocket,
} from 'lucide-react';
import type { Persona } from '../../lib/persona';

import overviewLight from '../../assets/tour/overview-light.png';
import overviewDark from '../../assets/tour/overview-dark.png';
import reportLight from '../../assets/tour/report-light.png';
import reportDark from '../../assets/tour/report-dark.png';
import architectureLight from '../../assets/tour/architecture-light.png';
import architectureDark from '../../assets/tour/architecture-dark.png';
import pipelineLight from '../../assets/tour/pipeline-light.png';
import pipelineDark from '../../assets/tour/pipeline-dark.png';
import repoLight from '../../assets/tour/repo-light.png';
import repoDark from '../../assets/tour/repo-dark.png';
import servicesLight from '../../assets/tour/services-light.png';
import servicesDark from '../../assets/tour/services-dark.png';
import promptsLight from '../../assets/tour/prompts-light.png';
import promptsDark from '../../assets/tour/prompts-dark.png';
import releaseLight from '../../assets/tour/release-light.png';
import releaseDark from '../../assets/tour/release-dark.png';

/**
 * Content model for the "Walk through" feature carousel. Each slide names one
 * real Console surface and carries a light + dark screenshot of it (captured on
 * the generic northwind-saas demo - no personal data). The set is PER-PERSONA:
 * Operator sees the full feature tour with feature-forward copy; Guided sees a
 * shorter, outcome-led essentials tour. FeatureTour picks the set via slidesFor.
 */
export type TutorialSlide = {
    id: string;
    icon: LucideIcon;
    title: string;
    body: string;
    light: string;
    dark: string;
};

// Operator: the full surface, described feature-first and technically.
export const OPERATOR_SLIDES: TutorialSlide[] = [
    {
        id: 'overview', icon: LayoutDashboard,
        title: 'Operate from one cockpit',
        body: 'Overview rolls up release gates, CI, test and eval runs, recent activity, and AI spend for the open project. One read tells you what is green and what is blocking a ship.',
        light: overviewLight, dark: overviewDark,
    },
    {
        id: 'report', icon: FileText,
        title: 'A deep read of any repo',
        body: 'Report maps the stack, packages, run scripts, health, and services straight from the files. Point it at a repo and get a structured profile in seconds, no AI required.',
        light: reportLight, dark: reportDark,
    },
    {
        id: 'architecture', icon: Network,
        title: 'See the dependency graph',
        body: 'Architecture extracts imports live and lays packages out by tier. Toggle external deps, edit the layout, and read what depends on what before you refactor.',
        light: architectureLight, dark: architectureDark,
    },
    {
        id: 'pipeline', icon: Workflow,
        title: 'Read your CI/CD stages',
        body: 'Pipeline parses your .github/workflows into a stage graph per workflow: triggers, jobs, and runners at a glance, with live run status once a remote is wired.',
        light: pipelineLight, dark: pipelineDark,
    },
    {
        id: 'repo', icon: ShieldCheck,
        title: 'Audit before you ship',
        body: 'Repo scores project setup, dependency health, and exposed secrets, and surfaces the files changing most. Every gap comes with a one-click fix prompt for your dev tool.',
        light: repoLight, dark: repoDark,
    },
    {
        id: 'services', icon: Plug,
        title: 'Connect and deploy in place',
        body: 'Services links GitHub, Vercel, Sentry, and more from one panel. Connect Vercel and deploy the open project with zero config, straight from Console, no browser tabs.',
        light: servicesLight, dark: servicesDark,
    },
    {
        id: 'prompts', icon: Sparkles,
        title: 'Route prompts to your dev tool',
        body: 'The prompt library holds reusable, variable-filled templates. Fill one, then copy it, send it to your AI, or write .cursorrules / AGENTS.md and run it in Claude Code or Cursor.',
        light: promptsLight, dark: promptsDark,
    },
    {
        id: 'release', icon: Rocket,
        title: 'Gate every release',
        body: 'Release collects compliance and readiness gates into one call: CI, a clean tree, a pushed branch, env vars, and more. Ship only when the readiness ring is green.',
        light: releaseLight, dark: releaseDark,
    },
];

// Guided: the four essentials that carry a newcomer from "I have code" to
// "it is live", described by outcome rather than by feature.
export const GUIDED_SLIDES: TutorialSlide[] = [
    {
        id: 'overview', icon: LayoutDashboard,
        title: 'Start here every day',
        body: 'Overview is your home base. It shows what is healthy, what needs attention, and what to do next, so you always know where your project stands before you touch anything.',
        light: overviewLight, dark: overviewDark,
    },
    {
        id: 'repo', icon: ShieldCheck,
        title: 'Check it is ready to ship',
        body: 'Repo looks for the things a finished project needs: a license, a readme, no exposed secrets, healthy dependencies. Each missing piece comes with a fix you can hand to your AI tool.',
        light: repoLight, dark: repoDark,
    },
    {
        id: 'services', icon: Plug,
        title: 'Connect a host and go live',
        body: 'Services is where you link the tools your app uses. Connect Vercel and Console can deploy your project for you, with no setup, no config files, and no extra browser tabs.',
        light: servicesLight, dark: servicesDark,
    },
    {
        id: 'prompts', icon: Sparkles,
        title: 'Get unstuck with AI',
        body: 'Stuck on an error or a feature? Pick a prompt, fill in the blanks, and send it to your AI assistant or straight into Cursor or Claude Code with your project already in context.',
        light: promptsLight, dark: promptsDark,
    },
];

export function slidesFor(persona: Persona): TutorialSlide[] {
    return persona === 'newbie' ? GUIDED_SLIDES : OPERATOR_SLIDES;
}
