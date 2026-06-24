// console-shell/src/lib/queries/release.ts
//
// TanStack Query hooks over bridge.release.* IPC.
import { useQuery } from '@tanstack/react-query';
import { bridge, type ReleaseChecklist, type ReleaseSummary } from '../bridge';
import { useActiveProject } from '../activeProject';

// Release readiness is computed from the PICKED project's real signals. The
// single synthetic "current" release keeps the list -> version -> get/summary
// flow, but every call threads the project root.
export function useReleaseList() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery({
        queryKey: ['release', 'list', root],
        queryFn: () => bridge.release.list(root),
        enabled: root.length > 0,
        staleTime: 30_000,
    });
}

export function useReleaseChecklist(version: string | null) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<ReleaseChecklist | null>({
        queryKey: ['release', 'get', root, version],
        queryFn: () => (version && root ? bridge.release.get(root) : Promise.resolve(null)),
        enabled: !!version && root.length > 0,
        staleTime: 30_000,
    });
}

export function useReleaseSummary(version: string | null) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<ReleaseSummary | null>({
        queryKey: ['release', 'summary', root, version],
        queryFn: () => (version && root ? bridge.release.summary(root) : Promise.resolve(null)),
        enabled: !!version && root.length > 0,
        staleTime: 30_000,
    });
}
