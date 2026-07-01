import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Loader2, ExternalLink, Link2 } from 'lucide-react';
import { Card as UICard, Button, Badge, SectionLabel } from '@/components/ui';
import { useActiveProject } from '../../lib/activeProject';
import { useProjectProfile } from '../../lib/queries/intel';
import { bridge, type DetectedService } from '../../lib/bridge';

/**
 * "We noticed this project uses…" - turns the deterministic service detector
 * (env key NAMES, deps, config files, MCP servers) into an evidence-cited,
 * value-ranked list so a user who does not know a data source exists can still
 * discover and connect it. Detection reads names only; a value is touched only
 * when the user taps Link, transiently, in main. Nothing here is fabricated:
 * every row cites at least one real signal.
 */

// Lead with what unlocks the most live data for one token, GitHub pinned first.
function rankScore(s: DetectedService): number {
    let score = 0;
    if (s.id === 'github') score += 1000;
    if (s.powers) score += 100;
    if (s.confidence === 'high') score += 50;
    score += (s.via?.length ?? 0) * 5;
    return score;
}

export function DiscoveredServices({ onConnected }: { onConnected: () => void }) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const profile = useProjectProfile(root);
    const scan = useQuery({
        queryKey: ['env', 'connectable', root],
        queryFn: () => bridge.env.scanConnectable(root),
        enabled: root.length > 0,
        staleTime: 30_000,
    });

    if (root.length === 0) return null;
    if (profile.isLoading) {
        return (
            <section className="flex flex-col gap-3" data-testid="services-discovered-loading">
                <SectionLabel>We noticed this project uses</SectionLabel>
                <UICard className="flex items-center gap-2.5 p-4 shadow-none">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    <p className="text-small text-muted-foreground">Reading your project for the services it uses…</p>
                </UICard>
            </section>
        );
    }

    const services = [...(profile.data?.services ?? [])].sort((a, b) => rankScore(b) - rankScore(a)).slice(0, 8);
    if (services.length === 0) return null;
    const linkable = new Set((scan.data ?? []).map((x) => x.id));

    return (
        <section className="flex flex-col gap-3" data-testid="services-discovered">
            <SectionLabel>We noticed this project uses</SectionLabel>
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-small leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Detected from your files, not guessed.</span> Console reads
                    dependency names, config files, and your <code className="font-mono text-label">.env</code> key NAMES, never the values. Connecting reads a value once to test and store it, then drops it.
                </p>
            </div>
            <div className="flex flex-col gap-2">
                {services.map((s) => (
                    <ServiceRow key={s.id} s={s} linkable={linkable.has(s.id)} root={root} onConnected={onConnected} onLinked={() => void scan.refetch()} />
                ))}
            </div>
        </section>
    );
}

function ServiceRow({ s, linkable, root, onConnected, onLinked }: {
    s: DetectedService;
    linkable: boolean;
    root: string;
    onConnected: () => void;
    onLinked: () => void;
}) {
    const qc = useQueryClient();
    const [busy, setBusy] = useState(false);

    async function link() {
        setBusy(true);
        try {
            const r = await bridge.env.connect(root, s.id);
            if (r.ok) {
                toast.success(`Linked ${s.name} from .env${r.detail ? ` (${r.detail})` : ''}`);
                onConnected();
                onLinked();
                void qc.invalidateQueries({ queryKey: ['ai', 'keyStatus'] });
            } else {
                toast.error(r.error ?? `Could not link ${s.name}`);
            }
        } catch (err) {
            toast.error(`Link failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <UICard className="flex flex-col gap-2.5 p-4 shadow-none" data-testid={`discovered-${s.id}`}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-card-title text-foreground">{s.name}</span>
                <Badge variant={s.confidence === 'high' ? 'success' : 'outline'} className="text-label">
                    {s.confidence === 'high' ? 'High confidence' : 'Found a hint'}
                </Badge>
                {s.via.map((v) => (
                    <span key={v} className="rounded border border-border px-1.5 py-0.5 text-label text-muted-foreground">{v}</span>
                ))}
                {s.powers && <span className="ml-auto text-label text-muted-foreground">Unlocks: {s.powers}</span>}
            </div>

            {s.evidence.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                    <span className="text-label uppercase tracking-wide text-muted-foreground/80">Why we think so</span>
                    {s.evidence.slice(0, 4).map((e) => (
                        <code key={e} className="font-mono text-label text-foreground/80">{e}</code>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                {linkable ? (
                    <Button size="sm" onClick={link} disabled={busy} data-testid={`discovered-link-${s.id}`}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                        Link from .env
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" onClick={() => void bridge.openExternal(s.docsUrl)} data-testid={`discovered-docs-${s.id}`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Set up
                    </Button>
                )}
                <span className="text-label text-muted-foreground">{s.pricing}</span>
            </div>
        </UICard>
    );
}
