import { Cable, Loader2, FolderOpen } from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { usePipelineDetect, usePipelineRuns } from '../../lib/queries/pipeline';
import { bridge } from '../../lib/bridge';
import type { PipelineWorkflow } from '../../lib/bridge';
import { useActiveProject } from '../../lib/activeProject';
import { useState } from 'react';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { pillFor, pillLabel, pillClasses, pillTooltip } from './runStatus';
import { humanizeSlug } from './PipelinePanel';
import { Card, Button } from '@/components/ui';

/**
 * Newbie-mode Pipeline.
 *
 * Single column with one card per workflow. Each card explains in plain
 * English what the workflow does, shows a status pill, and links to the
 * dense seasoned view for details. No SVG graph, no YAML paths.
 */

/**
 * One plain sentence: what kicks the workflow off (its real triggers) and
 * what it then does (its real jobs). Both halves come from the workflow
 * object, so two cards only read alike when their triggers and jobs truly
 * match. The verb is nudged by the workflow's name/path when we recognise
 * a common kind (tests, lint, release, ...), but the trigger phrase always
 * grounds the sentence in this workflow's actual events.
 */
function explainer(workflow: PipelineWorkflow): string {
    const when = triggerPhrase(workflow.triggers);
    const does = jobPhrase(workflow);
    if (when && does) return `${capitalize(when)}, it ${does}.`;
    if (does) return `It ${does}.`;
    if (when) return `Runs ${when}.`;
    return 'Runs when its workflow file says to.';
}

/** Map GitHub event keys to a readable "when" clause for this workflow. */
function triggerPhrase(triggers: string[]): string {
    const set = new Set(triggers.map((t) => t.toLowerCase()));
    const parts: string[] = [];
    if (set.has('push')) parts.push('on every push');
    if (set.has('pull_request') || set.has('pull_request_target')) parts.push('on pull requests');
    if (set.has('schedule')) parts.push('on a schedule');
    if (set.has('release')) parts.push('when a release is published');
    if (set.has('workflow_dispatch')) parts.push('when started by hand');
    if (set.has('workflow_call')) parts.push('when another workflow calls it');
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * A verb phrase for what the workflow does, derived from its job names with
 * a nudge from the workflow's own name/path. Mentions a couple of real job
 * names so cards with the same kind but different jobs still differ.
 */
function jobPhrase(workflow: PipelineWorkflow): string {
    const lower = `${workflow.name} ${workflow.path}`.toLowerCase();
    const jobNames = workflow.jobs.map((j) => j.name || j.id);
    const named = jobNames.slice(0, 2).map(humanizeSlug).join(' and ');
    const count = workflow.jobs.length;

    let verb = '';
    if (lower.includes('compliance')) verb = 'scans for secrets and license issues';
    else if (lower.includes('release') || lower.includes('publish')) verb = 'cuts a release';
    else if (lower.includes('deploy')) verb = 'deploys the app';
    else if (lower.includes('lint') || lower.includes('format')) verb = 'checks code style';
    else if (lower.includes('docs')) verb = 'builds the documentation';
    else if (lower.includes('qa')) verb = 'runs the UI grading checks';
    else if (lower.includes('test')) verb = 'runs the test suite';
    else if (/\bci\b/.test(lower) || lower.includes('ci.yml')) verb = 'builds and tests the repo';

    if (verb && named) return `${verb} across ${named}`;
    if (verb) return verb;
    if (named) return `runs ${named}`;
    if (count > 0) return `runs ${count} ${count === 1 ? 'job' : 'jobs'}`;
    return '';
}

function capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function PipelineNewbie() {
    const { project, setProject } = useActiveProject();
    const { setPersona } = usePersonaMode();
    const projectRoot = project?.path ?? '';
    const detect = usePipelineDetect(projectRoot);
    const runs = usePipelineRuns(projectRoot);
    const [picking, setPicking] = useState(false);

    const data = detect.data;
    const noRoot = !projectRoot || (!detect.isLoading && (!data || !data.project_root));

    async function pickFolder() {
        setPicking(true);
        try {
            const result = await bridge.project.pickFolder();
            if (!result.canceled && result.path) setProject(result.path);
        } finally {
            setPicking(false);
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="pipeline-newbie">
            <PanelHeader
                icon={Cable}
                title="Pipeline"
                subtitle="CI workflows that run on every push"
                testid="pipeline-newbie-header"
            />

            <div className="flex-1 overflow-y-auto px-6 py-8">
                <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8">
                    {detect.isLoading && projectRoot && (
                        <p className="text-body text-muted-foreground" data-testid="pipeline-newbie-loading">
                            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                            Scanning workflows.
                        </p>
                    )}

                    {noRoot && (
                        <Card className="gap-4 p-5">
                            <h2 className="text-section text-foreground">
                                Pick a folder to start
                            </h2>
                            <p className="text-body leading-relaxed text-muted-foreground">
                                Pipeline reads your CI workflows from the active project.
                            </p>
                            <Button
                                variant="default"
                                onClick={pickFolder}
                                disabled={picking}
                                className="w-fit"
                                data-testid="pipeline-newbie-pick-folder"
                            >
                                {picking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                                Pick a folder
                            </Button>
                        </Card>
                    )}

                    {data && data.project_root && data.workflows.length === 0 && (
                        <Card className="gap-2 p-5">
                            <h2 className="text-section text-foreground">
                                No workflows found
                            </h2>
                            <p className="text-body leading-relaxed text-muted-foreground">
                                Add a .github/workflows/&lt;name&gt;.yml file to your repo and CI steps will show up here.
                            </p>
                        </Card>
                    )}

                    {data && data.workflows.length > 0 && (
                        <section className="flex flex-col gap-4">
                            {data.workflows.slice(0, 6).map((wf) => {
                                const run = runs.data?.latestByWorkflow[wf.name];
                                const pill = pillFor(run);
                                return (
                                    <Card
                                        key={wf.path}
                                        data-testid={`pipeline-newbie-wf-${wf.path}`}
                                        className="gap-3 p-5 shadow-none"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <h3 className="text-card-title text-foreground" title={wf.name}>
                                                {humanizeSlug(wf.name)}
                                            </h3>
                                            {pill && run && (
                                                <span
                                                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-label font-medium ${pillClasses(pill)}`}
                                                    title={pillTooltip(run)}
                                                >
                                                    {pillLabel(pill)}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-body leading-relaxed text-muted-foreground">
                                            {explainer(wf)}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setPersona('seasoned')}
                                            className="inline-flex w-fit items-center text-small font-medium text-foreground hover:underline"
                                        >
                                            See details
                                        </button>
                                    </Card>
                                );
                            })}
                        </section>
                    )}

                    <footer className="border-t border-border pt-6">
                        <Button
                            variant="link"
                            size="sm"
                            onClick={() => setPersona('seasoned')}
                            className="px-0"
                            data-testid="pipeline-newbie-switch-power"
                        >
                            Switch to Operator view
                        </Button>
                    </footer>
                </div>
            </div>
        </div>
    );
}
