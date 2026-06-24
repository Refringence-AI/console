import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bridge, type ProjectProfile, type ProjectIntel } from '../bridge';

// The deterministic profile. The first call for an uncached project builds it
// (a few seconds on a large repo); subsequent calls are signature-cached and
// instant. We keep it fresh for a while since the tree rarely changes mid-view.
export function useProjectProfile(root: string) {
    return useQuery<ProjectProfile | null>({
        queryKey: ['intel', 'profile', root],
        queryFn: () => bridge.intel.profile(root),
        enabled: root.length > 0,
        staleTime: 10 * 60_000,
        retry: false,
    });
}

// Force a rebuild (bypass the cache), e.g. from a "Re-study" button.
export function useReprofile(root: string) {
    const qc = useQueryClient();
    return useMutation<ProjectProfile | null>({
        mutationFn: () => bridge.intel.profile(root, { force: true }),
        onSuccess: (profile) => {
            qc.setQueryData(['intel', 'profile', root], profile);
        },
    });
}

// AI enrichment: asks a connected model for the narrative + suggestions +
// validated systems diagram, then merges the result into the cached profile so
// the report + Systems view pick it up without a re-study. Returns the enrich
// result so the caller can surface a "no provider connected" message.
export function useEnrich(root: string) {
    const qc = useQueryClient();
    return useMutation<{ ok: boolean; intel?: ProjectIntel; error?: string }, Error, { model?: string } | void>({
        mutationFn: (vars) => bridge.intel.enrich(root, vars ?? undefined),
        onSuccess: (res) => {
            if (res.ok && res.intel) {
                qc.setQueryData<ProjectProfile | null>(['intel', 'profile', root], (prev) =>
                    prev ? { ...prev, ai: res.intel! } : prev,
                );
            }
        },
    });
}
