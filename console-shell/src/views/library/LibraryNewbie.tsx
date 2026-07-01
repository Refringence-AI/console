import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BookMarked, FolderOpen, ExternalLink, ArrowLeft, BookOpen, PanelLeftOpen } from 'lucide-react';
import hljs from 'highlight.js';
import { PanelHeader } from '../_shell/PanelHeader';
import { useActiveProject } from '../../lib/activeProject';
import { useLibraryList, useLibraryFile } from '../../lib/queries/library';
import { bridge } from '../../lib/bridge';
import { renderMarkdown } from '@/lib/markdown';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { humanizeTitle } from '../../lib/humanize';
import { LibraryFolderNav } from './LibraryFolderNav';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import './library-styles.css';

/**
 * Newbie-mode Library.
 *
 * One collapsible folder-navigation sidebar on the left, reader on the
 * right. Same drill-down model as Operator (shared LibraryFolderNav, calm
 * variant), so the two modes stay consistent. Picking a file opens its
 * content inline in the reader (markdown via marked, code via hljs). A
 * secondary "Open in editor" link keeps the old external behaviour.
 */

function projectName(p: string): string {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
    const i = norm.lastIndexOf('/');
    return i >= 0 ? norm.slice(i + 1) : norm;
}

// Extensions the in-app reader can render. The list IPC only ever returns
// these plus licence files, so this is defensive, but it lets a future
// binary entry fall through to the "Open in editor" path gracefully.
const TEXT_EXTS = new Set(['.md', '.yml', '.yaml', '.json', '.toml', '.txt', '']);

function titleFromRelPath(rel: string): string {
    const norm = rel.replace(/\\/g, '/');
    const base = norm.slice(norm.lastIndexOf('/') + 1);
    return humanizeTitle(base);
}

