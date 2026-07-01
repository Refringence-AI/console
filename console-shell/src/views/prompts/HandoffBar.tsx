import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ClipboardCopy,
    FileCog,
    FileText,
    TerminalSquare,
    FolderOpen,
    ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { bridge, type DevToolDetect, type PromptLeak } from '../../lib/bridge';
import { readActiveProject } from '../../lib/activeProject';

/**
 * Dev-tool router. Hands the filled prompt to the dev tool through its own
 * entry point: copy, write .cursorrules (Cursor / Windsurf), write AGENTS.md
 * (the Claude CLI and others), run `claude` directly, or open the folder in
 * Cursor. Each button is gated by what `devhandoff.detect()` actually found.
 */
export function HandoffBar({ filled }: { filled: string }) {
    const detect = useQuery<DevToolDetect>({
        queryKey: ['devhandoff', 'detect'],
        queryFn: () => bridge.devhandoff.detect(),
        staleTime: 60_000,
    });
    const tools = detect.data;
    const [busy, setBusy] = useState<string | null>(null);
    const [leak, setLeak] = useState<{ findings: PromptLeak[]; run: () => void | Promise<void> } | null>(null);

    const text = filled.trim();
    const hasText = text.length > 0;
    const root = readActiveProject()?.path ?? '';

    // Leakage guard: scan the prompt for secret formats before any action that
    // sends it to a dev tool. A scan failure never blocks the handoff.
    async function guard(run: () => void | Promise<void>) {
        try {
            const found = await bridge.devhandoff.scanText(text);
            if (found.length > 0) { setLeak({ findings: found, run }); return; }
        } catch { /* scan unavailable - do not block */ }
        await run();
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(text);
            if (root) void bridge.devhandoff.logCopy(root, text);
            toast.success('Copied the filled prompt');
        } catch {
            toast.error('Could not copy to the clipboard');
        }
    }

    async function writeCursor() {
        if (!root) { toast.error('Pick an active project first'); return; }
        setBusy('cursor');
        try {
            const res = await bridge.devhandoff.writeCursorRules(root, text, 'replace');
            if (res.ok) toast.success('Wrote .cursorrules');
            else toast.error(res.error ?? 'Could not write .cursorrules');
        } finally {
            setBusy(null);
        }
    }

    async function writeAgents() {
        if (!root) { toast.error('Pick an active project first'); return; }
        setBusy('agents');
        try {
            const res = await bridge.devhandoff.writeAgentsMd(root, text, 'replace');
            if (res.ok) toast.success('Wrote AGENTS.md');
            else toast.error(res.error ?? 'Could not write AGENTS.md');
        } finally {
            setBusy(null);
        }
    }

    async function runClaude() {
        setBusy('claude');
        try {
            const res = await bridge.devhandoff.runClaude({ prompt: text, cwd: root || undefined });
            if (res.ok) toast.success('Started a Claude Code run');
            else toast.error(res.error ?? 'Could not start Claude Code');
        } finally {
            setBusy(null);
        }
    }

    async function openCursor() {
        setBusy('open-cursor');
        try {
            const res = await bridge.devhandoff.openInCursor(root || undefined);
            if (!res.ok) toast.error(res.error ?? 'Could not open Cursor');
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-col gap-2" data-testid="handoff-bar">
            {leak && (
                <div
                    className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 p-3"
                    data-testid="handoff-leak-warning"
                >
                    <p className="flex items-center gap-1.5 text-small font-medium text-danger">
                        <ShieldAlert className="h-4 w-4 shrink-0" />
                        This prompt looks like it contains a secret
                    </p>
                    <ul className="flex flex-col gap-0.5 pl-6 text-small text-muted-foreground">
                        {leak.findings.slice(0, 5).map((f, i) => (
                            <li key={i}>
                                line {f.line}: {f.type} (<code className="font-mono">{f.preview}</code>)
                            </li>
                        ))}
                    </ul>
                    <p className="text-small text-muted-foreground">
                        Sending it to your dev tool could leak the key. Remove it from the prompt, or send anyway if it is a placeholder.
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            data-testid="handoff-leak-send"
                            onClick={() => { const run = leak.run; setLeak(null); void run(); }}
                        >
                            Send anyway
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setLeak(null)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void guard(copy)}
                    disabled={!hasText}
                    className="gap-1.5"
                    data-testid="handoff-copy"
                >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Copy
                </Button>

                <GatedButton
                    label="Write .cursorrules"
                    icon={FileCog}
                    testid="handoff-cursorrules"
                    enabled={hasText && !!root}
                    detected={tools?.cursor || tools?.windsurf}
                    detectHint="Cursor or Windsurf not found on PATH. The file is still written."
                    busy={busy === 'cursor'}
                    onClick={() => void guard(writeCursor)}
                />

                <GatedButton
                    label="Write AGENTS.md"
                    icon={FileText}
                    testid="handoff-agentsmd"
                    enabled={hasText && !!root}
                    detected
                    busy={busy === 'agents'}
                    onClick={() => void guard(writeAgents)}
                />

                <GatedButton
                    label="Run in Claude Code"
                    icon={TerminalSquare}
                    testid="handoff-claude"
                    enabled={hasText && !!tools?.claudeCli}
                    detected={tools?.claudeCli}
                    detectHint="The claude CLI was not found on PATH."
                    busy={busy === 'claude'}
                    onClick={() => void guard(runClaude)}
                />

                <GatedButton
                    label="Open in Cursor"
                    icon={FolderOpen}
                    testid="handoff-open-cursor"
                    enabled={!!root}
                    detected={tools?.cursor}
                    detectHint="Cursor CLI not found. Opens with your OS folder handler instead."
                    busy={busy === 'open-cursor'}
                    onClick={openCursor}
                />
            </div>
        </div>
    );
}

function GatedButton({
    label,
    icon: Icon,
    testid,
    enabled,
    detected,
    detectHint,
    busy,
    onClick,
}: {
    label: string;
    icon: typeof FileCog;
    testid: string;
    enabled: boolean;
    detected?: boolean;
    detectHint?: string;
    busy: boolean;
    onClick: () => void;
}) {
    const button = (
        <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClick}
            disabled={!enabled || busy}
            className="gap-1.5"
            data-testid={testid}
        >
            <Icon className="h-3.5 w-3.5" />
            {busy ? 'Working...' : label}
        </Button>
    );
    // A not-detected tool keeps its button (some actions still work) but
    // explains the gap on hover, so the user is never left guessing.
    if (detected === false && detectHint) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="top">{detectHint}</TooltipContent>
            </Tooltip>
        );
    }
    return button;
}
