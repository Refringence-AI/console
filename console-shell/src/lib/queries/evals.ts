// console-shell/src/lib/queries/evals.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bridge, type PromptfooSummary, type EvalRunResult } from '../bridge';
import { useActiveProject } from '../activeProject';

export function useEvalsHealth() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery({
        queryKey: ['evals', 'health', root],
        queryFn: () => bridge.evals.health(root),
        enabled: root.length > 0,
        staleTime: 30_000,
    });
}

export function usePromptfooSummary() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    return useQuery<PromptfooSummary | null>({
        queryKey: ['evals', 'promptfoo', 'summary', root],
        queryFn: () => bridge.evals.promptfooSummary(root),
        enabled: root.length > 0,
        staleTime: 30_000,
    });
}

// LangSmith connection state (booleans only; the key lives in safeStorage).
export function useLangsmithStatus() {
    return useQuery({
        queryKey: ['evals', 'langsmith', 'status'],
        queryFn: () => bridge.evals.langsmithStatus(),
        staleTime: 15_000,
    });
}

// Runs the LangSmith eval (real OpenAI calls, traced + scored to LangSmith).
export function useRunEval() {
    const qc = useQueryClient();
    return useMutation<EvalRunResult>({
        mutationFn: () => bridge.evals.run(),
        onSuccess: () => { void qc.invalidateQueries({ queryKey: ['evals'] }); },
    });
}

export function useInvalidateLangsmith() {
    const qc = useQueryClient();
    return () => { void qc.invalidateQueries({ queryKey: ['evals', 'langsmith'] }); };
}
