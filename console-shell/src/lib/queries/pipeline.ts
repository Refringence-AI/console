import { useQuery } from '@tanstack/react-query';
import { bridge, type PipelineDetect, type PipelineRuns } from '../bridge';

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
