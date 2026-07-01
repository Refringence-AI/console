import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    Handle,
    Position,
    useNodesInitialized,
    useReactFlow,
    type Node,
    type Edge,
    type NodeProps,
    type NodeChange,
    applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import { AlertTriangle, Eye, EyeOff, Languages, Pencil, Package, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
    type ArchTier,
    type DependencyGraph,
    type DependencyNode,
    type ArchOverlay,
} from '../../lib/bridge';
import {
    useArchitectureGraph,
    useArchOverlay,
    useSaveArchOverlay,
    useRecomputeArchitecture,
} from '../../lib/queries/arch';
import { useProjectProfile } from '../../lib/queries/intel';
import { Badge, Button, Card } from '../../components/ui';
import { cn } from '../../lib/utils';

/**
 * Live architecture dependency graph.
 *
 * Auto-extracted package->package edges (via the main-process walk) laid
 * out with elkjs and rendered on a ReactFlow canvas. Two modes:
 *
 *  - operator: pan/zoom, an Edit-layout toggle to drag nodes (persisted to
 *    the overlay), a side panel for per-node tier override + note + hide.
 *  - guided: a fixed viewport; clicking a node highlights its in/out edges
 *    and opens a prose sidebar explaining the package and its dependencies.
 *
 * The user's overlay (positions / tierOverrides / notes / hidden) is layered
 * on top of the auto-graph so curation survives a recompute.
 */

const TIER_LABEL: Record<ArchTier, string> = {
    shell: 'Shell',
    presentation: 'Presentation',
    domain: 'Domain',
    data: 'Data',
    infra: 'Infra',
    test: 'Test',
    external: 'External',
};

// Legend order. External sits last because it is an opt-in extra layer.
const TIER_ORDER: ArchTier[] = ['shell', 'presentation', 'domain', 'data', 'infra', 'test', 'external'];

// Tiers a user may assign by hand in the node editor. External is auto-only
// (synthesised from manifests), so it is not offered as a manual override.
const MANUAL_TIERS: ArchTier[] = ['shell', 'presentation', 'domain', 'data', 'infra', 'test'];

// Tier -> token-palette styling. Kept inside the design tokens (the ONE
// blue accent, plus info/foreground/warning/muted), no rainbow.
const TIER_STYLE: Record<ArchTier, { border: string; tint: string; dot: string }> = {
    shell: { border: 'border-accent-solid', tint: 'bg-accent-subtle', dot: 'bg-accent-solid' },
    presentation: { border: 'border-info/50', tint: 'bg-info/10', dot: 'bg-info' },
    domain: { border: 'border-foreground/40', tint: 'bg-foreground/5', dot: 'bg-foreground' },
    data: { border: 'border-warning/50', tint: 'bg-warning/10', dot: 'bg-warning' },
    infra: { border: 'border-border', tint: 'bg-muted/40', dot: 'bg-muted-foreground' },
    test: { border: 'border-success/40', tint: 'bg-success/10', dot: 'bg-success' },
    external: { border: 'border-border border-dashed', tint: 'bg-background', dot: 'bg-muted-foreground/60' },
};

const ALL_TIERS: ArchTier[] = ['shell', 'presentation', 'domain', 'data', 'infra', 'test', 'external'];

function isArchTier(value: string): value is ArchTier {
    return (ALL_TIERS as string[]).includes(value);
}

interface ArchNodeData extends Record<string, unknown> {
    label: string;
    tier: ArchTier;
    loc: number;
    fileCount: number;
    /** This package's LOC as a fraction of the largest package (0..1), for a
     *  size-at-a-glance bar. */
    locShare: number;
    dimmed: boolean;
    selected: boolean;
    [key: string]: unknown;
}

type ArchFlowNode = Node<ArchNodeData, 'arch'>;

function ArchNodeCard({ data }: NodeProps<ArchFlowNode>) {
    const style = TIER_STYLE[data.tier];
    return (
        <div
            style={{ width: NODE_W, height: NODE_H }}
            className={cn(
                'overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm transition-opacity',
                style.border,
                style.tint,
                data.dimmed ? 'opacity-25' : 'opacity-100',
                data.selected ? 'ring-2 ring-accent-solid' : '',
            )}
        >
            <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground" />
            <div className="flex min-w-0 items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden />
                <span className="truncate font-mono text-card-title text-foreground">{data.label}</span>
            </div>
            <p className="mt-0.5 pl-4 text-small tabular-nums text-muted-foreground">
                {data.loc.toLocaleString()} LOC · {data.fileCount.toLocaleString()} files
            </p>
            <div className="mt-1 ml-4 h-1 overflow-hidden rounded-full bg-secondary" title={`${Math.round(data.locShare * 100)}% of the largest package`}>
                <div className={cn('h-full rounded-full', style.dot)} style={{ width: `${Math.max(4, Math.round(data.locShare * 100))}%` }} />
            </div>
            <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground" />
        </div>
    );
}

