import { useState, useEffect } from 'react';
import { Cpu, MemoryStick, Sparkles, Check, ChevronDown, ChevronRight, Download, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOllamaRecommend, useOllamaDetect } from '../../../lib/queries/ollama';
import { bridge } from '../../../lib/bridge';
import { Badge, Button } from '@/components/ui';
import type { AnnotatedModel } from '../../../lib/bridge';

type PullState = { model: string; pct: number; status: string } | null;

/**
 * Hardware-aware local-model guide. Detects the machine (RAM / CPU / GPU),
 * recommends the largest reputable open model that runs well here, and can
 * install Ollama + pull a model for the user with live progress. Deterministic
 * recommendation; install/pull are consent-gated and stream their progress.
 */
export function LocalModelGuide() {
    const q = useOllamaRecommend(true);
    const detect = useOllamaDetect();
    const [showAll, setShowAll] = useState(false);
    const [pull, setPull] = useState<PullState>(null);
    const [installing, setInstalling] = useState(false);
    const [installLog, setInstallLog] = useState('');

    useEffect(() => {
        const offPull = bridge.ollama.onPullProgress((p) => {
            if (p.error) { if (p.status !== 'cancelled') toast.error(`Pull failed: ${p.error}`); setPull(null); return; }
            if (p.done || p.status === 'success') { toast.success(`Pulled ${p.model}`); setPull(null); void q.refetch(); void detect.refetch(); return; }
            const pct = p.total ? Math.round(((p.completed ?? 0) / p.total) * 100) : 0;
            setPull({ model: p.model, pct, status: p.status });
        });
        const offInstall = bridge.ollama.onInstallProgress((p) => setInstallLog((s) => `${s}\n${p.line}`.split('\n').slice(-3).join('\n')));
        return () => { offPull(); offInstall(); };
    }, [q, detect]);

    if (q.isLoading) {
        return <div className="h-16 animate-pulse rounded-lg bg-secondary/40" data-testid="local-model-guide-loading" />;
    }
    const rec = q.data;
    if (!rec) return null;
    const { specs } = rec;
    const running = detect.data?.running ?? false;
    const recommended = rec.models.find((m) => m.recommended) ?? null;
    const rest = rec.models.filter((m) => !m.recommended);
    const shown = showAll ? rest : rest.filter((m) => m.fit !== 'too-big').slice(0, 4);

    async function doPull(model: string) {
        if (pull) return;
        setPull({ model, pct: 0, status: 'starting' });
        const r = await bridge.ollama.pull(model);
        if (!r.ok && r.error !== 'cancelled') { toast.error(r.error ?? 'Could not pull the model'); setPull(null); }
    }
    async function doInstall() {
        if (!confirm('Install Ollama? This downloads and runs the official Ollama installer (ollama.com) on your machine.')) return;
        setInstalling(true); setInstallLog('');
        try {
            const r = await bridge.ollama.install();
            if (r.ok) { toast.success('Ollama installed. Start it, then Detect.'); void detect.refetch(); }
            else if (r.manual) { toast.message('Finish installing Ollama', { description: r.command }); void bridge.openExternal(r.url ?? 'https://ollama.com/download'); }
            else toast.error(r.error ?? 'Install did not complete');
        } finally { setInstalling(false); }
    }

    return (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-secondary/20 p-3" data-testid="local-model-guide">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
                <span className="inline-flex items-center gap-1"><MemoryStick className="size-3.5" /> {specs.ramGB} GB RAM</span>
                <span className="inline-flex items-center gap-1"><Cpu className="size-3.5" /> {specs.cpuCores} cores</span>
                {specs.gpu && (
                    <span className="inline-flex items-center gap-1">
                        {specs.gpu.name}{typeof specs.gpu.vramGB === 'number' ? ` · ${specs.gpu.vramGB} GB` : ''}
                    </span>
                )}
                <Badge variant={specs.accel === 'gpu' ? 'success' : 'outline'} className="text-label">
                    {specs.accel === 'gpu' ? 'GPU accelerated' : specs.accel === 'unified' ? 'unified memory' : 'CPU inference'}
                </Badge>
            </div>

            {!running && (
                <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2" data-testid="local-model-install">
                    <p className="text-small text-foreground">Ollama isn't running. Install it to run models locally.</p>
                    <div className="flex items-center gap-2">
                        <Button size="sm" loading={installing} onClick={doInstall} data-testid="local-model-install-btn">
                            <Download className="size-3.5" /> Install Ollama
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => detect.refetch()} disabled={detect.isFetching}>
                            {detect.isFetching ? 'Detecting…' : 'I already have it'}
                        </Button>
                    </div>
                    {installLog && <pre className="max-h-12 overflow-hidden whitespace-pre-wrap font-mono text-label text-muted-foreground">{installLog.trim()}</pre>}
                </div>
            )}

            {recommended && (
                <div className="flex flex-col gap-1.5 rounded-md border border-accent/30 bg-accent-subtle px-3 py-2" data-testid="local-model-recommended">
                    <div className="flex flex-wrap items-center gap-2">
                        <Sparkles className="size-3.5 text-accent" />
                        <span className="text-small font-medium text-foreground">Recommended: {recommended.label}</span>
                        <code className="font-mono text-label text-muted-foreground">{recommended.id}</code>
                        {recommended.installed
                            ? <Badge variant="success" className="text-label"><Check className="size-3" /> installed</Badge>
                            : running && <PullButton m={recommended} pull={pull} onPull={doPull} />}
                    </div>
                    <p className="text-label text-muted-foreground">
                        {recommended.strengths} · {recommended.sizeGB} GB · {recommended.license}. {rec.reason}
                    </p>
                    {pull?.model === recommended.id && <PullBar pull={pull} />}
                </div>
            )}

            <ul className="flex flex-col gap-1" data-testid="local-model-catalog">
                {shown.map((m) => <ModelRow key={m.id} m={m} running={running} pull={pull} onPull={doPull} />)}
            </ul>

            {rest.length > shown.length && (
                <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 self-start text-label text-muted-foreground hover:text-foreground" data-testid="local-model-showall">
                    <ChevronRight className="size-3" /> Show all {rec.models.length} models
                </button>
            )}
            {showAll && (
                <button type="button" onClick={() => setShowAll(false)} className="inline-flex items-center gap-1 self-start text-label text-muted-foreground hover:text-foreground">
                    <ChevronDown className="size-3" /> Show fewer
                </button>
            )}
        </div>
    );
}

