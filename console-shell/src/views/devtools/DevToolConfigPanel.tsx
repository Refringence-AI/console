import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Wrench, RefreshCw, ChevronRight, ShieldCheck, ShieldAlert, ShieldQuestion,
    FileText, Boxes, Webhook, Server,
} from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { Badge, Card, EmptyState, Button } from '@/components/ui';
import { useActiveProject } from '../../lib/activeProject';
import { usePersonaMode } from '../../lib/usePersonaMode';
import {
    bridge, type DetectedToolConfig, type ToolId, type InstructionDoc, type PermissionSet,
} from '../../lib/bridge';

const TOOL_NAMES: Record<ToolId, string> = {
    'claude-code': 'Claude Code',
    cursor: 'Cursor',
    copilot: 'GitHub Copilot',
    windsurf: 'Windsurf',
    codex: 'Codex',
    'gemini-cli': 'Gemini CLI',
};

/**
 * Dev-tool AI config viewer. Reads (deterministically, no AI) the config files
 * each coding tool keeps in this repo - Claude Code permissions / hooks / MCP,
 * Cursor + Copilot + Windsurf rules, AGENTS.md, GEMINI.md - and shows them in one
 * place. Read-first: it never reads .env values, and shows env as key names only.
 */
export function DevToolConfigPanel() {
    const { project } = useActiveProject();
    const root = project?.path ?? null;
    const { isNewbie } = usePersonaMode();

    const q = useQuery({
        queryKey: ['devtools-config', root],
        queryFn: () => bridge.devtoolsConfig.scan(root ?? ''),
        enabled: !!root,
        staleTime: 60_000,
    });

    if (!root) {
        return (
            <div className="flex h-full flex-col" data-testid="devtools-config-panel">
                <PanelHeader icon={Wrench} title="Dev-tool config" subtitle="Your AI coding tools, in one place" />
                <div className="flex flex-1 items-center justify-center p-8">
                    <EmptyState icon={Wrench} title="Pick a project first">
                        Choose an active project to read the AI dev-tool config files it carries.
                    </EmptyState>
                </div>
            </div>
        );
    }

    const scan = q.data;
    const present = scan?.tools.filter((t) => t.present) ?? [];
    const absent = scan?.tools.filter((t) => !t.present) ?? [];

    return (
        <div className="flex h-full flex-col" data-testid="devtools-config-panel">
            <PanelHeader
                icon={Wrench}
                title="Dev-tool config"
                subtitle={scan ? `${scan.presentCount} of ${scan.tools.length} tools configured here` : 'Your AI coding tools, in one place'}
            >
                <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()} className="gap-1.5" data-testid="devtools-rescan">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Rescan
                </Button>
            </PanelHeader>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                    {isNewbie && (
                        <Card className="gap-0 bg-secondary/30 p-3.5">
                            <p className="text-small leading-relaxed text-muted-foreground">
                                This reads the rules and settings files your AI coding tools keep in this
                                project (like Claude Code or Cursor) and shows them together, so you can see
                                what each tool is told to do. Nothing is changed and your secrets are never read.
                            </p>
                        </Card>
                    )}

                    {q.isLoading && [0, 1, 2].map((i) => (
                        <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-secondary/30" />
                    ))}

                    {q.isError && (
                        <Card className="flex flex-row items-center justify-between gap-2 p-3">
                            <span className="text-small text-muted-foreground">Could not read the dev-tool configs.</span>
                            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button>
                        </Card>
                    )}

                    {scan && present.length === 0 && !q.isLoading && (
                        <EmptyState icon={Wrench} title="No AI tool config found here">
                            None of Claude Code, Cursor, Copilot, Windsurf, Codex, or Gemini have config files
                            in this project yet. Console can write an AGENTS.md or .cursorrules from the Prompts
                            panel when you are ready.
                        </EmptyState>
                    )}

                    {present.map((t) => <ToolSection key={t.tool} tool={t} defaultOpen dense={!isNewbie} />)}

                    {absent.length > 0 && present.length > 0 && (
                        <>
                            <p className="mt-2 text-label uppercase tracking-wide text-muted-foreground">Not configured here</p>
                            <div className="flex flex-wrap gap-1.5">
                                {absent.map((t) => (
                                    <Badge key={t.tool} variant="outline" className="rounded-md text-muted-foreground">
                                        {TOOL_NAMES[t.tool]}
                                    </Badge>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function ToolSection({ tool, defaultOpen, dense }: { tool: DetectedToolConfig; defaultOpen: boolean; dense: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <Card className="gap-0 overflow-hidden p-0" data-testid={`devtools-tool-${tool.tool}`}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-secondary/30"
            >
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="flex-1 text-card-title text-foreground">{TOOL_NAMES[tool.tool]}</span>
                {tool.model && <Badge variant="secondary" className="rounded-md font-mono text-label">{tool.model}</Badge>}
                <Badge variant="outline" className="rounded-md text-muted-foreground">
                    {tool.files.length} {tool.files.length === 1 ? 'file' : 'files'}
                </Badge>
            </button>

            {open && (
                <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                    {tool.permissions?.map((p, i) => <PermissionTable key={i} perms={p} dense={dense} />)}
                    {tool.mcpServers && tool.mcpServers.length > 0 && <McpList servers={tool.mcpServers} />}
                    {tool.hooks && tool.hooks.length > 0 && <HooksList hooks={tool.hooks} />}
                    {tool.env && tool.env.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                            <Label icon={Server}>Environment (key names)</Label>
                            <div className="flex flex-wrap gap-1">
                                {tool.env.map((e) => <Badge key={e} variant="outline" className="rounded-sm font-mono text-label">{e}</Badge>)}
                            </div>
                        </div>
                    )}
                    {tool.instructions?.map((d) => <InstructionCard key={d.relPath} doc={d} />)}
                    {tool.files.some((f) => f.parseError) && (
                        <p className="text-small text-warning">
                            {tool.files.filter((f) => f.parseError).map((f) => `${f.relPath}: ${f.parseError}`).join('; ')}
                        </p>
                    )}
                </div>
            )}
        </Card>
    );
}

function Label({ icon: Icon, children }: { icon: typeof Server; children: React.ReactNode }) {
    return (
        <span className="flex items-center gap-1.5 text-small font-medium text-foreground">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            {children}
        </span>
    );
}

function PermissionTable({ perms, dense }: { perms: PermissionSet; dense: boolean }) {
    const [open, setOpen] = useState(dense);
    const total = perms.allow.length + perms.ask.length + perms.deny.length;
    return (
        <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-left">
                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="text-small font-medium text-foreground">Permissions</span>
                <Badge variant="outline" className="rounded-sm text-muted-foreground">{perms.source}</Badge>
                <span className="text-small text-muted-foreground">{total} rules</span>
                {perms.defaultMode && <Badge variant="secondary" className="rounded-sm text-label">{perms.defaultMode}</Badge>}
            </button>
            {open && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <RuleColumn icon={ShieldAlert} title="Deny" rules={perms.deny} tone="text-danger" />
                    <RuleColumn icon={ShieldQuestion} title="Ask" rules={perms.ask} tone="text-warning" />
                    <RuleColumn icon={ShieldCheck} title="Allow" rules={perms.allow} tone="text-success" />
                </div>
            )}
        </div>
    );
}

function RuleColumn({ icon: Icon, title, rules, tone }: { icon: typeof ShieldCheck; title: string; rules: string[]; tone: string }) {
    const [showAll, setShowAll] = useState(false);
    const shown = showAll ? rules : rules.slice(0, 12);
    return (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/20 p-2.5">
            <span className={`flex items-center gap-1.5 text-small font-medium ${tone}`}>
                <Icon className="h-3.5 w-3.5" />
                {title}
                <span className="text-muted-foreground">({rules.length})</span>
            </span>
            {rules.length === 0 ? (
                <span className="text-label text-muted-foreground">none</span>
            ) : (
                <div className="flex flex-col gap-0.5">
                    {shown.map((r, i) => (
                        <code key={`${r}-${i}`} className="truncate font-mono text-label text-muted-foreground" title={r}>{r}</code>
                    ))}
                    {rules.length > 12 && (
                        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-0.5 text-left text-label text-accent">
                            {showAll ? 'Show less' : `+${rules.length - 12} more`}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function McpList({ servers }: { servers: NonNullable<DetectedToolConfig['mcpServers']> }) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label icon={Boxes}>MCP servers ({servers.length})</Label>
            <div className="flex flex-col gap-1.5">
                {servers.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-2.5 py-1.5">
                        <span className="text-small font-medium text-foreground">{s.name}</span>
                        <Badge variant="outline" className="rounded-sm text-label text-muted-foreground">{s.transport}</Badge>
                        <code className="truncate font-mono text-label text-muted-foreground">{s.url ?? [s.command, ...(s.args ?? [])].filter(Boolean).join(' ')}</code>
                    </div>
                ))}
            </div>
        </div>
    );
}

function HooksList({ hooks }: { hooks: NonNullable<DetectedToolConfig['hooks']> }) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label icon={Webhook}>Hooks ({hooks.length})</Label>
            <div className="flex flex-col gap-1">
                {hooks.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-small">
                        <Badge variant="outline" className="rounded-sm text-label text-muted-foreground">{h.event}</Badge>
                        {h.matcher && <code className="font-mono text-label text-muted-foreground">{h.matcher}</code>}
                        <code className="truncate font-mono text-label text-foreground" title={h.command}>{h.command}</code>
                    </div>
                ))}
            </div>
        </div>
    );
}

function InstructionCard({ doc }: { doc: InstructionDoc }) {
    const [open, setOpen] = useState(false);
    const chips = [
        ...(doc.alwaysApply ? ['always apply'] : []),
        ...(doc.trigger ? [doc.trigger] : []),
        ...(doc.applyTo ? [doc.applyTo] : []),
        ...(doc.globs ?? []),
        ...(doc.model ? [doc.model] : []),
    ];
    return (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/20 p-3">
            <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-start gap-2 text-left">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                        <span className="truncate text-small font-medium text-foreground">{doc.title}</span>
                        <Badge variant="outline" className="rounded-sm text-label text-muted-foreground">{doc.kind}</Badge>
                    </span>
                    <code className="truncate font-mono text-label text-muted-foreground">{doc.relPath}</code>
                    {doc.description && <span className="mt-0.5 text-small leading-relaxed text-muted-foreground">{doc.description}</span>}
                </span>
                <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
            {chips.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-5.5">
                    {chips.map((c, i) => <Badge key={`${c}-${i}`} variant="secondary" className="rounded-sm font-mono text-label">{c}</Badge>)}
                </div>
            )}
            {open && doc.body && (
                <pre className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background p-2.5 font-mono text-label leading-relaxed text-muted-foreground">
                    {doc.body}
                </pre>
            )}
        </div>
    );
}

export default DevToolConfigPanel;