const NODE_TYPES = { arch: ArchNodeCard };

// Frame the graph once the ELK-laid-out nodes have measured dimensions. Fitting
// before nodes are initialized frames an empty box and zooms in past the graph,
// which clipped the right-hand packages off-canvas. Re-fits when the visible
// node count changes (show/hide).
function FitOnInit({ signal }: { signal: number }) {
    const initialized = useNodesInitialized();
    const { fitView } = useReactFlow();
    useEffect(() => {
        if (initialized) void fitView({ padding: 0.2 });
    }, [initialized, fitView, signal]);
    return null;
}

// elk layout dimensions per node. The card is locked to these exact dimensions
// (below) so ELK's layout, ReactFlow's fitView, and the rendered card all agree;
// otherwise a wider-than-layout card overflows its slot and clips off-canvas.
const NODE_W = 240;
const NODE_H = 58;

const elk = new ELK();

interface LaidOutNode {
    id: string;
    x: number;
    y: number;
}

async function layoutWithElk(
    nodes: DependencyNode[],
    edges: DependencyGraph['edges'],
): Promise<Map<string, { x: number; y: number }>> {
    const graph = {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'DOWN',
            'elk.layered.spacing.nodeNodeBetweenLayers': '64',
            'elk.spacing.nodeNode': '40',
        },
        children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
        edges: edges.map((e, i) => ({
            id: `e${i}`,
            sources: [e.source],
            targets: [e.target],
        })),
    };
    const out = new Map<string, { x: number; y: number }>();
    try {
        const res = await elk.layout(graph);
        for (const child of (res.children ?? []) as LaidOutNode[]) {
            out.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
        }
    } catch {
        // Fallback: a simple grid so the canvas still renders.
        nodes.forEach((n, i) => {
            out.set(n.id, { x: (i % 4) * (NODE_W + 40), y: Math.floor(i / 4) * (NODE_H + 64) });
        });
    }
    return out;
}

export interface ArchitectureGraphProps {
    root: string;
    mode: 'operator' | 'guided';
}

