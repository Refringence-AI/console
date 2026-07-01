import { useQuery } from '@tanstack/react-query';
import { bridge, type PipelineDetect, type PipelineRuns, type PrLink } from '../bridge';

// AN-7: the PR (if any) for the repo's current branch, so a release/branch shows
// its associated pull request + state. gh-backed; honest not-found without gh.
export function usePrLink(projectRoot: string) {
    return useQuery<PrLink>({
        queryKey: ['pipeline', 'pr-link', projectRoot],
        queryFn: () => bridge.pr.link(projectRoot),
        staleTime: 30_000,
        enabled: projectRoot.length > 0,
    });
}

export function usePipelineDetect(projectRoot: string) {
    return useQuery<PipelineDetect>({
        queryKey: ['pipeline', 'detect', projectRoot],
        queryFn: () => bridge.pipeline.detect(projectRoot),
        staleTime: 60_000,
    });
}

export function usePipelineRuns(projectRoot: string) {
    return useQuery<PipelineRuns>({
        queryKey: ['pipeline', 'runs', projectRoot],
        queryFn: () => bridge.pipeline.runs(projectRoot),
        staleTime: 30_000,
        refetchInterval: 60_000,
        enabled: projectRoot.length > 0,
    });
}
