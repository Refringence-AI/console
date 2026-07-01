import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ReactFlow, Background, Controls, Handle, Position,
    useNodesInitialized, useReactFlow,
    type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import { ScanText, X, FileCode2, Network } from 'lucide-react';
import { bridge, type SystemDiagram, type SystemNode } from '../../lib/bridge';
import { useProjectProfile, useEnrich } from '../../lib/queries/intel';
import { Card, Button, Badge, EmptyState } from '../../components/ui';
import { cn } from '../../lib/utils';

/**
 * Systems view: the AI-generated SEMANTIC architecture (named systems mapped to
 * real repo paths), rendered as a ReactFlow graph. This is the gitdiagram-style
 * "how the project actually fits together" picture, distinct from the package
 * dependency graph (the Code view). Every node's paths were validated against
 * the real tree main-side, so clicking a path opens real code.
 */

// System kind -> token-palette styling. One accent + neutrals, no rainbow.
const KIND_STYLE: Record<string, { border: string; tint: string; dot: string }> = {
    frontend: { border: 'border-accent-solid', tint: 'bg-accent-subtle', dot: 'bg-accent-solid' },
    backend: { border: 'border-info/50', tint: 'bg-info/10', dot: 'bg-info' },
    data: { border: 'border-warning/50', tint: 'bg-warning/10', dot: 'bg-warning' },
    service: { border: 'border-foreground/40', tint: 'bg-foreground/5', dot: 'bg-foreground' },
    infra: { border: 'border-border', tint: 'bg-muted/40', dot: 'bg-muted-foreground' },
    shared: { border: 'border-border', tint: 'bg-muted/30', dot: 'bg-muted-foreground' },
    docs: { border: 'border-border border-dashed', tint: 'bg-background', dot: 'bg-muted-foreground/60' },
    tests: { border: 'border-border border-dashed', tint: 'bg-background', dot: 'bg-muted-foreground/60' },
};
const kindStyle = (k: string) => KIND_STYLE[k] ?? KIND_STYLE.shared;

const NODE_W = 230;
const NODE_H = 64;
const elk = new ELK();

interface SysNodeData extends Record<string, unknown> {
    label: string;
    kind: string;
    pathCount: number;
    selected: boolean;
    dimmed: boolean;
    isOrphan: boolean;
    fanIn: number;
    fanOut: number;
}
type SysFlowNode = Node<SysNodeData, 'system'>;

function SystemNodeCard({ data }: NodeProps<SysFlowNode>) {
    const style = kindStyle(data.kind);
    const coupled = data.fanIn + data.fanOut > 0;
    return (
        <div
            style={{ width: NODE_W, height: NODE_H }}
            className={cn(
                'overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm transition-opacity',
                // An orphan (no real import crosses its boundary) reads as dashed
                // and standalone, so it is legibly intentional, not broken.
                data.isOrphan ? 'border-dashed border-border' : style.border,
                style.tint,
                data.dimmed ? 'opacity-25' : 'opacity-100',
                data.selected ? 'ring-2 ring-accent-solid' : '',
            )}
        >
            <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground" />
            <div className="flex min-w-0 items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden />
                <span className="truncate text-card-title text-foreground">{data.label}</span>
                {data.isOrphan && (
                    <span className="ml-auto shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-label text-muted-foreground">standalone</span>
                )}
            </div>
            <p className="mt-0.5 flex items-center gap-1 pl-4 text-small text-muted-foreground">
                <span>{data.kind} · {data.pathCount} path{data.pathCount === 1 ? '' : 's'}</span>
                {coupled && <span className="tabular-nums opacity-70">· in {data.fanIn} out {data.fanOut}</span>}
            </p>
            <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground" />
        </div>
    );
}
const NODE_TYPES = { system: SystemNodeCard };

// A linked-system row in the detail sidebar: the related system, the relationship
// label, and whether the link is a real import (detected) or an AI inference.
function SystemLinkRow({ label, rel, detected, onClick }: { label: string; rel: string; detected: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left hover:border-accent-solid">
            <span className="flex min-w-0 items-center gap-1.5">
                <Network className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-label text-foreground/80">{label}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
                {rel && <span className="text-label text-muted-foreground">{rel}</span>}
                <span className={cn('rounded px-1.5 py-0.5 text-label', detected ? 'bg-accent-subtle text-foreground' : 'bg-muted/60 text-muted-foreground')}>
                    {detected ? 'import' : 'inferred'}
                </span>
            </span>
        </button>
    );
}

