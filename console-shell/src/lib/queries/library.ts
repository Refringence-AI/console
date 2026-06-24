// console-shell/src/lib/queries/library.ts
import { useQuery } from '@tanstack/react-query';
import { bridge, type LibraryEntry, type LibraryFile } from '../bridge';

export function useLibraryList(projectRoot: string | null | undefined) {
    return useQuery<LibraryEntry[]>({
        queryKey: ['library', 'list', projectRoot ?? ''],
        queryFn: () => (projectRoot ? bridge.library.list(projectRoot) : Promise.resolve([])),
        enabled: !!projectRoot,
        staleTime: 60_000,
    });
}

export function useLibraryFile(
    projectRoot: string | null | undefined,
    relPath: string | null | undefined,
) {
    return useQuery<LibraryFile>({
        queryKey: ['library', 'read', projectRoot ?? '', relPath ?? ''],
        queryFn: () =>
            projectRoot && relPath
                ? bridge.library.read(projectRoot, relPath)
                : Promise.resolve({ content: '', mime: 'text/plain', truncated: false }),
        enabled: !!projectRoot && !!relPath,
        staleTime: 30_000,
    });
}
