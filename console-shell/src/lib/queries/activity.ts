import { useQuery } from '@tanstack/react-query';
import { bridge, type ActivityCommit, type DeliveryCadence } from '../bridge';
import { useActiveProject } from '../activeProject';

/**
 * Recent git commits from the PICKED project. Real history, not a synthetic
 * feed. Returns [] when the project isn't a git checkout or git isn't on PATH,
 * so callers render an honest empty state.
 */
export function useRecentCommits(limit = 12) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<ActivityCommit[]>({
        queryKey: ['activity', 'recentCommits', root, limit],
        queryFn: () => bridge.activity.recentCommits(root, limit),
        enabled: root.length > 0,
        staleTime: 30_000,
    });
}

/**
 * Delivery cadence from git: how active the repo is + how often it releases.
 * Deterministic; a non-git folder returns zeros.
 */
export function useDeliveryCadence() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<DeliveryCadence>({
        queryKey: ['activity', 'cadence', root],
        queryFn: () => bridge.activity.cadence(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
}
