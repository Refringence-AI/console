import { useEffect, useMemo, useState } from 'react';
import {
    BookMarked, Copy, ExternalLink, FolderOpen, BookOpen, PanelLeftOpen,
} from 'lucide-react';
import hljs from 'highlight.js';
import { PanelHeader } from '../_shell/PanelHeader';
import { useActiveProject } from '../../lib/activeProject';
import { useLibraryList, useLibraryFile } from '../../lib/queries/library';
import { bridge } from '../../lib/bridge';
import { renderMarkdown } from '@/lib/markdown';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { LibraryNewbie } from './LibraryNewbie';
import { LibraryFolderNav } from './LibraryFolderNav';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui';
import './library-styles.css';

function projectName(p: string): string {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
    const i = norm.lastIndexOf('/');
    return i >= 0 ? norm.slice(i + 1) : norm;
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

export function LibraryPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <LibraryNewbie />;
    return <LibrarySeasoned />;
}

function LibrarySeasoned() {
    const { project } = useActiveProject();
    const root = project?.path ?? null;
    const list = useLibraryList(root);
    const entries = useMemo(() => list.data ?? [], [list.data]);

    // currentPath is the folder the sidebar is showing (posix, '' = root).
    // The drill-down model replaces the old Categories + file-list rails.
    const [currentPath, setCurrentPath] = useState<string>('');
    const [activeRel, setActiveRel] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    // Reset the browse location when the project changes out from under us.
    useEffect(() => {
        setCurrentPath('');
        setActiveRel(null);
    }, [root]);

    if (!root) {
        return (
            <div className="flex h-full min-h-0 flex-col" data-testid="library-panel">
                <PanelHeader
                    icon={BookMarked}
                    title="Library"
                    subtitle="Browse READMEs, docs, configs, and workflows"
                    testid="library-panel-header"
                />
                <EmptyPickFolder />
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="library-panel">
            <PanelHeader
                icon={BookMarked}
                title="Library"
                subtitle={
                    list.isLoading
                        ? `Scanning ${projectName(root)}…`
                        : `${entries.length} files in ${projectName(root)}`
                }
                testid="library-panel-header"
            />

            <div className="flex min-h-0 flex-1">
                {collapsed ? (
                    <div className="flex shrink-0 flex-col items-center border-r border-border bg-card py-2">
                        <button
                            type="button"
                            onClick={() => setCollapsed(false)}
                            data-testid="library-sidebar-expand"
                            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            aria-label="Expand sidebar"
                            title="Expand sidebar"
                        >
                            <PanelLeftOpen className="h-4 w-4" />
                        </button>
                    </div>
                ) : (
                    <aside className="w-[260px] shrink-0 border-r border-border bg-card">
                        <LibraryFolderNav
                            entries={entries}
                            currentPath={currentPath}
                            activeRel={activeRel}
                            rootLabel={projectName(root)}
                            onEnterFolder={setCurrentPath}
                            onNavigatePath={setCurrentPath}
                            onSelectFile={setActiveRel}
                            onCollapse={() => setCollapsed(true)}
                            loading={list.isLoading}
                        />
                    </aside>
                )}

                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <RightPane root={root} relPath={activeRel} />
                </div>
            </div>
        </div>
    );
}

function EmptyPickFolder() {
    async function pick() {
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
        <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
                icon={FolderOpen}
                title="Pick a project folder"
                action={<Button variant="default" size="sm" onClick={pick}>Pick folder</Button>}
            >
                Library reads docs, READMEs, configs, and workflows from the active
                project so you can browse the repo like a book.
            </EmptyState>
        </div>
    );
}

function RightPane({ root, relPath }: { root: string; relPath: string | null }) {
    const file = useLibraryFile(root, relPath);

    const isMarkdown = !!relPath && relPath.toLowerCase().endsWith('.md');
    const readStats = useMemo(() => {
        if (!isMarkdown || !file.data?.content) return null;
        const text = file.data.content.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-]+/g, ' ');
        const words = text.split(/\s+/).filter((w) => w.length > 1).length;
        const minutes = Math.max(1, Math.round(words / 200));
        return { words, minutes };
    }, [isMarkdown, file.data?.content]);

    if (!relPath) {
        return (
            <div className="flex flex-1 items-center justify-center p-8">
                <EmptyState icon={BookOpen} title="Nothing open yet" className="max-w-sm border-none">
                    Choose a file from the list to read it here, rendered like a page.
                </EmptyState>
            </div>
        );
    }

    const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();

    async function copyPath() {
        try { await navigator.clipboard.writeText(`${root}/${relPath}`); } catch { /* noop */ }
    }

    async function openInEditor() {
        if (!relPath) return;
        const absPosix = `${root.replace(/\\/g, '/')}/${relPath}`;
        try { await bridge.openExternal(`vscode://file/${absPosix}`); } catch { /* noop */ }
    }

    return (
        <>
            <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2 text-small">
                <span className="truncate text-muted-foreground">
                    <span className="text-foreground">{projectName(root)}</span>
                    <span className="px-1">/</span>
                    <span className="font-mono">{relPath}</span>
                </span>
                {readStats && (
                    <span
                        data-testid="library-read-stats"
                        className="ml-2 rounded-md border border-border bg-secondary px-2 py-0.5 text-label text-muted-foreground tabular-nums"
                    >
                        {readStats.words.toLocaleString()} words, {readStats.minutes} min read
                    </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={copyPath} className="text-muted-foreground">
                        <Copy className="h-3 w-3" />
                        Copy path
                    </Button>
                    <Button variant="outline" size="sm" onClick={openInEditor} className="text-muted-foreground">
                        <ExternalLink className="h-3 w-3" />
                        Open in editor
                    </Button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[72ch] px-8 py-8">
                    {file.isLoading && (
                        <p className="text-small text-muted-foreground">Reading file from disk.</p>
                    )}
                    {file.isError && (
                        <p className="text-small text-danger-text">This file could not be read. It may have been moved or deleted.</p>
                    )}
                    {!file.isLoading && !file.isError && file.data && (
                        <FileBody ext={ext} content={file.data.content} truncated={file.data.truncated} />
                    )}
                </div>
            </div>
        </>
    );
}

function FileBody({ ext, content, truncated }: { ext: string; content: string; truncated: boolean }) {
    // Hooks must run unconditionally. Pre-compute both possible HTML
    // payloads here and pick which to render below. Cheap for typical
    // 4-200KB doc bodies; lazy alternative would be a switch via
    // useDeferredValue. Fixes the Rules-of-Hooks violation flagged by
    // the batch-5 critique pass (FileBody previously called useMemo
    // inside conditional branches, which crashes React on file kind
    // change).
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