export function ArchitectureGraph({ root, mode }: ArchitectureGraphProps) {
    // External deps are an opt-in extra layer; guided mode keeps it off so
    // the newbie map stays the internal-only picture.
    const [includeExternal, setIncludeExternal] = useState(false);
    // Non-JS/TS extraction is opt-in for JS/TS repos (a big repo of independent
    // language wrappers renders as a wall of boxes), but a repo whose primary
    // language is Python/Go/Rust/Java would otherwise show an empty graph, so it
    // auto-enables once for those. The user can toggle freely after.
    const [allLanguages, setAllLanguages] = useState(false);
    const profile = useProjectProfile(root);
    const autoLangRef = useRef(false);
    useEffect(() => {
        if (autoLangRef.current) return;
        const lang = profile.data?.stack?.primaryLanguage;
        if (!lang) return;
        autoLangRef.current = true;
        if (lang !== 'TypeScript' && lang !== 'JavaScript') setAllLanguages(true);
    }, [profile.data]);
    const graphQuery = useArchitectureGraph(
        root,
        mode === 'operator' && includeExternal,
        mode === 'operator' && allLanguages,
    );
    const overlayQuery = useArchOverlay(root);
    const saveOverlay = useSaveArchOverlay(root);
    const recompute = useRecomputeArchitecture(
        root,
        mode === 'operator' && includeExternal,
        mode === 'operator' && allLanguages,
    );

    const graph = graphQuery.data;
    const overlay = overlayQuery.data ?? null;

    const [elkPositions, setElkPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editLayout, setEditLayout] = useState(false);
    const [showStandalone, setShowStandalone] = useState(false);
    const [flowNodes, setFlowNodes] = useState<ArchFlowNode[]>([]);

    // Effective tier for a node, honouring an overlay override.
    const tierOf = useCallback(
        (n: DependencyNode): ArchTier => {
            const override = overlay?.tierOverrides?.[n.id];
            if (override && isArchTier(override)) return override;
            return n.tier;
        },
        [overlay],
    );

    const hidden = useMemo(() => new Set(overlay?.hidden ?? []), [overlay]);

    // Nodes that participate in at least one edge. The default view shows only
    // these, so a repo with many independent packages (e.g. standalone language
    // wrappers) does not render as a wall of disconnected boxes.
    const connectedIds = useMemo(() => {
        const set = new Set<string>();
        for (const e of graph?.edges ?? []) { set.add(e.source); set.add(e.target); }
        return set;
    }, [graph]);

    const visibleNodes = useMemo(() => {
        const shown = (graph?.nodes ?? []).filter((n) => !hidden.has(n.id));
        // Fall back to all nodes when nothing is connected, so a repo with no
        // detected edges still renders instead of an empty canvas.
        if (showStandalone || connectedIds.size === 0) return shown;
        return shown.filter((n) => connectedIds.has(n.id));
    }, [graph, hidden, connectedIds, showStandalone]);

    const standaloneCount = useMemo(() => {
        if (connectedIds.size === 0) return 0;
        return (graph?.nodes ?? []).filter((n) => !hidden.has(n.id) && !connectedIds.has(n.id)).length;
    }, [graph, hidden, connectedIds]);

    const visibleEdges = useMemo(
        () => (graph?.edges ?? []).filter((e) => !hidden.has(e.source) && !hidden.has(e.target)),
        [graph, hidden],
    );

    // Legend lists only tiers actually on screen, so "External" shows up only
    // when the external layer is on (honest legend, no dead rows).
    const presentTiers = useMemo(() => {
        const set = new Set<ArchTier>();
        for (const n of visibleNodes) set.add(tierOf(n));
        return set;
    }, [visibleNodes, tierOf]);

    // Run ELK once per (visible) graph load. Overlay positions, when present,
    // win over the ELK result so a curated layout sticks.
    useEffect(() => {
        let cancelled = false;
        if (!graph || visibleNodes.length === 0) {
            setElkPositions(new Map());
            return;
        }
        void layoutWithElk(visibleNodes, visibleEdges).then((pos) => {
            if (!cancelled) setElkPositions(pos);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [graph, visibleNodes.length, hidden]);

    // Neighbour set of the selected node (both directions) for highlight.
    const neighbourIds = useMemo(() => {
        if (!selectedId || !graph) return null;
        const set = new Set<string>([selectedId]);
        for (const e of graph.edges) {
            if (e.source === selectedId) set.add(e.target);
            if (e.target === selectedId) set.add(e.source);
        }
        return set;
    }, [selectedId, graph]);

    // Compose ReactFlow nodes from ELK + overlay positions + highlight state.
    useEffect(() => {
        if (!graph || !elkPositions) {
            setFlowNodes([]);
            return;
        }
        const maxLoc = Math.max(1, ...visibleNodes.map((n) => n.loc));
        const next: ArchFlowNode[] = visibleNodes.map((n) => {
            const overlayPos = overlay?.positions?.[n.id];
            const elkPos = elkPositions.get(n.id) ?? { x: 0, y: 0 };
            const pos = overlayPos ?? elkPos;
            const dimmed = neighbourIds !== null && !neighbourIds.has(n.id);
            return {
                id: n.id,
                type: 'arch',
                position: pos,
                // Explicit dimensions so fitView frames the graph correctly on
                // first paint, before the card DOM is measured.
                width: NODE_W,
                height: NODE_H,
                draggable: mode === 'operator' && editLayout,
                data: {
                    label: n.label,
                    tier: tierOf(n),
                    loc: n.loc,
                    fileCount: n.fileCount,
                    locShare: n.loc / maxLoc,
                    dimmed,
                    selected: selectedId === n.id,
                },
            };
        });
        setFlowNodes(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [graph, elkPositions, overlay, neighbourIds, selectedId, editLayout, mode, visibleNodes, tierOf]);

    const flowEdges: Edge[] = useMemo(() => {
        // A node selection narrows the highlight to its subgraph. With nothing
        // selected every edge rests at a calm NEUTRAL stroke (muted-foreground)
        // so the graph reads as connected at a glance; the blue accent is
        // reserved for the selected subgraph, the rest fading back.
        const selecting = neighbourIds !== null;
        return visibleEdges.map((e, i) => {
            const active =
                neighbourIds === null ||
                (neighbourIds.has(e.source) && neighbourIds.has(e.target));
            return {
                id: `e${i}`,
                source: e.source,
                target: e.target,
                type: 'default',
                style: {
                    strokeWidth: Math.min(1.2 + e.weight * 0.5, 4),
                    stroke: selecting && active ? 'var(--accent-solid)' : 'var(--muted-foreground)',
                    opacity: selecting ? (active ? 0.95 : 0.1) : 0.6,
                },
            };
        });
    }, [visibleEdges, neighbourIds]);

    // Drag persistence (operator + edit layout only). We persist on the
    // drag-stop change so we don't write per-pixel.
    const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onNodesChange = useCallback(
        (changes: NodeChange<ArchFlowNode>[]) => {
            setFlowNodes((cur) => applyNodeChanges(changes, cur));
            if (mode !== 'operator' || !editLayout) return;
            const hasDrag = changes.some((c) => c.type === 'position');
            if (!hasDrag) return;
            if (persistTimer.current) clearTimeout(persistTimer.current);
            persistTimer.current = setTimeout(() => {
                setFlowNodes((cur) => {
                    const positions: Record<string, { x: number; y: number }> = {};
                    for (const n of cur) positions[n.id] = { x: n.position.x, y: n.position.y };
                    const base: ArchOverlay = overlay ?? {
                        positions: {},
                        tierOverrides: {},
                        notes: {},
                        hidden: [],
                    };
                    saveOverlay.mutate({ ...base, positions });
                    return cur;
                });
            }, 400);
        },
        [mode, editLayout, overlay, saveOverlay],
    );

    const selectedNode = useMemo(
        () => visibleNodes.find((n) => n.id === selectedId) ?? null,
        [visibleNodes, selectedId],
    );

    function patchOverlay(patch: Partial<ArchOverlay>) {
        const base: ArchOverlay = overlay ?? { positions: {}, tierOverrides: {}, notes: {}, hidden: [] };
        saveOverlay.mutate({ ...base, ...patch });
    }

    // Drop the curated positions so the next ELK pass owns the layout again;
    // tier overrides / notes / hidden are intentionally kept (a layout reset
    // is not a full curation wipe). Clearing elkPositions re-triggers ELK.
    function resetLayout() {
        patchOverlay({ positions: {} });
        setElkPositions(null);
    }

    if (graphQuery.isLoading) {
        return <GraphSkeleton />;
    }

    if (graph && graph.nodes.length === 0) {
        // Signal to the parent (ArchPanel) that extraction found nothing,
        // so it can fall back to the hand-authored list.
        return (
            <Card className="items-center gap-2 p-6 text-center" data-testid="architecture-graph-empty">
                <p className="text-body text-foreground">No package dependencies extracted.</p>
                <p className="text-small text-muted-foreground">Showing the list view instead.</p>
            </Card>
        );
    }

    const fixedViewport = mode === 'guided';

    return (
        <div
            className="relative h-[640px] w-full overflow-hidden rounded-xl border border-border bg-card"
            data-testid="architecture-graph"
        >
            <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onNodeClick={(_e, n) => setSelectedId((cur) => (cur === n.id ? null : n.id))}
                onPaneClick={() => setSelectedId(null)}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                proOptions={{ hideAttribution: true }}
                panOnDrag={!fixedViewport}
                zoomOnScroll={!fixedViewport}
                zoomOnPinch={!fixedViewport}
                zoomOnDoubleClick={!fixedViewport}
                nodesDraggable={mode === 'operator' && editLayout}
                nodesConnectable={false}
                elementsSelectable
            >
                <FitOnInit signal={flowNodes.length} />
                <Background gap={20} className="!bg-background" />
                {!fixedViewport && <Controls showInteractive={false} />}
            </ReactFlow>

            <Legend tiers={presentTiers} />

            {graph && graph.cycles.length > 0 && <CycleWarning cycles={graph.cycles} />}

            {graph?.truncated && (
                <div
                    className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-warning/30 bg-card px-3 py-1.5"
                    data-testid="arch-truncated-banner"
                >
                    <AlertTriangle className="h-3.5 w-3.5 text-warning-text" />
                    <span className="text-label text-muted-foreground">
                        Showing {graph.nodes.filter((n) => !n.external).length} packages;
                        tree truncated at {graph.fileCount.toLocaleString()} files.
                    </span>
                </div>
            )}

            {/* No edges at all: the grid below is the honest fallback, but a bare
                grid reads as broken. Explain WHY the lines are missing and point
                operators at the toggles that widen extraction. */}
            {!graph?.truncated && connectedIds.size === 0 && visibleNodes.length > 0 && (
                <div
                    className="absolute left-3 top-3 z-10 flex max-w-[440px] items-start gap-2 rounded-lg border border-border bg-card px-3 py-2"
                    data-testid="arch-no-edges-hint"
                >
                    <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-label leading-5 text-muted-foreground">
                        These packages don't import one another, so there are no dependency
                        lines yet.{mode === 'operator' ? ' Turn on All languages or External deps to widen extraction.' : ''}
                    </span>
                </div>
            )}

            {mode === 'operator' && (
                <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
                    {standaloneCount > 0 && (
                        <Button
                            variant={showStandalone ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setShowStandalone((v) => !v)}
                            data-testid="arch-standalone-toggle"
                            title={showStandalone ? 'Hide packages with no detected dependencies' : 'Show packages with no detected dependencies'}
                        >
                            {showStandalone ? 'Hide standalone' : `${standaloneCount} standalone`}
                        </Button>
                    )}
                    <Button
                        variant={allLanguages ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setAllLanguages((v) => !v)}
                        data-testid="arch-all-languages-toggle"
                        title={allLanguages ? 'Showing all languages; click for JS/TS only' : 'Also extract Python/Rust/Go/Java/Kotlin imports'}
                    >
                        <Languages className="h-3.5 w-3.5" />
                        All languages
                    </Button>
                    <Button
                        variant={includeExternal ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setIncludeExternal((v) => !v)}
                        data-testid="arch-external-toggle"
                    >
                        <Package className="h-3.5 w-3.5" />
                        External deps
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => recompute.mutate()}
                        disabled={recompute.isPending}
                        data-testid="arch-recompute"
                    >
                        <RefreshCw className={cn('h-3.5 w-3.5', recompute.isPending && 'animate-spin')} />
                        Recompute
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={resetLayout}
                        data-testid="arch-reset-layout"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset layout
                    </Button>
                    <Button
                        variant={editLayout ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setEditLayout((v) => !v)}
                        data-testid="arch-edit-layout-toggle"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                        {editLayout ? 'Done editing' : 'Edit layout'}
                    </Button>
                </div>
            )}

            {mode === 'operator' && selectedNode && (
                <OperatorSidePanel
                    node={selectedNode}
                    effectiveTier={tierOf(selectedNode)}
                    note={overlay?.notes?.[selectedNode.id] ?? ''}
                    hidden={hidden.has(selectedNode.id)}
                    onClose={() => setSelectedId(null)}
                    onTier={(tier) =>
                        patchOverlay({
                            tierOverrides: { ...(overlay?.tierOverrides ?? {}), [selectedNode.id]: tier },
                        })
                    }
                    onNote={(text) =>
                        patchOverlay({ notes: { ...(overlay?.notes ?? {}), [selectedNode.id]: text } })
                    }
                    onToggleHidden={() => {
                        const cur = new Set(overlay?.hidden ?? []);
                        if (cur.has(selectedNode.id)) cur.delete(selectedNode.id);
                        else cur.add(selectedNode.id);
                        patchOverlay({ hidden: [...cur] });
                        setSelectedId(null);
                    }}
                />
            )}

            {mode === 'guided' && selectedNode && graph && (
                <GuidedSidebar
                    node={selectedNode}
                    graph={graph}
                    note={overlay?.notes?.[selectedNode.id]}
                    onClose={() => setSelectedId(null)}
                />
            )}
        </div>
    );
}

function Legend({ tiers }: { tiers: Set<ArchTier> }) {
    return (
        <Card
            className="absolute bottom-3 left-3 z-10 gap-1.5 p-3"
            data-testid="arch-legend"
        >
            {TIER_ORDER.filter((t) => tiers.has(t)).map((tier) => (
                <div key={tier} className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', TIER_STYLE[tier].dot)} aria-hidden />
                    <span className="text-label text-muted-foreground">{TIER_LABEL[tier]}</span>
                </div>
            ))}
        </Card>
    );
}

function CycleWarning({ cycles }: { cycles: string[][] }) {
    return (
        <Card
            className="absolute right-3 bottom-3 z-10 max-w-[280px] gap-2 border-warning/30 p-3"
            data-testid="arch-cycle-warning"
        >
            <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-text" />
                <Badge variant="warning">
                    {cycles.length} cycle{cycles.length === 1 ? '' : 's'}
                </Badge>
            </div>
            <ul className="flex flex-col gap-1">
                {cycles.slice(0, 4).map((cycle, i) => (
                    <li key={i} className="font-mono text-label leading-4 text-muted-foreground">
                        {cycle.map(shortName).join(' -> ')}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

function OperatorSidePanel({
    node,
    effectiveTier,
    note,
    hidden,
    onClose,
    onTier,
    onNote,
    onToggleHidden,
}: {
    node: DependencyNode;
    effectiveTier: ArchTier;
    note: string;
    hidden: boolean;
    onClose: () => void;
    onTier: (tier: string) => void;
    onNote: (text: string) => void;
    onToggleHidden: () => void;
}) {
    const [draft, setDraft] = useState(note);
    useEffect(() => setDraft(note), [note, node.id]);

    return (
        <Card
            className="absolute right-3 top-14 z-20 w-[280px] gap-3 p-4"
            data-testid="arch-node-panel"
        >
            <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-card-title text-foreground">{node.label}</span>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {!node.external && (
                <div className="flex flex-col gap-1.5">
                    <span className="text-label text-muted-foreground">Tier</span>
                    <div className="flex flex-wrap gap-1">
                        {MANUAL_TIERS.map((tier) => (
                            <button
                                key={tier}
                                onClick={() => onTier(tier)}
                                className={cn(
                                    'rounded-md border px-2 py-1 text-label transition-colors',
                                    tier === effectiveTier
                                        ? 'border-accent-solid bg-accent-subtle text-foreground'
                                        : 'border-border text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {TIER_LABEL[tier]}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <span className="text-label text-muted-foreground">Note</span>
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => draft !== note && onNote(draft)}
                    rows={3}
                    placeholder="Why this package matters."
                    className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-small text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
            </div>

            <Button variant="outline" size="sm" onClick={onToggleHidden} className="w-full">
                {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {hidden ? 'Show node' : 'Hide node'}
            </Button>
        </Card>
    );
}

function GuidedSidebar({
    node,
    graph,
    note,
    onClose,
}: {
    node: DependencyNode;
    graph: DependencyGraph;
    note?: string;
    onClose: () => void;
}) {
    const dependsOn = graph.edges.filter((e) => e.source === node.id).map((e) => e.target);
    const dependedOnBy = graph.edges.filter((e) => e.target === node.id).map((e) => e.source);

    return (
        <Card
            className="absolute right-3 top-3 bottom-3 z-20 w-[300px] gap-4 overflow-y-auto p-5"
            data-testid="arch-guided-sidebar"
        >
            <div className="flex items-start justify-between gap-2">
                <h3 className="font-mono text-section text-foreground">{node.label}</h3>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <p className="text-body leading-6 text-muted-foreground">
                <span className="font-mono text-foreground">{node.label}</span> sits in the{' '}
                {TIER_LABEL[node.tier]} tier. It holds {node.fileCount.toLocaleString()} file
                {node.fileCount === 1 ? '' : 's'} and {node.loc.toLocaleString()} lines of code.
            </p>

            {note && (
                <p className="rounded-md bg-accent-subtle px-3 py-2 text-small leading-5 text-foreground">
                    {note}
                </p>
            )}

            <ProseEdges title="It depends on" packages={dependsOn} empty="nothing else in the project." />
            <ProseEdges
                title="It is used by"
                packages={dependedOnBy}
                empty="nothing else in the project (a leaf)."
            />
        </Card>
    );
}

function ProseEdges({ title, packages, empty }: { title: string; packages: string[]; empty: string }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{title}</span>
            {packages.length === 0 ? (
                <p className="text-small text-muted-foreground">{empty}</p>
            ) : (
                <ul className="flex flex-wrap gap-1">
                    {packages.map((p) => (
                        <li
                            key={p}
                            className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-label text-foreground/80"
                        >
                            {shortName(p)}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function GraphSkeleton() {
    return (
        <div
            className="flex h-[640px] w-full items-center justify-center rounded-xl border border-border bg-card"
            data-testid="arch-graph-loading"
        >
            <div className="h-24 w-40 animate-pulse rounded-xl bg-secondary/40" />
        </div>
    );
}

function shortName(name: string): string {
    if (name.includes('/')) return name.slice(name.lastIndexOf('/') + 1);
    return name;
}
