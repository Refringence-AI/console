// console-shell/src/lib/queries/ollama.ts
//
// TanStack Query hook over bridge.ollama.detect(). 30s staleTime is
// plenty - Ollama presence rarely changes mid-session, and the user
// can manually refetch if they just started the daemon.

import { useQuery } from '@tanstack/react-query';
import { bridge, type OllamaStatus, type OllamaRecommendation } from '../bridge';

export function useOllamaDetect() {
    return useQuery<OllamaStatus>({
        queryKey: ['ollama', 'detect'],
        queryFn: () => bridge.ollama.detect(),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false,
    });
}

/** Hardware-aware model guidance: detect the machine + recommend a model that runs well here. */
export function useOllamaRecommend(enabled = true) {
    return useQuery<OllamaRecommendation>({
        queryKey: ['ollama', 'recommend'],
        queryFn: () => bridge.ollama.recommend(),
        enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
