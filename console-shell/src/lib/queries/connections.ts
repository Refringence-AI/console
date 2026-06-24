import { useQuery } from '@tanstack/react-query';
import { bridge, type ConnectionMeta, type VercelProject, type VercelDeployment, type SentryIssue } from '../bridge';

/**
 * Connection metadata (GitHub + Vercel connected flags, login/user). Drives
 * the Services cards and gates the Vercel-dependent queries below. Never
 * carries tokens — those stay in the main process.
 */
export function useConnections() {
    return useQuery<ConnectionMeta>({
        queryKey: ['connections', 'list'],
        queryFn: () => bridge.connections.list(),
        staleTime: 30_000,
    });
}

/**
 * Vercel projects. Enabled only once Vercel reports connected, so we don't
 * hit the API (and get a guaranteed 'not connected') before a token exists.
 */
export function useVercelProjects(enabled: boolean) {
    return useQuery<VercelProject[]>({
        queryKey: ['connections', 'vercel', 'projects'],
        queryFn: async () => {
            const res = await bridge.connections.vercel.projects();
            return res.ok && res.projects ? res.projects : [];
        },
        enabled,
        staleTime: 60_000,
    });
}

/**
 * Vercel deployments, latest first. Polls while connected so the Overview
 * cell tracks a BUILDING -> READY transition without a manual refresh.
 */
export function useVercelDeployments(enabled: boolean, projectId?: string) {
    return useQuery<VercelDeployment[]>({
        queryKey: ['connections', 'vercel', 'deployments', projectId ?? 'all'],
        queryFn: async () => {
            const res = await bridge.connections.vercel.deployments(projectId);
            return res.ok && res.deployments ? res.deployments : [];
        },
        enabled,
        staleTime: 20_000,
        refetchInterval: 30_000,
    });
}

/**
 * Sentry unresolved issues over the last 24h. Enabled only once Sentry
 * reports connected; polled every 60s so the Operator's production-errors
 * section stays fresh without a manual refresh.
 */
export function useSentryIssues(enabled: boolean) {
    return useQuery<SentryIssue[]>({
        queryKey: ['connections', 'sentry', 'issues'],
        queryFn: async () => {
            const res = await bridge.connections.sentry.issues();
            return res.ok && res.issues ? res.issues : [];
        },
        enabled,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });
}
