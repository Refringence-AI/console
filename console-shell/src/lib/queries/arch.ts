import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bridge, type DependencyGraph, type ArchOverlay } from '../bridge';

/**
 * Live package-level dependency graph for the active project. The main
 * process caches the walk keyed on a dir-mtime + entry-count signature, so a
 * generous staleTime here just avoids redundant IPC round-trips on tab
 * switches; the real recompute gate lives main-side. includeExternal and
 * allLanguages are part of the query key because each changes the node/edge
 * set the main process returns (and caches separately).
 */
export function useArchitectureGraph(root: string, includeExternal: boolean, allLanguages: boolean) {
    return useQuery<DependencyGraph>({
        queryKey: ['arch', 'graph', root, includeExternal, allLanguages],
        queryFn: () => bridge.arch.graph(root, { includeExternal, allLanguages }),
        enabled: !!root,
        staleTime: 5 * 60_000,
    });
}

/**
 * Force a main-side rebuild that bypasses the cache, then seed the graph
 * query with the fresh result so the canvas updates without a second fetch.
 */
export function useRecomputeArchitecture(root: string, includeExternal: boolean, allLanguages: boolean) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => bridge.arch.recompute(root, { includeExternal, allLanguages }),
        onSuccess: (graph) => {
            qc.setQueryData(['arch', 'graph', root, includeExternal, allLanguages], graph);
        },
    });
}

/**
 * The user's curated overlay (positions / tier overrides / notes / hidden).
 * Returns null when no overlay has been saved yet; callers treat null as
 * "use the auto-laid-out graph as-is".
 */
export function useArchOverlay(root: string) {
    return useQuery<ArchOverlay | null>({
        queryKey: ['arch', 'overlay', root],
        queryFn: () => bridge.arch.overlayRead(root),
        enabled: !!root,
        staleTime: 5 * 60_000,
    });
}

/**
 * Persist the overlay. On success we patch the cache directly (rather than
 * invalidate) so a drag-to-save doesn't bounce the canvas through a refetch.
 */
export function useSaveArchOverlay(root: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (overlay: ArchOverlay) => bridge.arch.overlayWrite(root, overlay),
        onMutate: (overlay) => {
            qc.setQueryData(['arch', 'overlay', root], overlay);
        },
    });
}
