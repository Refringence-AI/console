import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bridge, type IssueRow, type IssueDetail, type IssueFetchHealth, type IssueListOptions } from '../bridge';
import { useActiveProject } from '../activeProject';

export function useIssuesHealth() {
    return useQuery<IssueFetchHealth>({
        queryKey: ['issues', 'health'],
        queryFn: () => bridge.issues.health(),
        staleTime: 5 * 60_000,
    });
}

export function useIssuesList(opts?: IssueListOptions) {
    // Inject the picked project so the handler derives the repo from its git
    // remote, unless an explicit repo override is passed.
    const { project } = useActiveProject();
    const projectRoot = project?.path;
    const merged: IssueListOptions = { ...opts, projectRoot };
    return useQuery<IssueRow[]>({
        queryKey: ['issues', 'list', projectRoot ?? 'none', opts?.repo ?? 'derived', opts?.state ?? 'open', opts?.label ?? null],
        queryFn: () => bridge.issues.list(merged),
        enabled: Boolean(projectRoot) || Boolean(opts?.repo),
        staleTime: 60_000,
    });
}

export function useIssueDetail(num: number | null) {
    const { project } = useActiveProject();
    const projectRoot = project?.path;
    return useQuery<IssueDetail | null>({
        queryKey: ['issues', 'detail', projectRoot ?? 'none', num ?? 'none'],
        queryFn: () => (num == null ? Promise.resolve(null) : bridge.issues.detail(num, projectRoot)),
        enabled: num !== null && num > 0,
        staleTime: 60_000,
    });
}

export function useIssueRelabel() {
    const qc = useQueryClient();
    const { project } = useActiveProject();
    const projectRoot = project?.path;
    return useMutation({
        mutationFn: (opts: { number: number; addLabels?: string[]; removeLabels?: string[] }) =>
            bridge.issues.relabel({ ...opts, projectRoot }),
        onSuccess: () => {
            // Invalidate the list so the underlying labels are re-fetched.
            void qc.invalidateQueries({ queryKey: ['issues', 'list'] });
        },
    });
}
