import { useEffect, useMemo, useRef, useState } from 'react';
import { Cable, GitBranch, Rocket, Loader2, FileWarning, Folder, FolderOpen, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { PanelHeader } from '../_shell/PanelHeader';
import { usePipelineDetect, usePipelineRuns } from '../../lib/queries/pipeline';
import { useProjectCapabilities } from '../../lib/queries/project';
import { bridge } from '../../lib/bridge';
import type { PipelineJob, PipelineWorkflow, WorkflowRun } from '../../lib/bridge';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { useRunner } from '../../lib/useRunner';
import { PipelineNewbie } from './PipelineNewbie';
import { pillFor, pillLabel, pillClasses, pillTooltip, asOf } from './runStatus';
import { Card, Button, EmptyState as UiEmptyState, Skeleton } from '@/components/ui';
import { cleanCopy } from '../../lib/humanize';

/**
 * Pipeline panel. Visualises CI/CD stages for the active project as a
 * horizontal node graph: source on the left, jobs in dependency order
 * in the middle, and an optional deploy node on the right when
 * vercel.json or netlify.toml is present.
 *
 * Edges are hand-rolled SVG cubic curves (no Magic UI dep), drawn as
 * static hairlines so the graph stays calm on a working surface.
 */

// Widened from 208 so common job/workflow labels render in full instead of
// truncating to an ellipsis fragment (paired with the wider wrapLabel budget).
const NODE_W = 256;
const NODE_H = 72;
const GAP_X = 96;
const GAP_Y = 18;
const PAD_X = 24;
const PAD_Y = 24;

// Acronyms that stay uppercased when we humanize a kebab/snake slug for
// display (e.g. "build-and-test" -> "Build and Test", "sbom-drc" -> "SBOM DRC").
const SLUG_ACRONYMS = new Set([
    'ci', 'cd', 'pr', 'sbom', 'drc', 'erc', 'cli', 'api', 'sdk', 'ui',
    'qa', 'e2e', 'url', 'yaml', 'json', 'pcb', 'mcp', 'os', 'vm',
]);
// Lowercased "stopwords" that read better un-capitalized mid-phrase.
const SLUG_LOWER = new Set(['and', 'or', 'to', 'of', 'the', 'a', 'an', 'on', 'in', 'for', 'with']);

/**
 * Humanize a raw kebab-case / snake_case slug (workflow or job id) for
 * display: split on "-"/"_", Title-case words, keep known acronyms
 * uppercased and small connector words lowercased. The first word is
 * always capitalized.
 */
export function humanizeSlug(slug: string): string {
    // Collapse leaked separators to a clean ": " before the slug split.
    // cleanCopy handles real em/en dashes; the regex below catches the
    // literal " -- " / "--" forms cleanCopy does not. Split each ": "
    // segment independently so the colon survives the dash-aware split.
    const cleaned = cleanCopy(slug).replace(/\s*--\s*/g, ': ');
    return cleaned
        .split(/\s*:\s*/)
        .filter(Boolean)
        .map((segment) => {
            const words = segment.split(/[-_]+/).filter(Boolean);
            return words
                .map((w, i) => {
                    const lower = w.toLowerCase();
                    if (SLUG_ACRONYMS.has(lower)) return lower.toUpperCase();
                    if (i > 0 && SLUG_LOWER.has(lower)) return lower;
                    return lower.charAt(0).toUpperCase() + lower.slice(1);
                })
                .join(' ');
        })
        .join(': ');
}

interface PositionedJob extends PipelineJob {
    col: number;
    row: number;
    x: number;
    y: number;
}

interface LayoutResult {
    nodes: PositionedJob[];
    columns: number;
    rowsPerCol: number[];
    width: number;
    height: number;
}

function layoutJobs(jobs: PipelineJob[]): LayoutResult {
    // Assign each job a column = 1 + max(col of needs). Jobs with no
    // needs sit in column 0.
    const colOf = new Map<string, number>();
    const ids = new Set(jobs.map((j) => j.id));
    // Iterate until stable (max depth = jobs.length).
    for (let pass = 0; pass < jobs.length + 1; pass++) {
        let changed = false;
        for (const j of jobs) {
            const valid = j.needs.filter((n) => ids.has(n));
            const c = valid.length === 0
                ? 0
                : Math.max(...valid.map((n) => (colOf.get(n) ?? 0) + 1));
            if (colOf.get(j.id) !== c) {
                colOf.set(j.id, c);
                changed = true;
            }
        }
        if (!changed) break;
    }
    const columns = jobs.length === 0 ? 0 : Math.max(...jobs.map((j) => colOf.get(j.id) ?? 0)) + 1;
    const rowsPerCol: number[] = Array.from({ length: columns }, () => 0);
    const nodes: PositionedJob[] = [];
    // Stable row assignment within each column.
    for (const j of jobs) {
        const col = colOf.get(j.id) ?? 0;
        const row = rowsPerCol[col]++;
        nodes.push({
            ...j,
            col,
            row,
            x: 0,
            y: 0,
        });
    }
    const rowMax = Math.max(1, ...rowsPerCol);
    // Slot positions: column 0 is column 1 in the rendered grid (source
    // takes column 0). We will offset x by 1 column when drawing.
    for (const n of nodes) {
        n.x = PAD_X + (n.col + 1) * (NODE_W + GAP_X);
        n.y = PAD_Y + n.row * (NODE_H + GAP_Y);
    }
    const width = PAD_X * 2 + (columns + 2) * (NODE_W + GAP_X);
    const height = PAD_Y * 2 + Math.max(NODE_H, rowMax * (NODE_H + GAP_Y) - GAP_Y);
    return { nodes, columns, rowsPerCol, width, height };
}

export function PipelinePanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <PipelineNewbie />;
    return <PipelineSeasoned />;
}