function firstH1(content: string): string | null {
    const m = content.match(/^\s*#\s+(.+?)\s*$/m);
    if (!m) return null;
    return m[1].trim();
}

function readStats(content: string): { words: number; minutes: number } {
    const text = content
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`~\-]+/g, ' ');
    const words = text.split(/\s+/).filter((w) => w.length > 1).length;
    const minutes = Math.max(1, Math.round(words / 200));
    return { words, minutes };
}

function extOf(rel: string): string {
    const norm = rel.replace(/\\/g, '/');
    const base = norm.slice(norm.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

function langFromExt(ext: string): string {
    switch (ext) {
        case '.json': return 'json';
        case '.yml':
        case '.yaml': return 'yaml';
        case '.toml': return 'toml';
        case '.md':   return 'markdown';
        default:      return 'plaintext';
    }
}

function absPathFor(root: string, rel: string): string {
    const sep = root.includes('\\') ? '\\' : '/';
    return root.replace(/[\\/]+$/, '') + sep + rel.replace(/^[\\/]+/, '');
}

export function LibraryNewbie() {
    const { project } = useActiveProject();
    const { setPersona } = usePersonaMode();
    const root = project?.path ?? null;
    const list = useLibraryList(root);
    const entries = useMemo(() => list.data ?? [], [list.data]);

    // currentPath is the folder the sidebar is showing (posix, '' = root);
    // same drill-down model as Operator, calmer presentation.
    const [currentPath, setCurrentPath] = useState<string>('');
    const [activeRel, setActiveRel] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        setCurrentPath('');
        setActiveRel(null);
    }, [root]);

    // openFile shells out to the OS file association (the old "Open"
    // behaviour, now demoted to a secondary "Open in editor" link).
    async function openFile(rel: string) {
        if (!root) return;
        const r = await bridge.openPath(absPathFor(root, rel));
        if (r.ok) {
            toast.success('Opened ' + titleFromRelPath(rel));
        } else {
            toast.error('Could not open file', { description: r.error || rel });
        }
    }

    async function pickFolder() {
        const r = await bridge.project.pickFolder();
        if (!r.canceled && r.path) {
            try {
                window.localStorage.setItem('refringence-console-active-project', r.path);
                window.localStorage.setItem('refringence-console-active-project-pickedAt', String(Date.now()));
                window.dispatchEvent(new CustomEvent('console-active-project-change'));
            } catch { /* noop */ }
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="library-newbie">
            <PanelHeader
                icon={BookMarked}
                title="Library"
                subtitle={
                    list.isLoading
                        ? 'Scanning project files'
                        : root
                            ? `${entries.length} files`
                            : 'No active project'
                }
                testid="library-newbie-header"
            />

            {!root ? (
                <div className="flex-1 overflow-y-auto px-6 py-8">
                    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8">
                        <Card className="gap-4 p-5">
                            <h2 className="text-section text-foreground">
                                Pick a project folder
                            </h2>
                            <p className="text-body leading-relaxed text-muted-foreground">
                                Library reads docs, READMEs, configs, and workflows from the active project.
                            </p>
                            <Button
                                variant="default"
                                className="w-fit"
                                onClick={pickFolder}
                                data-testid="library-newbie-pick-folder"
                            >
                                <FolderOpen className="h-4 w-4" />
                                Pick folder
                            </Button>
                        </Card>
                    </div>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1">
                    {/* Left: one collapsible folder-nav sidebar (calm variant). */}
                    {collapsed ? (
                        <div className="flex shrink-0 flex-col items-center border-r border-border bg-card py-2">
                            <button
                                type="button"
                                onClick={() => setCollapsed(false)}
                                data-testid="library-newbie-sidebar-expand"
                                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                aria-label="Expand sidebar"
                                title="Expand sidebar"
                            >
                                <PanelLeftOpen className="h-4 w-4" />
                            </button>
                        </div>
                    ) : (
                        <aside
                            className="flex w-[260px] shrink-0 flex-col border-r border-border bg-card"
                            data-testid="library-newbie-list"
                        >
                            <div className="min-h-0 flex-1">
                                <LibraryFolderNav
                                    entries={entries}
                                    currentPath={currentPath}
                                    activeRel={activeRel}
                                    rootLabel={projectName(root)}
                                    onEnterFolder={setCurrentPath}
                                    onNavigatePath={setCurrentPath}
                                    onSelectFile={setActiveRel}
                                    onCollapse={() => setCollapsed(true)}
                                    calm
                                    loading={list.isLoading}
                                />
                            </div>
                            <footer className="border-t border-border px-3 py-3">
                                <Button
                                    variant="link"
                                    onClick={() => setPersona('seasoned')}
                                    className="px-0"
                                    data-testid="library-newbie-switch-power"
                                >
                                    Switch to Operator view
                                </Button>
                            </footer>
                        </aside>
                    )}

                    {/* Right: in-app reader, the wide majority of the width. */}
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                        {activeRel ? (
                            <Reader
                                root={root}
                                relPath={activeRel}
                                onBack={() => setActiveRel(null)}
                                onOpenInEditor={() => { void openFile(activeRel); }}
                            />
                        ) : (
                            <div className="flex flex-1 items-center justify-center p-8">
                                <div className="max-w-sm text-center">
                                    <BookOpen className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
                                    <p className="text-body leading-relaxed text-muted-foreground">
                                        Open a folder on the left, then pick a file to read it here.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function Reader({
    root, relPath, onBack, onOpenInEditor,
}: {
    root: string;
    relPath: string;
    onBack: () => void;
    onOpenInEditor: () => void;
}) {
    const file = useLibraryFile(root, relPath);
    const ext = extOf(relPath);
    const isText = TEXT_EXTS.has(ext);

    const title = useMemo(() => {
        if (ext === '.md' && file.data?.content) {
            const h1 = firstH1(file.data.content);
            if (h1) return h1;
        }
        return titleFromRelPath(relPath);
    }, [ext, file.data?.content, relPath]);

    const stats = useMemo(() => {
        if (ext !== '.md' || !file.data?.content) return null;
        return readStats(file.data.content);
    }, [ext, file.data?.content]);

    return (
        <section
            className="flex min-w-0 flex-1 flex-col overflow-hidden"
            data-testid="library-newbie-reader"
        >
            <div className="flex items-center gap-3 border-b border-border bg-card px-5 py-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    className="shrink-0 text-muted-foreground"
                    data-testid="library-newbie-reader-back"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-card-title text-foreground">{title}</span>
                    <span className="truncate text-small text-muted-foreground">
                        {stats
                            ? `${stats.words.toLocaleString()} words, ${stats.minutes} min read`
                            : titleFromRelPath(relPath)}
                    </span>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenInEditor}
                    className="ml-auto shrink-0 text-muted-foreground"
                    data-testid="library-newbie-open-editor"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in editor
                </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[72ch] px-8 py-8">
                    {file.isLoading && (
                        <p className="text-body text-muted-foreground">Reading file.</p>
                    )}
                    {file.isError && (
                        <p className="text-body text-danger-text">
                            Could not read this file. It may have been moved or deleted.
                        </p>
                    )}
                    {!file.isLoading && !file.isError && !isText && (
                        <Card className="gap-3 p-5" data-testid="library-newbie-binary">
                            <p className="text-body leading-relaxed text-muted-foreground">
                                This file cannot be previewed in app. Open it in your editor to view it.
                            </p>
                            <Button
                                variant="default"
                                className="w-fit"
                                onClick={onOpenInEditor}
                            >
                                <ExternalLink className="h-4 w-4" />
                                Open in editor
                            </Button>
                        </Card>
                    )}
                    {!file.isLoading && !file.isError && isText && file.data && (
                        <ReaderBody
                            ext={ext}
                            content={file.data.content}
                            truncated={file.data.truncated}
                        />
                    )}
                </div>
            </div>
        </section>
    );
}

function ReaderBody({ ext, content, truncated }: { ext: string; content: string; truncated: boolean }) {
    // Hooks run unconditionally: pre-compute both render payloads, then
    // pick one below. Mirrors LibrarySeasoned's FileBody so the two modes
    // stay visually identical.
    const markdownHtml = useMemo(
        () => (ext === '.md' ? renderMarkdown(content) : ''),
        [ext, content],
    );
    const codeLang = langFromExt(ext);
    const codeHtml = useMemo(() => {
        if (ext !== '.json' && ext !== '.yml' && ext !== '.yaml' && ext !== '.toml') return '';
        try {
            return hljs.highlight(content, { language: codeLang }).value;
        } catch {
            return hljs.highlightAuto(content).value;
        }
    }, [ext, content, codeLang]);

    if (ext === '.md') {
        return (
            <>
                <div data-testid="library-body" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
                {truncated && <TruncatedNote />}
            </>
        );
    }
    if (ext === '.json' || ext === '.yml' || ext === '.yaml' || ext === '.toml') {
        return (
            <>
                <pre data-testid="library-body" className="library-code">
                    <code
                        className={`hljs language-${codeLang}`}
                        dangerouslySetInnerHTML={{ __html: codeHtml }}
                    />
                </pre>
                {truncated && <TruncatedNote />}
            </>
        );
    }
    return (
        <>
            <pre data-testid="library-body" className="library-code">
                <code>{content}</code>
            </pre>
            {truncated && <TruncatedNote />}
        </>
    );
}

function TruncatedNote() {
    return (
        <p className="mt-4 rounded-md border border-border bg-secondary px-3 py-2 text-small text-muted-foreground">
            File truncated at 256 KB. Open in editor to see the rest.
        </p>
    );
}
