import { useQuery } from '@tanstack/react-query';
import { bridge, type EnvLocalNames } from '../bridge';

export function useEnvLocalNames(projectRoot: string) {
    return useQuery<EnvLocalNames>({
        queryKey: ['env', 'localNames', projectRoot],
        queryFn: () => bridge.env.localNames(projectRoot),
        staleTime: 30_000,
        enabled: projectRoot.length > 0,
    });
}
