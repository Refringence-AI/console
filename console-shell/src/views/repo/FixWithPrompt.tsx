import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wrench, Copy, BookMarked, Terminal, FileCode2, Loader2 } from 'lucide-react';
import { bridge } from '../../lib/bridge';
import { useActiveProject } from '../../lib/activeProject';
import { useProjectShape, useStackDetect } from '../../lib/queries/project';
import { Button } from '@/components/ui/button';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/**
 * Close the health loop: turn a finding from the Repo health checks into a ready,
 * project-specific setup prompt the user hands to their dev tool (Cursor / Claude
 * Code) or saves to the prompt library. Templates are deterministic - no model
 * call - and parameterized by the detected stack + start command.
 */
export type FixKind =
    | 'missing-readme' | 'missing-license' | 'missing-gitignore' | 'missing-ci'
    | 'missing-lockfile' | 'missing-tests' | 'missing-env-example'
    | 'vulnerable-deps' | 'outdated-deps' | 'exposed-secret';

export function buildFixPrompt(kind: FixKind, opts: { detail?: string; stacks?: string[]; startCommand?: string }): { title: string; body: string } {
    const stack = opts.stacks && opts.stacks.length > 0 ? opts.stacks.join(', ') : 'this';
    const run = opts.startCommand ? `\`${opts.startCommand}\`` : "the project's start command";
    const isPy = (opts.stacks ?? []).some((s) => /python|django|flask|fastapi/i.test(s));
    const testFw = isPy ? 'pytest' : 'vitest';
    switch (kind) {
        case 'missing-ci':
            return { title: 'Set up CI', body: `Add a CI pipeline for this ${stack} project. Create .github/workflows/ci.yml that, on push and pull_request to the default branch, checks out the code, installs dependencies, and runs the test suite plus the type-check/build. Keep it minimal and fast, and do not add anything the project does not already use.` };
        case 'missing-tests':
            return { title: 'Set up tests', body: `Set up a test harness for this ${stack} project using ${testFw}. Add a "test" script, configure ${testFw}, and write one real example test for the most important module that actually exercises its behavior. Make sure the test command passes.` };
        case 'missing-license':
            return { title: 'Add a license', body: `Add an MIT LICENSE file at the repo root with the current year, and set the license field in the project manifest to "MIT". If a different license is more appropriate for ${stack}, ask me first.` };
        case 'missing-gitignore':
            return { title: 'Add .gitignore', body: `Add a .gitignore at the repo root for a ${stack} project. Cover dependency directories, build/output, environment files (.env and friends), logs, OS cruft, and editor folders. Do not ignore source or lockfiles.` };
        case 'missing-readme':
            return { title: 'Write a README', body: `Write a README.md for this ${stack} project: a one-line description, what it does, the tech stack, how to install dependencies, how to run it (${run}), and how to run the tests. Keep it concise and accurate to the actual code - do not invent features.` };
        case 'missing-lockfile':
            return { title: 'Commit a lockfile', body: `This project has no lockfile, so installs are not reproducible. Run the install for ${stack}'s package manager to generate the lockfile, then commit it.` };
        case 'missing-env-example':
            return { title: 'Add .env.example', body: `Create a .env.example at the repo root listing the NAME of every environment variable this project reads (no values), based on the source and the existing .env. Add a short comment per variable explaining what it is.` };
        case 'vulnerable-deps':
            return { title: 'Patch vulnerable deps', body: `These dependencies have known security advisories: ${opts.detail || '(see the Repo panel)'}. Update each to the lowest version that resolves the advisory, then run the test suite and the app to confirm nothing broke. If a fix needs a breaking major bump, tell me before doing it.` };
        case 'outdated-deps':
            return { title: 'Update outdated deps', body: `Update these outdated dependencies to their latest compatible versions: ${opts.detail || '(see the Repo panel)'}. Stay within the current major unless I approve a major bump. Run the tests after.` };
        case 'exposed-secret':
            return { title: 'Move secret out of source', body: `There is a hardcoded secret at ${opts.detail || '(the flagged file)'}. Move it to an environment variable: read it from the environment at runtime, put the real value in .env (which must be gitignored), and add the variable NAME to .env.example. Then rotate the exposed key, since it has been committed to source.` };
    }
}

