import { useQuery } from '@tanstack/react-query';
import { bridge, type RepoSummary } from '../bridge';
import { useActiveProject } from '../activeProject';

// Reads the PICKED project (threaded as `root`), so the Repo panel + the
// Overview LOC describe the project the user opened, not a fixed sibling repo.
export function useRepoSummary() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<RepoSummary>({
        queryKey: ['repo', 'summary', root],
        queryFn: () => bridge.repo.summary(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
    });
}
