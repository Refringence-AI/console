import { useQuery } from '@tanstack/react-query';
import { bridge, type MetricsSummary } from '../bridge';
import { useActiveProject } from '../activeProject';

export function useMetricsSummary() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<MetricsSummary>({
        queryKey: ['metrics', 'summary', root],
        queryFn: () => bridge.metrics.summary(root),
        enabled: root.length > 0,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });
}
