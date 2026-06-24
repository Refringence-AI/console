import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Check } from 'lucide-react';

import { bridge, type GuidelineTarget, type GuidelineStatus } from '../../lib/bridge';
import { Button } from '@/components/ui/button';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';

/**
 * "Set up project for Console" action. Previews the generated guideline and
 * writes it into AGENTS.md (or .cursorrules) through the shared managed-block
 * writers. The button lives on the Repo panel header; the preview is a plain
 * read-only dialog so the user sees what lands before it lands.
 */
export function GuidelineSetup({ projectRoot }: { projectRoot: string }) {
    const [open, setOpen] = useState(false);
    const [target, setTarget] = useState<GuidelineTarget>('agents-md');
    const [busy, setBusy] = useState(false);

    const preview = useQuery<string>({
        queryKey: ['guidelines', 'generate'],
        queryFn: async () => {
            const res = await bridge.guidelines.generate();
            return res.ok && res.content ? res.content : '';
        },
        enabled: open,
        staleTime: 5 * 60_000,
    });

    const status = useQuery<GuidelineStatus>({
        queryKey: ['guidelines', 'status', projectRoot],
        queryFn: () => bridge.guidelines.status(projectRoot),
        staleTime: 30_000,
    });

    async function write() {
        setBusy(true);
        try {
            const res = await bridge.guidelines.write(projectRoot, target);
            if (res.ok) {
                toast.success(`Guideline written to ${target === 'cursorrules' ? '.cursorrules' : 'AGENTS.md'}`);
                setOpen(false);
                void status.refetch();
            } else {
                toast.error(res.error ?? 'Could not write the guideline');
            }
        } catch (err) {
            toast.error(`Write failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }

    const alreadyWritten = (status.data?.agentsMd ?? false) || (status.data?.cursorRules ?? false);

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(true)}
                data-testid="guideline-setup-open"
            >
                {alreadyWritten ? <Check className="h-3 w-3 text-success" /> : <FileText className="h-3 w-3" />}
                Set up for Console
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl" data-testid="guideline-setup-dialog">
                    <DialogHeader>
                        <DialogTitle>Set up project for Console</DialogTitle>
                        <DialogDescription>
                            This writes a guideline that tells your coding agent how to shape
                            the project so Console reads it well. It lands in a managed block,
                            so your own notes in the file are left alone.
                        </DialogDescription>
                    </DialogHeader>

                    <pre
                        data-testid="guideline-preview"
                        className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-3 text-small leading-relaxed text-foreground"
                    >
                        {preview.isLoading ? 'Generating preview...' : (preview.data || 'No content.')}
                    </pre>

                    <div className="flex items-center gap-2">
                        <span className="text-small text-muted-foreground">Write to</span>
                        <div className="flex overflow-hidden rounded-md border border-border" role="tablist">
                            <TargetButton id="agents-md" current={target} setCurrent={setTarget}>AGENTS.md</TargetButton>
                            <TargetButton id="cursorrules" current={target} setCurrent={setTarget}>.cursorrules</TargetButton>
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline" size="sm" disabled={busy}>Cancel</Button>
                        </DialogClose>
                        <Button size="sm" disabled={busy || preview.isLoading} onClick={write} data-testid="guideline-setup-write">
                            {busy ? 'Writing…' : 'Write guideline'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function TargetButton({
    id, current, setCurrent, children,
}: {
    id: GuidelineTarget; current: GuidelineTarget; setCurrent: (t: GuidelineTarget) => void; children: React.ReactNode;
}) {
    const active = current === id;
    return (
        <button
            type="button"
            data-testid={`guideline-target-${id}`}
            aria-pressed={active}
            onClick={() => setCurrent(id)}
            className={`px-2.5 py-1 text-label transition-colors ${
                id === 'cursorrules' ? 'border-l border-border' : ''
            } ${
                active
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground hover:bg-secondary/50'
            }`}
        >
            {children}
        </button>
    );
}
