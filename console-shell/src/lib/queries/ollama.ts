// console-shell/src/lib/queries/ollama.ts
//
// TanStack Query hook over bridge.ollama.detect(). 30s staleTime is
// plenty - Ollama presence rarely changes mid-session, and the user
// can manually refetch if they just started the daemon.

import { useQuery } from '@tanstack/react-query';
import { bridge, type OllamaStatus } from '../bridge';

export function useOllamaDetect() {
    return useQuery<OllamaStatus>({
        queryKey: ['ollama', 'detect'],
        queryFn: () => bridge.ollama.detect(),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
