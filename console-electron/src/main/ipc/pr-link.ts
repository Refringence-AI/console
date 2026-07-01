// console-electron/src/main/ipc/pr-link.ts
//
// IPC handler for PR-link lookups. Exposes a single channel:
//   console:pr.link(root: string, branch?: string) -> PrLink
//
// The underlying findPrLink() is total: it never throws across the IPC
// boundary and returns {ok:true, found:false} when gh is absent, not
// authed, or no PR exists.
import { ipcMain } from 'electron';
import { findPrLink, type PrLink } from '../pr-link';

export function registerPrLinkHandlers(): void {
    ipcMain.handle(
        'console:pr.link',
        async (_e, root: string, branch?: string): Promise<PrLink> => {
            try {
                return await findPrLink(root, branch);
            } catch (err) {
                // Defensive catch: findPrLink should never throw, but isolate
                // any unexpected failure so it cannot propagate across IPC.
                return {
                    ok: false,
                    found: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    );
}
