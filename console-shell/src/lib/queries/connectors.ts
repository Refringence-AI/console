import { useQuery } from '@tanstack/react-query';
import { bridge, type ConnectorCatalogEntry, type ConnectorStatus, type ConnectorUsageReport } from '../bridge';

/**
 * The connector platform's data hooks. The catalog is effectively static, the
 * status list is cheap booleans + account labels, and usage is fetched per
 * connector (and polled slowly). No hook ever sees a token - the main process
 * reads it back in-process and returns only the rendered figures.
 */
export function useConnectorCatalog() {
    return useQuery<ConnectorCatalogEntry[]>({
        queryKey: ['connectors', 'catalog'],
        queryFn: () => bridge.connectors.catalog(),
        staleTime: Infinity,
    });
}

export function useConnectorStatus() {
    return useQuery<ConnectorStatus[]>({
        queryKey: ['connectors', 'status'],
        queryFn: () => bridge.connectors.status(),
        staleTime: 20_000,
    });
}

/**
 * Usage for one connector. Enabled only once it reports connected, so we never
 * hit a provider API with no token. Polled every ~5 min (providers cache usage
 * server-side, so faster is wasteful).
 */
export function useConnectorUsage(id: string, enabled: boolean) {
    return useQuery<ConnectorUsageReport>({
        queryKey: ['connectors', 'usage', id],
        queryFn: () => bridge.connectors.usage(id),
        enabled,
        staleTime: 5 * 60_000,
        refetchInterval: 5 * 60_000,
        retry: false,
    });
}
