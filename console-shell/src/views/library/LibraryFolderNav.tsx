import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Folder, FileText } from 'lucide-react';
import type { LibraryEntry } from '../../lib/bridge';
import { humanizeTitle } from '../../lib/humanize';

/**
 * Single collapsible folder-navigation sidebar shared by both Library
 * variants (Operator + Guided). Replaces the old two-rail Categories +
 * file-list layout so the reading pane gets the width.
 *
 * The flat LibraryEntry[] is treated as a virtual folder tree keyed on
 * relPath segments. The sidebar only ever shows ONE level: the folders
 * and files that live directly under the current path. Clicking a folder
 * drills in (replaces the level); the Back row climbs to the parent.
 */

export interface FolderNode {
    name: string;
    fullPath: string; // posix-joined path of segments, no trailing slash
    fileCount: number; // files in this subtree (recursive), for the count badge
}

export interface FileNode {
    entry: LibraryEntry;
    name: string; // last relPath segment
}

function normRel(rel: string): string {
    return rel.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Compute the folders and files directly under `currentPath` (posix, no
 * trailing slash; '' is the root). Folders aggregate their whole subtree's
 * file count so the badge is meaningful at every level.
 */
export function levelEntries(
    entries: LibraryEntry[],
    currentPath: string,
): { folders: FolderNode[]; files: FileNode[] } {
    const prefix = currentPath ? currentPath + '/' : '';
    const folderCounts = new Map<string, number>();
    const files: FileNode[] = [];

    for (const e of entries) {
        const rel = normRel(e.relPath);
        if (prefix && !rel.startsWith(prefix)) continue;
        const rest = rel.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf('/');
        if (slash === -1) {
            files.push({ entry: e, name: rest });
        } else {
            const folderName = rest.slice(0, slash);
            folderCounts.set(folderName, (folderCounts.get(folderName) ?? 0) + 1);
        }
    }

    const folders: FolderNode[] = [...folderCounts.entries()]
        .map(([name, fileCount]) => ({
            name,
            fullPath: prefix + name,
            fileCount,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    files.sort((a, b) => a.name.localeCompare(b.name));

    return { folders, files };
}

/** Crumb segments for the current path, including a leading root label. */
export function pathCrumbs(currentPath: string, rootLabel: string): Array<{ label: string; path: string }> {
    const crumbs: Array<{ label: string; path: string }> = [{ label: rootLabel, path: '' }];
    if (!currentPath) return crumbs;
    const parts = currentPath.split('/');
    let acc = '';
    for (const p of parts) {
        acc = acc ? acc + '/' + p : p;
        crumbs.push({ label: humanizeTitle(p), path: acc });
    }
    return crumbs;
}

export function parentOf(currentPath: string): string {
    const i = currentPath.lastIndexOf('/');
    return i === -1 ? '' : currentPath.slice(0, i);
}

/**
 * The drill-down sidebar body. Stateless: the parent owns currentPath +
 * activeRel and reacts to the callbacks. `calm` simplifies the Guided look
 * (drops mtime/ext metadata) without changing the folder-nav model.
 */
export function LibraryFolderNav({
    entries,
    currentPath,
    activeRel,
    rootLabel,
    onEnterFolder,
    onNavigatePath,
    onSelectFile,
    onCollapse,
    calm = false,
    loading = false,
}: {
    entries: LibraryEntry[];
    currentPath: string;
    activeRel: string | null;
    rootLabel: string;
    onEnterFolder: (path: string) => void;
    onNavigatePath: (path: string) => void;
    onSelectFile: (relPath: string) => void;
    onCollapse: () => void;
    calm?: boolean;
    loading?: boolean;
}) {
    const { folders, files } = useMemo(
        () => levelEntries(entries, currentPath),
        [entries, currentPath],
    );
    const crumbs = useMemo(() => pathCrumbs(currentPath, rootLabel), [currentPath, rootLabel]);
    const atRoot = currentPath === '';
    const currentName = crumbs[crumbs.length - 1].label;

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="library-folder-nav">
            {/* Header: Back/up control + current location + collapse. */}
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
                <button
                    type="button"
                    onClick={() => onNavigatePath(parentOf(currentPath))}
                    disabled={atRoot}
                    data-testid="library-folder-back"
                    className={
                        'flex items-center gap-1 rounded-md px-1.5 py-1 text-small transition-colors ' +
                        (atRoot
                            ? 'cursor-default text-muted-foreground/40'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground')
                    }
                    aria-label="Go up one folder"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                </button>
                <span
                    className="ml-1 min-w-0 flex-1 truncate text-small font-medium text-foreground"
                    title={currentPath || rootLabel}
                    data-testid="library-folder-current"
                >
                    {currentName}
                </span>
                <button
                    type="button"
                    onClick={onCollapse}
                    data-testid="library-sidebar-collapse"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label="Collapse sidebar"
                    title="Collapse sidebar"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
            </div>

            {/* Breadcrumb trail of the path back to root. */}
            {!atRoot && (
                <div
                    className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-border px-3 py-1.5 text-label text-muted-foreground"
                    data-testid="library-folder-breadcrumb"
                >
                    {crumbs.map((c, i) => (
                        <span key={c.path} className="flex items-center gap-1">
                            {i > 0 && <span aria-hidden className="text-muted-foreground/40">/</span>}
                            <button
                                type="button"
                                onClick={() => onNavigatePath(c.path)}
                                disabled={i === crumbs.length - 1}
                                className={
                                    i === crumbs.length - 1
                                        ? 'cursor-default text-foreground'
                                        : 'hover:text-foreground'
                                }
                            >
                                {c.label}
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                    <div className="space-y-1.5 p-3" data-testid="library-list-loading">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <div
                                key={i}
                                className="relative h-9 overflow-hidden rounded-md bg-secondary/40"
                            >
                                <div
                                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/5 to-transparent"
                                    style={{ animation: 'library-shimmer 1.4s infinite' }}
                                />
                            </div>
                        ))}
                    </div>
                ) : folders.length === 0 && files.length === 0 ? (
                    <p className="p-4 text-small text-muted-foreground">
                        This folder is empty.
                    </p>
                ) : (
                    <ul className="flex flex-col py-1" data-testid="library-folder-list">
                        {folders.map((f) => (
                            <li key={'dir:' + f.fullPath}>
                                <button
                                    type="button"
                                    onClick={() => onEnterFolder(f.fullPath)}
                                    data-testid={`library-folder-dir-${f.fullPath.replace(/[^a-z0-9]+/gi, '-')}`}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-foreground transition-colors hover:bg-secondary"
                                >
                                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 truncate">{humanizeTitle(f.name)}</span>
                                    <span className="shrink-0 text-label tabular-nums text-muted-foreground">
                                        {f.fileCount}
                                    </span>
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                                </button>
                            </li>
                        ))}
                        {files.map((f) => {
                            const on = f.entry.relPath === activeRel;
                            return (
                                <li key={'file:' + f.entry.relPath}>
                                    <button
                                        type="button"
                                        onClick={() => onSelectFile(f.entry.relPath)}
                                        data-testid={`library-folder-file-${f.entry.relPath.replace(/[^a-z0-9]+/gi, '-')}`}
                                        className={
                                            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-small transition-colors ' +
                                            (on ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')
                                        }
                                    >
                                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate" title={f.entry.relPath}>
                                            {humanizeTitle(f.name)}
                                        </span>
                                        {!calm && (
                                            <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-label text-muted-foreground">
                                                {f.entry.ext || '·'}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