export function FixButton({ kind, detail }: { kind: FixKind; detail?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-small text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(true)}
                data-testid={`fix-${kind}`}
                title="Turn this into a setup prompt for your dev tool"
            >
                <Wrench className="size-3" /> Fix
            </Button>
            {open && <FixDialog kind={kind} detail={detail} open={open} onOpenChange={setOpen} />}
        </>
    );
}

function FixDialog({ kind, detail, open, onOpenChange }: { kind: FixKind; detail?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const shape = useProjectShape(root);
    const stack = useStackDetect(root);
    const tools = useQuery({ queryKey: ['devhandoff', 'detect'], queryFn: () => bridge.devhandoff.detect(), staleTime: 60_000 });
    const [busy, setBusy] = useState<string | null>(null);

    const prompt = buildFixPrompt(kind, {
        detail,
        stacks: stack.data?.stacks,
        startCommand: shape.data?.runnable ? shape.data?.startCommand : undefined,
    });

    async function copy() {
        try { await navigator.clipboard.writeText(prompt.body); toast.success('Prompt copied'); }
        catch { toast.error('Could not copy'); }
    }
    async function save() {
        if (!root) { toast.error('Open a project first.'); return; }
        setBusy('save');
        try {
            const r = await bridge.prompts.create(root, { title: prompt.title, body: prompt.body, variables: [], category: 'Setup', tags: ['setup', kind] });
            if (r.ok) toast.success('Saved to the prompt library'); else toast.error(r.error ?? 'Could not save');
        } catch (err) { toast.error(`Save failed: ${String(err)}`); }
        finally { setBusy(null); }
    }
    async function toCursor() {
        if (!root) return;
        setBusy('cursor');
        try {
            const r = await bridge.devhandoff.writeCursorRules(root, prompt.body, 'append');
            if (r.ok) toast.success('Appended to Cursor rules'); else toast.error(r.error ?? 'Could not write Cursor rules');
        } catch (err) { toast.error(`Cursor handoff failed: ${String(err)}`); }
        finally { setBusy(null); }
    }
    async function runClaude() {
        if (!root) return;
        setBusy('claude');
        try {
            const r = await bridge.devhandoff.runClaude({ prompt: prompt.body, cwd: root });
            if (r.ok) { toast.success('Sent to Claude Code'); onOpenChange(false); } else toast.error(r.error ?? 'Could not run Claude');
        } catch (err) { toast.error(`Claude run failed: ${String(err)}`); }
        finally { setBusy(null); }
    }

    const detect = tools.data;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent data-testid="fix-dialog" className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{prompt.title}</DialogTitle>
                    <DialogDescription>A ready prompt for your dev tool, built from this project. Copy it, save it to the library, or hand it straight off.</DialogDescription>
                </DialogHeader>
                <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-secondary/30 p-3">
                    <p className="whitespace-pre-wrap text-small leading-relaxed text-foreground" data-testid="fix-prompt-body">{prompt.body}</p>
                </div>
                <DialogFooter className="gap-2 sm:justify-end">
                    <Button size="sm" variant="outline" onClick={copy}><Copy className="size-3.5" /> Copy</Button>
                    <Button size="sm" variant="outline" onClick={save} disabled={busy === 'save'}>
                        {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <BookMarked className="size-3.5" />} Save to library
                    </Button>
                    {detect?.cursor && (
                        <Button size="sm" variant="outline" onClick={toCursor} disabled={busy === 'cursor'}>
                            {busy === 'cursor' ? <Loader2 className="size-3.5 animate-spin" /> : <FileCode2 className="size-3.5" />} Cursor rules
                        </Button>
                    )}
                    {detect?.claudeCli
                        ? (
                            <Button variant="primary" size="sm" onClick={runClaude} disabled={busy === 'claude'}>
                                {busy === 'claude' ? <Loader2 className="size-3.5 animate-spin" /> : <Terminal className="size-3.5" />} Run in Claude Code
                            </Button>
                        )
                        : <Button variant="primary" size="sm" onClick={copy}><Copy className="size-3.5" /> Copy prompt</Button>}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
