import { useMutation, useQuery } from '@tanstack/react-query';
import { bridge, type StackDetect, type ProjectShape, type ProjectCapabilities } from '../bridge';

export function useFolderPicker() {
    return useMutation({
        mutationKey: ['project', 'pickFolder'],
        mutationFn: () => bridge.project.pickFolder(),
    });
}

export function useStackDetect(root: string) {
    return useQuery<StackDetect>({
        queryKey: ['project', 'detectStack', root],
        queryFn: () => bridge.project.detectStack(root),
        enabled: !!root,
        staleTime: 60_000,
    });
}

export function useProjectShape(root: string) {
    return useQuery<ProjectShape>({
        queryKey: ['project', 'shape', root],
        queryFn: () => bridge.repoIntrospect.shape(root),
        enabled: !!root,
        staleTime: 60_000,
    });
}

export function useProjectCapabilities(root: string) {
    return useQuery<ProjectCapabilities>({
        queryKey: ['project', 'capabilities', root],
        queryFn: () => bridge.repoIntrospect.capabilities(root),
        enabled: !!root,
        staleTime: 60_000,
    });
}
