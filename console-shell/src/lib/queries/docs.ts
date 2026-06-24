// console-shell/src/lib/queries/docs.ts
import { useQuery } from '@tanstack/react-query';
import { bridge, type DocEntry } from '../bridge';
import { useActiveProject } from '../activeProject';

// The Docs panel reads the PICKED project's own .md files (root + docs/).
export function useDocsList() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<DocEntry[]>({
        queryKey: ['docs', 'list', root],
        queryFn: () => bridge.docs.list(root),
        enabled: root.length > 0,
        staleTime: 60_000,
    });
}

export function useDocBody(relPath: string | null) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<string | null>({
        queryKey: ['docs', 'read', root, relPath],
        queryFn: () => (relPath && root ? bridge.docs.read(root, relPath) : Promise.resolve(null)),
        enabled: !!relPath && root.length > 0,
        staleTime: 60_000,
    });
}
