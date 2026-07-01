// console-shell/src/lib/queries/ai.ts
//
// TanStack Query hooks over the multi-provider AI bridge. Models and
// providers rarely change mid-session, so a 30s staleTime is plenty.
// Key status is the source of truth for "is any provider connected".

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bridge, type AiModelOption, type AiProviderInfo, type AiProviderId, type SpendReport } from '../bridge';

// The assistant's own token spend, sliced per model over a window (AN-5).
export function useAiSpend(windowDays = 30) {
    return useQuery<SpendReport>({
        queryKey: ['ai', 'spend', windowDays],
        queryFn: () => bridge.ai.spend(windowDays),
        staleTime: 10_000,
        refetchOnWindowFocus: false,
    });
}

// The picker shows ONLY the models usable with the stored keys (available),
// not the full catalogue, so it never offers a model that would fail on send.
export function useAiModels() {
    return useQuery<AiModelOption[]>({
        queryKey: ['ai', 'models'],
        queryFn: () => bridge.ai.availableModels(),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
}

export function useAiProviders() {
    return useQuery<AiProviderInfo[]>({
        queryKey: ['ai', 'providers'],
        queryFn: () => bridge.ai.providers(),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
}

export function useAiKeyStatus() {
    return useQuery<Record<string, boolean>>({
        queryKey: ['ai', 'keyStatus'],
        queryFn: () => bridge.ai.getKeyStatus(),
        staleTime: 15_000,
        refetchOnWindowFocus: false,
    });
}

// Models are gated behind a connected provider, so after a key changes we
// invalidate both the status and the model list in one call.
export function useInvalidateAiKeys() {
    const qc = useQueryClient();
    return () => {
        void qc.invalidateQueries({ queryKey: ['ai', 'keyStatus'] });
        void qc.invalidateQueries({ queryKey: ['ai', 'models'] });
        void qc.invalidateQueries({ queryKey: ['ai', 'providers'] });
    };
}

// Group a flat model list by provider for the picker. Order follows the
// first model seen per provider so the list stays stable across refetches.
export function groupModelsByProvider(
    models: AiModelOption[],
): { provider: AiProviderId; models: AiModelOption[] }[] {
    const order: AiProviderId[] = [];
    const byProvider = new Map<AiProviderId, AiModelOption[]>();
    for (const m of models) {
        if (!byProvider.has(m.provider)) {
            byProvider.set(m.provider, []);
            order.push(m.provider);
        }
        byProvider.get(m.provider)!.push(m);
    }
    return order.map((provider) => ({ provider, models: byProvider.get(provider)! }));
}