function FitOnInit({ signal }: { signal: number }) {
    const initialized = useNodesInitialized();
    const { fitView } = useReactFlow();
    useEffect(() => { if (initialized) void fitView({ padding: 0.2 }); }, [initialized, fitView, signal]);
    return null;
}

async function layout(diagram: SystemDiagram): Promise<Map<string, { x: number; y: number }>> {
    const graph = {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered', 'elk.direction': 'DOWN',
            'elk.layered.spacing.nodeNodeBetweenLayers': '72', 'elk.spacing.nodeNode': '44',
        },
        children: diagram.nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
        edges: diagram.edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
    };
    const out = new Map<string, { x: number; y: number }>();
    try {
        const res = await elk.layout(graph);
        for (const c of (res.children ?? []) as { id: string; x?: number; y?: number }[]) {
            out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
        }
    } catch {
        diagram.nodes.forEach((n, i) => out.set(n.id, { x: (i % 4) * (NODE_W + 44), y: Math.floor(i / 4) * (NODE_H + 72) }));
    }
    return out;
}

export function SystemsView({ root }: { root: string }) {
    const profileQuery = useProjectProfile(root);
    const enrich = useEnrich(root);
    const diagram = profileQuery.data?.ai?.systemDiagram ?? null;
    const enrichError = enrich.data && !enrich.data.ok ? (enrich.data.error ?? 'AI enrichment failed') : null;

    const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (!diagram || diagram.nodes.length === 0) { setPositions(new Map()); return; }
        void layout(diagram).then((p) => { if (!cancelled) setPositions(p); });
        return () => { cancelled = true; };
    }, [diagram]);

    const neighbourIds = useMemo(() => {
        if (!selectedId || !diagram) return null;
        const set = new Set<string>([selectedId]);
        for (const e of diagram.edges) {
            if (e.source === selectedId) set.add(e.target);
            if (e.target === selectedId) set.add(e.source);
        }
        return set;
    }, [selectedId, diagram]);

    const flowNodes: SysFlowNode[] = useMemo(() => {
        if (!diagram || !positions) return [];
        return diagram.nodes.map((n) => ({
            id: n.id, type: 'system', position: positions.get(n.id) ?? { x: 0, y: 0 },
            width: NODE_W, height: NODE_H, draggable: false,
            data: {
                label: n.label, kind: n.kind, pathCount: n.paths.length,
                selected: selectedId === n.id,
                dimmed: neighbourIds !== null && !neighbourIds.has(n.id),
                isOrphan: Boolean(n.isOrphan),
                fanIn: n.fanIn ?? 0,
                fanOut: n.fanOut ?? 0,
            },
        }));
    }, [diagram, positions, selectedId, neighbourIds]);

    const flowEdges: Edge[] = useMemo(() => {
        if (!diagram) return [];
        const selecting = neighbourIds !== null;
        return diagram.edges.map((e, i) => {
            const active = neighbourIds === null || (neighbourIds.has(e.source) && neighbourIds.has(e.target));
            // detected = a real import crosses these systems (solid); inferred =
            // the AI's semantic guess (dashed, fainter). The distinction is the
            // point: it says which links are grounded in the code.
            const inferred = e.via === 'inferred';
            return {
                id: `e${i}`, source: e.source, target: e.target, type: 'default',
                label: e.label || undefined,
                labelStyle: { fill: 'var(--muted-foreground)', fontSize: 10 },
                labelBgStyle: { fill: 'var(--card)', fillOpacity: 0.8 },
                style: {
                    strokeWidth: inferred ? 1.2 : 1.7,
                    stroke: selecting && active ? 'var(--accent-solid)' : 'var(--muted-foreground)',
                    strokeDasharray: inferred ? '4 3' : undefined,
                    opacity: selecting ? (active ? 0.95 : 0.1) : (inferred ? 0.4 : 0.72),
                },
            };
        });
    }, [diagram, neighbourIds]);

    const selected = useMemo(
        () => diagram?.nodes.find((n) => n.id === selectedId) ?? null,
        [diagram, selectedId],
    );

    const edgeStats = useMemo(() => {
        let detected = 0, inferred = 0;
        for (const e of diagram?.edges ?? []) e.via === 'detected' ? detected++ : inferred++;
        return { detected, inferred };
    }, [diagram]);

    const nodeLabel = useMemo(() => {
        const m = new Map<string, string>();
        for (const n of diagram?.nodes ?? []) m.set(n.id, n.label);
        return m;
    }, [diagram]);

    // Inbound / outbound system links for the selected node, so its role in the
    // topology is visible, not just its file mappings.
    const links = useMemo(() => {
        if (!selectedId || !diagram) return { out: [], in: [] as { id: string; label: string; via?: string }[] };
        return {
            out: diagram.edges.filter((e) => e.source === selectedId).map((e) => ({ id: e.target, label: e.label, via: e.via })),
            in: diagram.edges.filter((e) => e.target === selectedId).map((e) => ({ id: e.source, label: e.label, via: e.via })),
        };
    }, [selectedId, diagram]);

    const openPath = useCallback((rel: string) => {
        void bridge.openPath(`${root}/${rel}`);
    }, [root]);

    if (!diagram) {
        return (
            <div className="py-6">
                <EmptyState icon={Network} title="No systems map yet"
                    action={
                        <Button variant="default" size="sm" onClick={() => enrich.mutate()} disabled={enrich.isPending}>
                            <ScanText className={enrich.isPending ? 'size-3.5 animate-pulse' : 'size-3.5'} />
                            {enrich.isPending ? 'Reading the project…' : 'Generate with AI'}
                        </Button>
                    }>
                    Console can use a connected AI to map this project into named systems on real
                    repository paths. {enrichError && <span className="text-warning-text">{enrichError}</span>}
                </EmptyState>
            </div>
        );
    }

    return (
        <div className="relative h-[640px] w-full overflow-hidden rounded-xl border border-border bg-card" data-testid="systems-view">
            <ReactFlow
                nodes={flowNodes} edges={flowEdges} nodeTypes={NODE_TYPES}
                onNodeClick={(_e, n) => setSelectedId((cur) => (cur === n.id ? null : n.id))}
                onPaneClick={() => setSelectedId(null)}
                fitView fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}
                nodesDraggable={false} nodesConnectable={false} elementsSelectable
            >
                <FitOnInit signal={flowNodes.length} />
                <Background gap={20} className="!bg-background" />
                <Controls showInteractive={false} />
            </ReactFlow>

            <Card className="absolute bottom-3 left-3 z-10 flex-col items-start gap-1.5 p-2.5">
                <div className="flex items-center gap-2">
                    <Network className="size-3.5 text-muted-foreground" />
                    <span className="text-label text-muted-foreground">
                        {diagram.nodes.length} systems · {edgeStats.detected} detected · {edgeStats.inferred} inferred
                    </span>
                </div>
                <div className="flex items-center gap-3 pl-5 text-label text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block h-px w-4 bg-muted-foreground" aria-hidden /> import</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-0 w-4 border-t border-dashed border-muted-foreground" aria-hidden /> inferred</span>
                </div>
            </Card>

            {selected && (
                <Card className="absolute right-3 top-3 bottom-3 z-20 w-[300px] gap-3 overflow-y-auto p-5" data-testid="systems-sidebar">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="text-section text-foreground">{selected.label}</h3>
                        <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="w-fit">{selected.kind}</Badge>
                        {selected.isOrphan && <Badge variant="outline" className="w-fit">standalone</Badge>}
                        {typeof selected.fileCount === 'number' && selected.fileCount > 0 && (
                            <span className="text-label text-muted-foreground">{selected.fileCount} file{selected.fileCount === 1 ? '' : 's'}{selected.loc ? ` · ${selected.loc.toLocaleString()} LOC` : ''}</span>
                        )}
                    </div>
                    {selected.summary && <p className="text-body leading-6 text-muted-foreground">{selected.summary}</p>}
                    {(links.out.length > 0 || links.in.length > 0) && (
                        <div className="flex flex-col gap-2">
                            {links.out.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-label uppercase text-muted-foreground">Depends on</span>
                                    {links.out.map((l, i) => (
                                        <SystemLinkRow key={`o${i}`} label={nodeLabel.get(l.id) ?? l.id} rel={l.label} detected={l.via === 'detected'} onClick={() => setSelectedId(l.id)} />
                                    ))}
                                </div>
                            )}
                            {links.in.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-label uppercase text-muted-foreground">Used by</span>
                                    {links.in.map((l, i) => (
                                        <SystemLinkRow key={`i${i}`} label={nodeLabel.get(l.id) ?? l.id} rel={l.label} detected={l.via === 'detected'} onClick={() => setSelectedId(l.id)} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-label uppercase text-muted-foreground">Maps to ({selected.paths.length})</span>
                        {selected.paths.map((p) => (
                            <button key={p} onClick={() => openPath(p)}
                                className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-left font-mono text-label text-foreground/80 hover:border-accent-solid hover:text-foreground">
                                <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
                                <span className="truncate">{p}</span>
                            </button>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
