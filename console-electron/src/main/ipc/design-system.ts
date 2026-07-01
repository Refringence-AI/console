// console-electron/src/main/ipc/design-system.ts
//
// IPC for the design-system panel: scan a project's design system, and save /
// list / delete / compare cross-project design profiles. Pure read of the
// project; profiles persist to Console userData. Never throws across IPC.
import { ipcMain } from 'electron';
import { scanDesignSystem, detectDesignSystem, type DesignSystem, type DesignSystemReport } from '../design-system';
import {
    toProfile, saveProfile, listProfiles, deleteProfile, compareProfiles,
    type DesignProfile, type ProfileDiff,
} from '../design-profile-store';

function emptyScan(error?: string): DesignSystem {
    return { tokens: { colors: [], fonts: [], spacing: [], radii: [], typeScale: [] }, themes: [], libraries: [], libraryDetails: [], sources: [], scannedAt: new Date().toISOString(), error };
}

export function registerDesignSystemHandlers(): void {
    // Flattened summary - used by console:design.detect(root).
    ipcMain.handle('console:design.detect', (_e, root: string): DesignSystemReport => {
        try { return detectDesignSystem(root); }
        catch (err) { return { ok: false, tailwind: null, shadcn: null, cssVars: [], libraries: [], fonts: [], error: err instanceof Error ? err.message : String(err) }; }
    });

    ipcMain.handle('console:designSystem.scan', (_e, projectRoot: string): DesignSystem => {
        try { return scanDesignSystem(projectRoot); }
        catch (err) { return emptyScan(err instanceof Error ? err.message : String(err)); }
    });

    ipcMain.handle('console:designSystem.saveProfile', (_e, projectRoot: string, projectName: string, label?: string): { ok: boolean; profile?: DesignProfile; error?: string } => {
        try {
            const ds = scanDesignSystem(projectRoot);
            const profile = saveProfile(toProfile(ds, projectName, label));
            return profile ? { ok: true, profile } : { ok: false, error: 'Could not save the profile.' };
        } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });

    ipcMain.handle('console:designSystem.listProfiles', (): DesignProfile[] => {
        try { return listProfiles(); } catch { return []; }
    });

    ipcMain.handle('console:designSystem.deleteProfile', (_e, id: string): { ok: boolean } => {
        try { return { ok: deleteProfile(id) }; } catch { return { ok: false }; }
    });

    ipcMain.handle('console:designSystem.compareProfiles', (_e, aId: string, bId: string): ProfileDiff | null => {
        try { return compareProfiles(aId, bId); } catch { return null; }
    });
}
