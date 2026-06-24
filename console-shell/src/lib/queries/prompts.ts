// console-shell/src/lib/queries/prompts.ts
//
// TanStack Query CRUD over the prompt-library bridge. Every mutation
// invalidates the one list query so the panel re-renders from disk truth.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bridge, type PromptEntry, type PromptInput } from '../bridge';

function listKey(projectRoot: string | null | undefined) {
    return ['prompts', 'list', projectRoot ?? ''] as const;
}

export function usePrompts(projectRoot: string | null | undefined) {
    return useQuery<PromptEntry[]>({
        queryKey: listKey(projectRoot),
        queryFn: async () => {
            if (!projectRoot) return [];
            const res = await bridge.prompts.list(projectRoot);
            return res.ok ? (res.entries ?? []) : [];
        },
        enabled: !!projectRoot,
        staleTime: 30_000,
    });
}

export function useCreatePrompt(projectRoot: string | null | undefined) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: PromptInput) => {
            if (!projectRoot) throw new Error('No active project');
            const res = await bridge.prompts.create(projectRoot, input);
            if (!res.ok || !res.entry) throw new Error(res.error ?? 'Could not create the prompt');
            return res.entry;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: listKey(projectRoot) }),
    });
}

export function useUpdatePrompt(projectRoot: string | null | undefined) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (args: { id: string; input: Partial<PromptInput> }) => {
            if (!projectRoot) throw new Error('No active project');
            const res = await bridge.prompts.update(projectRoot, args.id, args.input);
            if (!res.ok || !res.entry) throw new Error(res.error ?? 'Could not update the prompt');
            return res.entry;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: listKey(projectRoot) }),
    });
}

export function useDeletePrompt(projectRoot: string | null | undefined) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            if (!projectRoot) throw new Error('No active project');
            const res = await bridge.prompts.delete(projectRoot, id);
            if (!res.ok) throw new Error(res.error ?? 'Could not delete the prompt');
            return id;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: listKey(projectRoot) }),
    });
}

export function useToggleFavorite(projectRoot: string | null | undefined) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            if (!projectRoot) throw new Error('No active project');
            const res = await bridge.prompts.toggleFavorite(projectRoot, id);
            if (!res.ok) throw new Error(res.error ?? 'Could not update the prompt');
            return res.entry;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: listKey(projectRoot) }),
    });
}
