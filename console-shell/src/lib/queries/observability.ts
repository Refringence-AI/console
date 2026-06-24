import { useQuery } from '@tanstack/react-query';
import { bridge, type RunEntry, type ObsCounters, type RunDetail } from '../bridge';
import { useActiveProject } from '../activeProject';

// Observability surfaces runs Console recorded for the PICKED project (under
// <project>/.refringence-console/runs). Honest zero until the recorder lands.
export function useObsCounters() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<ObsCounters>({
        queryKey: ['obs', 'counters', root],
        queryFn: () => bridge.obs.counters(root),
        enabled: root.length > 0,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });
}

export function useObsRuns() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<RunEntry[]>({
        queryKey: ['obs', 'runs', root],
        queryFn: () => bridge.obs.runs(root),
        enabled: root.length > 0,
        staleTime: 30_000,
    });
}

export function useObsRunDetail(runId: string | null) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<RunDetail>({
        queryKey: ['obs', 'runDetail', root, runId],
        queryFn: () => bridge.obs.runDetail(root, runId as string),
        enabled: !!runId && root.length > 0,
        staleTime: 30_000,
    });
}
