import { useState } from 'react';
import { Wrench, FileCheck2, ChevronDown, ChevronRight } from 'lucide-react';
import { bridge, type GroundedError } from '../../lib/bridge';
import { readActiveProject } from '../../lib/activeProject';
import { Button } from '@/components/ui';
import { HandoffBar } from '../prompts/HandoffBar';

/**
 * The "ground" step of the golden path: paste an error or stack trace, and
 * Console pulls the real failing files out of it - matching them against this
 * repo - and drafts a fix prompt anchored to those paths, ready to hand to a dev
 * tool. Grounded in real paths, never a guess.
 */
export function GroundError() {
    const root = readActiveProject()?.path ?? '';
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const [result, setResult] = useState<GroundedError | null>(null);
    const [busy, setBusy] = useState(false);
    if (!root) return null;

    async function ground() {
        if (text.trim().length === 0) return;
        setBusy(true);
        try { setResult(await bridge.ground.error(root, text)); }
        catch { setResult(null); }
        finally { setBusy(false); }
    }

    return (
        <div className="mx-6 mt-4 rounded-xl border border-border bg-card" data-testid="issues-ground">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
                data-testid="issues-ground-toggle"
            >
                <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-small font-medium text-foreground">Turn an error into a grounded fix prompt</span>
                {open ? <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" /> : <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />}
            </button>

            {open && (
                <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Paste an error message or stack trace…"
                        rows={4}
                        className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-small text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="issues-ground-input"
                    />
                    <div className="flex items-center gap-2">
                        <Button size="sm" loading={busy} disabled={text.trim().length === 0} onClick={ground} data-testid="issues-ground-run">
                            Ground it
                        </Button>
                        <span className="text-label text-muted-foreground">Reads only files already in this repo. Nothing leaves your machine.</span>
                    </div>

                    {result && (
                        <div className="flex flex-col gap-3" data-testid="issues-ground-result">
                            {result.foundPaths.length > 0 ? (
                                <div className="flex flex-col gap-1 rounded-lg border border-success/30 bg-success/10 px-3 py-2">
                                    <p className="flex items-center gap-1.5 text-small font-medium text-success-text">
                                        <FileCheck2 className="h-3.5 w-3.5" /> Files found in this repo:
                                    </p>
                                    {result.foundPaths.slice(0, 8).map((p) => (
                                        <code key={p} className="font-mono text-label text-foreground/80">{p}</code>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-small text-muted-foreground">
                                    No matching files found in this repo, so the prompt asks the agent to search from the error's symbols.
                                </p>
                            )}
                            <textarea
                                readOnly
                                value={result.prompt}
                                rows={6}
                                className="w-full resize-y rounded-md border border-border bg-secondary/30 px-2.5 py-2 font-mono text-label text-foreground/90 outline-none"
                                data-testid="issues-ground-prompt"
                            />
                            <HandoffBar filled={result.prompt} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
