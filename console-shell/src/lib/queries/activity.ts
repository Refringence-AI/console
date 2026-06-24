import { useQuery } from '@tanstack/react-query';
import { bridge, type ActivityCommit } from '../bridge';
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
