import { useEffect, useState } from 'react';
import { bridge, type UpdateEvent } from './bridge';

/**
 * Subscribes to main-process auto-update events. The main process downloads a
 * new version in the background; this hook exposes the live status so the UI
 * can show a "Restart to update" affordance once `status === 'downloaded'`.
 *
 * No-op in browser dev (the bridge is stubbed); status stays 'idle'.
 */
export function useUpdate() {
    const [event, setEvent] = useState<UpdateEvent>({ status: 'idle' });

    useEffect(() => bridge.update.onEvent(setEvent), []);

    return {
        ...event,
        check: () => bridge.update.check(),
        install: () => bridge.update.install(),
    };
}
