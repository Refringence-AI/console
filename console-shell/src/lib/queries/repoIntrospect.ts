import { useQuery } from '@tanstack/react-query';
import { bridge, type ProjectSummary, type HotFile, type ReadingEntry } from '../bridge';

export function useProjectSummary(root: string) {
    return useQuery<ProjectSummary>({
        queryKey: ['repoIntrospect', 'summary', root],
        queryFn: () => bridge.repoIntrospect.summary(root),
        staleTime: 5 * 60_000,
    });
}

export function useHotFiles(root: string, days?: number) {
    return useQuery<HotFile[]>({
        queryKey: ['repoIntrospect', 'hotFiles', root, days ?? 30],
        queryFn: () => bridge.repoIntrospect.hotFiles(root, days),
        staleTime: 5 * 60_000,
    });
}

export function useReadingOrder(root: string) {
    return useQuery<ReadingEntry[]>({
        queryKey: ['repoIntrospect', 'readingOrder', root],
        queryFn: () => bridge.repoIntrospect.readingOrder(root),
        staleTime: 5 * 60_000,
    });
}