function PipelineSeasoned() {
    const { project, setProject } = useActiveProject();
    const projectRoot = project?.path ?? '';
    const detect = usePipelineDetect(projectRoot);
    const runs = usePipelineRuns(projectRoot);
    const capabilities = useProjectCapabilities(projectRoot);
    const [picking, setPicking] = useState(false);

    // gh-backed workflow triggers. One run per workflow path; the button
    // for a workflow is disabled while its trigger is in flight.
    const { start, runs: triggerRuns } = useRunner();
    const qc = useQueryClient();
    const [triggerIds, setTriggerIds] = useState<Record<string, string>>({});
    const ciAvailable = capabilities.data?.hasCiWorkflows ?? false;

    const notified = useRef<Set<string>>(new Set());
    useEffect(() => {
        for (const r of triggerRuns) {
            if (r.status === 'running' || notified.current.has(r.runId)) continue;
            notified.current.add(r.runId);
            if (r.status === 'done') toast.success(`${r.label} dispatched.`);
            else if (r.status === 'failed') toast.error(`${r.label} failed to dispatch.`);
            // Refresh live run status so the dispatched run shows up.
            void qc.invalidateQueries({ queryKey: ['pipeline', 'runs', projectRoot] });
        }
    }, [triggerRuns, qc, projectRoot]);

    async function triggerWorkflow(wf: PipelineWorkflow) {
        const activeId = triggerIds[wf.path];
        const active = activeId ? triggerRuns.find((r) => r.runId === activeId) : undefined;
        if (active?.status === 'running') return; // single-fire guard
        const runId = await start({
            kind: 'gh',
            args: ['workflow', 'run', wf.path],
            cwd: projectRoot || undefined,
            label: `Trigger ${wf.name}`,
        });
        setTriggerIds((prev) => ({ ...prev, [wf.path]: runId }));
    }

    function triggerState(wf: PipelineWorkflow): 'idle' | 'running' {
        const id = triggerIds[wf.path];
        const run = id ? triggerRuns.find((r) => r.runId === id) : undefined;
        return run?.status === 'running' ? 'running' : 'idle';
    }

    const data = detect.data;
    const noRoot = !projectRoot || (!detect.isLoading && (!data || !data.project_root));
    const runsUnavailable = runs.data && runs.data.available === false ? runs.data.reason : null;
    const asOfStamp = runs.data?.available ? asOf(runs.dataUpdatedAt) : '';

    async function pickFolder() {
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
        <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="pipeline-panel">
            <PanelHeader
                icon={Cable}
                title="Pipeline"
                subtitle="CI/CD stage graph from your workflow files"
                testid="pipeline-panel-header"
            >
                {projectRoot && (
                    <code className="hidden max-w-[12rem] truncate rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-label text-muted-foreground sm:inline-block lg:max-w-[20rem]" title={projectRoot}>
                        {projectRoot}
                    </code>
                )}
                {asOfStamp && (
                    <span className="hidden text-label tabular-nums text-muted-foreground sm:inline-block" data-testid="pipeline-as-of">
                        {asOfStamp}
                    </span>
                )}
                <Button
                    variant="secondary"
                    size="sm"
                    data-testid="pipeline-pick-folder"
                    onClick={pickFolder}
                    disabled={picking}
                >
                    {picking ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
                    {projectRoot ? 'Change' : 'Pick a folder'}
                </Button>
            </PanelHeader>

            {detect.isLoading && projectRoot && (
                <div className="p-6" data-testid="pipeline-loading">
                    <Card className="gap-2 p-4 shadow-none">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </Card>
                </div>
            )}

            {detect.isError && projectRoot && (
                <EmptyState
                    icon={FileWarning}
                    title="Failed to read workflows."
                    body="Something went wrong while scanning .github/workflows. Try again."
                    action={
                        <Button
                            variant="secondary"
                            size="sm"
                            data-testid="pipeline-error-retry"
                            onClick={() => detect.refetch()}
                        >
                            Retry
                        </Button>
                    }
                />
            )}

            {noRoot && (
                <EmptyState
                    icon={Folder}
                    title="No project connected"
                    body="Pick a folder to scan its .github/workflows for CI/CD stages."
                    action={
                        <Button
                            variant="default"
                            size="sm"
                            data-testid="pipeline-empty-pick"
                            onClick={pickFolder}
                            disabled={picking}
                        >
                            {picking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                            Pick a folder
                        </Button>
                    }
                />
            )}

            {data && data.project_root && data.workflows.length === 0 && (
                <EmptyState
                    icon={FileWarning}
                    title="No workflows found yet."
                    body="Add .github/workflows/<name>.yml to your repo to see CI/CD stages here."
                />
            )}

            {data && data.workflows.length > 0 && (
                <div className="flex flex-col gap-8 p-6">
                    {runsUnavailable && (
                        <p className="text-small text-muted-foreground" data-testid="pipeline-runs-unavailable">
                            Live run status unavailable: {runsUnavailable}.
                        </p>
                    )}
                    {data.workflows.map((wf) => (
                        <WorkflowSection
                            key={wf.path}
                            workflow={wf}
                            run={runs.data?.latestByWorkflow[wf.name]}
                            deploy={data.vercelDetected ? 'vercel' : data.netlifyDetected ? 'netlify' : null}
                            canTrigger={ciAvailable}
                            triggering={triggerState(wf) === 'running'}
                            onTrigger={() => { void triggerWorkflow(wf); }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function EmptyState({ icon: Icon, title, body, action }: {
    icon: typeof Folder;
    title: string;
    body: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-1 items-center justify-center p-12" data-testid="pipeline-empty">
            <UiEmptyState icon={Icon} title={title} action={action} className="max-w-md border-none p-0">
                {body}
            </UiEmptyState>
        </div>
    );
}

function WorkflowSection({ workflow, run, deploy, canTrigger, triggering, onTrigger }: {
    workflow: PipelineWorkflow;
    run?: WorkflowRun;
    deploy: 'vercel' | 'netlify' | null;
    canTrigger: boolean;
    triggering: boolean;
    onTrigger: () => void;
}) {
    const pill = pillFor(run);
    const layout = useMemo(() => layoutJobs(workflow.jobs), [workflow.jobs]);
    const hasJobs = workflow.jobs.length > 0;
    const ids = new Set(workflow.jobs.map((j) => j.id));
    // Terminal jobs = jobs that no other job needs.
    const neededBy = new Set<string>();
    for (const j of workflow.jobs) {
        for (const n of j.needs) if (ids.has(n)) neededBy.add(n);
    }
    const terminalJobs = workflow.jobs.filter((j) => !neededBy.has(j.id));

    // Source node sits at column -1 (visual column 0), vertically centered.
    const sourceX = PAD_X;
    const sourceY = PAD_Y + (layout.height - PAD_Y * 2 - NODE_H) / 2;
    const deployX = PAD_X + (layout.columns + 1) * (NODE_W + GAP_X);
    const deployY = sourceY;

    const svgWidth = Math.max(layout.width, deployX + NODE_W + PAD_X);
    const svgHeight = layout.height;

    return (
        <section className="flex flex-col gap-3" data-testid={`pipeline-wf-${workflow.path}`}>
            <header className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-card-title text-foreground" title={workflow.name}>{humanizeSlug(workflow.name)}</h2>
                {pill && run && (
                    <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-label font-medium ${pillClasses(pill)}`}
                        title={pillTooltip(run)}
                        data-testid={`pipeline-wf-pill-${workflow.path}`}
                    >
                        {pillLabel(pill)}
                    </span>
                )}
                <span className="font-mono text-label text-muted-foreground">{workflow.path}</span>
                <Button
                    variant="secondary"
                    size="xs"
                    className="ml-auto self-center"
                    data-testid={`pipeline-wf-trigger-${workflow.path}`}
                    disabled={!canTrigger || triggering}
                    title={canTrigger ? undefined : 'GitHub CLI or CI workflows not available'}
                    onClick={onTrigger}
                >
                    {triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {triggering ? 'Triggering.' : 'Trigger'}
                </Button>
            </header>

            {workflow.triggers.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {workflow.triggers.map((t) => (
                        <span
                            key={t}
                            className="inline-flex items-center rounded-sm bg-secondary px-1.5 py-0.5 text-label font-medium text-muted-foreground"
                            title={t}
                        >
                            {humanizeSlug(t)}
                        </span>
                    ))}
                </div>
            )}

            {!hasJobs && (
                <p className="text-small text-muted-foreground">No jobs declared in this workflow.</p>
            )}

            {hasJobs && (
                <Card className="overflow-x-auto p-3 shadow-none">
                    <svg
                        width={svgWidth}
                        height={svgHeight}
                        className="text-foreground"
                        role="img"
                        aria-label={`Pipeline graph for ${workflow.name}`}
                    >
                        {/* Edges: source -> root jobs */}
                        {layout.nodes.filter((n) => n.col === 0).map((n) => (
                            <Beam
                                key={`src-${n.id}`}
                                x1={sourceX + NODE_W}
                                y1={sourceY + NODE_H / 2}
                                x2={n.x}
                                y2={n.y + NODE_H / 2}
                            />
                        ))}
                        {/* Edges: job -> dependent job */}
                        {layout.nodes.flatMap((dependent) =>
                            dependent.needs.filter((nId) => ids.has(nId)).map((nId) => {
                                const src = layout.nodes.find((m) => m.id === nId);
                                if (!src) return null;
                                return (
                                    <Beam
                                        key={`${src.id}-${dependent.id}`}
                                        x1={src.x + NODE_W}
                                        y1={src.y + NODE_H / 2}
                                        x2={dependent.x}
                                        y2={dependent.y + NODE_H / 2}
                                    />
                                );
                            })
                        )}
                        {/* Edges: terminal jobs -> deploy */}
                        {deploy && terminalJobs.map((t) => {
                            const src = layout.nodes.find((m) => m.id === t.id);
                            if (!src) return null;
                            return (
                                <Beam
                                    key={`${src.id}-deploy`}
                                    x1={src.x + NODE_W}
                                    y1={src.y + NODE_H / 2}
                                    x2={deployX}
                                    y2={deployY + NODE_H / 2}
                                />
                            );
                        })}

                        {/* Source node */}
                        <EndpointNode
                            x={sourceX}
                            y={sourceY}
                            icon="source"
                            label="Source"
                            sub="git push"
                        />
                        {/* Job nodes */}
                        {layout.nodes.map((n) => (
                            <JobNode key={n.id} node={n} />
                        ))}
                        {/* Deploy node */}
                        {deploy && (
                            <EndpointNode
                                x={deployX}
                                y={deployY}
                                icon="deploy"
                                label="Deploy"
                                sub={deploy === 'vercel' ? 'vercel.json' : 'netlify.toml'}
                            />
                        )}
                    </svg>
                </Card>
            )}
        </section>
    );
}

// A static neutral connector. Ambient motion is banned on working surfaces
// (design direction section 9), so the edge is a quiet hairline curve, not an
// animated beam.
function Beam({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
    const mx = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    return (
        <path
            d={d}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.22"
            strokeWidth={1.5}
        />
    );
}

type JobStatus = 'success' | 'failed' | 'running';

const JOB_STATUS_STYLE: Record<JobStatus, { dot: string; ring: string }> = {
    success: { dot: 'fill-success', ring: 'stroke-success/50' },
    failed:  { dot: 'fill-danger',  ring: 'stroke-danger/50' },
    running: { dot: 'fill-warning', ring: 'stroke-warning/50' },
};

function JobNode({ node, status }: { node: PositionedJob; status?: JobStatus }) {
    // When no real run status is available we render a clean rect with
    // no dot, rather than a grey "idle" dot that reads as broken
    // telemetry. The dot lights up once a status prop is plumbed in.
    const style = status ? JOB_STATUS_STYLE[status] : null;
    const ringClass = style ? style.ring : 'stroke-border';
    const displayName = humanizeSlug(node.name);
    // Wrap the label across up to 2 lines (~34 chars each at 12px semibold in
    // NODE_W=256), so common job names render in full instead of an ellipsis.
    // Overflow past two lines still truncates. The SVG <title> keeps the full
    // raw name for hover.
    const labelLines = wrapLabel(displayName, 34, 2);
    return (
        <g data-testid={`pipeline-job-${node.id}`} data-status={status ?? 'unknown'}>
            <title>{node.name}</title>
            <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                className={`fill-card ${ringClass}`}
                strokeWidth={1}
            />
            {style && (
                <circle
                    cx={node.x + NODE_W - 12}
                    cy={node.y + 12}
                    r={3.5}
                    className={style.dot}
                />
            )}
            {labelLines.map((line, i) => (
                <text
                    key={i}
                    x={node.x + 12}
                    y={node.y + 22 + i * 15}
                    className="fill-foreground"
                    fontSize={12}
                    fontWeight={600}
                >
                    {line}
                </text>
            ))}
            <text
                x={node.x + 12}
                y={node.y + NODE_H - 12}
                className="fill-muted-foreground"
                fontSize={10.5}
            >
                {truncate(node.runs_on, 38)}
            </text>
        </g>
    );
}

/**
 * Greedily wrap `text` into at most `maxLines` lines of roughly `perLine`
 * characters each. The final line is ellipsized if content remains. A
 * single word longer than `perLine` is hard-truncated rather than dropped.
 */
function wrapLabel(text: string, perLine: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= perLine) {
            current = candidate;
            continue;
        }
        if (current) lines.push(current);
        current = word;
        if (lines.length === maxLines - 1) break;
    }
    if (current && lines.length < maxLines) lines.push(current);
    // If words remain unconsumed (we hit the line cap), mark overflow on
    // the last line.
    const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
    if (consumed < words.length && lines.length > 0) {
        const last = lines[lines.length - 1];
        lines[lines.length - 1] = truncate(last + ' ...', perLine);
    } else if (lines.length > 0) {
        lines[lines.length - 1] = truncate(lines[lines.length - 1], perLine);
    }
    return lines.length > 0 ? lines : [truncate(text, perLine)];
}

function EndpointNode({ x, y, icon, label, sub }: {
    x: number; y: number; icon: 'source' | 'deploy'; label: string; sub: string;
}) {
    const Icon = icon === 'source' ? GitBranch : Rocket;
    return (
        <g>
            <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                className="fill-secondary stroke-border"
                strokeWidth={1}
            />
            <foreignObject x={x + 10} y={y + 10} width={20} height={20}>
                <Icon className="h-4 w-4 text-foreground" />
            </foreignObject>
            <text
                x={x + 36}
                y={y + 24}
                className="fill-foreground"
                fontSize={12}
                fontWeight={600}
            >
                {label}
            </text>
            <text
                x={x + 36}
                y={y + 40}
                className="fill-muted-foreground"
                fontSize={10.5}
            >
                {sub}
            </text>
        </g>
    );
}

function truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '...';
}