function PullButton({ m, pull, onPull }: { m: AnnotatedModel; pull: PullState; onPull: (id: string) => void }) {
    const busy = pull?.model === m.id;
    return (
        <Button
            size="xs"
            variant="outline"
            disabled={!!pull || m.fit === 'too-big'}
            onClick={() => onPull(m.id)}
            data-testid={`local-model-pull-${m.id}`}
            title={m.fit === 'too-big' ? 'Too large for this machine' : `Download ${m.sizeGB} GB`}
        >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} Pull
        </Button>
    );
}

function PullBar({ pull }: { pull: NonNullable<PullState> }) {
    return (
        <div className="flex items-center gap-2" data-testid="local-model-pullbar">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pull.pct}%` }} />
            </div>
            <span className="text-label tabular-nums text-muted-foreground">{pull.status} {pull.pct > 0 ? `${pull.pct}%` : ''}</span>
            <button type="button" onClick={() => void bridge.ollama.pullCancel()} className="text-muted-foreground hover:text-danger" title="Cancel" aria-label="Cancel model pull">
                <X className="size-3.5" />
            </button>
        </div>
    );
}

function ModelRow({ m, running, pull, onPull }: { m: AnnotatedModel; running: boolean; pull: PullState; onPull: (id: string) => void }) {
    const tone = m.fit === 'good' ? 'text-success-text' : m.fit === 'tight' ? 'text-warning-text' : 'text-muted-foreground/60';
    return (
        <li className="flex flex-col gap-1 rounded-md px-1.5 py-1 text-small" data-testid={`local-model-${m.id}`}>
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-foreground">{m.label}</span>
                <code className="hidden font-mono text-label text-muted-foreground sm:inline">{m.id}</code>
                <span className="text-label text-muted-foreground tabular-nums">{m.sizeGB} GB</span>
                <span className={`text-label ${tone}`}>{m.fit === 'good' ? 'runs well' : m.fit === 'tight' ? 'tight' : 'too big'}</span>
                {m.installed
                    ? <Check className="size-3.5 text-success" />
                    : running && <PullButton m={m} pull={pull} onPull={onPull} />}
            </div>
            {pull?.model === m.id && <PullBar pull={pull} />}
        </li>
    );
}
