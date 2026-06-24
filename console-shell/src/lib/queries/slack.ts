import { useQuery } from '@tanstack/react-query';
import { bridge, type SlackChannel, type SlackIssue } from '../bridge';

/**
 * Slack channels the bot can see, with each channel's assigned team (if any).
 * Enabled only once Slack reports connected so we don't hit the API before a
 * token exists.
 */
export function useSlackChannels(enabled: boolean) {
    return useQuery<SlackChannel[]>({
        queryKey: ['slack', 'channels'],
        queryFn: async () => {
            const res = await bridge.slack.channels();
            return res.ok && res.channels ? res.channels : [];
        },
        enabled,
        staleTime: 60_000,
    });
}

/**
 * Issue-shaped messages pulled from the team-mapped Slack channels. Polled
 * every two minutes while the Slack source is open so the board tracks new
 * reports without a manual refresh.
 */
export function useSlackIssues(enabled: boolean) {
    return useQuery<SlackIssue[]>({
        queryKey: ['slack', 'issues'],
        queryFn: async () => {
            const res = await bridge.slack.issues();
            return res.ok && res.issues ? res.issues : [];
        },
        enabled,
        staleTime: 60_000,
        refetchInterval: 120_000,
    });
}
