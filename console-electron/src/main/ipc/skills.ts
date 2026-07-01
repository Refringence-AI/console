// console-electron/src/main/ipc/skills.ts
//
// Agent-skills library IPC: list the catalogue, see what's installed in the open
// project, and install a skill into <project>/.claude/skills (or .codex/skills).
import { ipcMain } from 'electron';
import {
    listSkills, listCustomSkills, createSkill, updateSkill, deleteSkill,
    installedSkills, installSkill, type SkillMeta, type SkillDef, type SkillInput, type SkillTool,
} from '../skills';

type SkillResult = { ok: boolean; skill?: SkillMeta; error?: string };

export function registerSkillsHandlers(): void {
    ipcMain.handle('console:skills.list', (): SkillMeta[] => {
        try { return listSkills(); } catch { return []; }
    });

    ipcMain.handle('console:skills.listCustom', (_evt, projectRoot: string): SkillDef[] => {
        try { return listCustomSkills(projectRoot); } catch { return []; }
    });

    ipcMain.handle('console:skills.create', (_evt, projectRoot: string, input: SkillInput): SkillResult => {
        try {
            const skill = createSkill(projectRoot, input);
            return skill ? { ok: true, skill } : { ok: false, error: 'Could not create the skill.' };
        } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });

    ipcMain.handle('console:skills.update', (_evt, projectRoot: string, id: string, input: SkillInput): SkillResult => {
        try {
            const skill = updateSkill(projectRoot, id, input);
            return skill ? { ok: true, skill } : { ok: false, error: 'Could not update the skill.' };
        } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });

    ipcMain.handle('console:skills.delete', (_evt, projectRoot: string, id: string): { ok: boolean; error?: string } => {
        try { return deleteSkill(projectRoot, id) ? { ok: true } : { ok: false, error: 'Skill not found.' }; }
        catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });

    ipcMain.handle('console:skills.installed', (_evt, projectRoot: string, tool: SkillTool): string[] => {
        try { return installedSkills(projectRoot, tool === 'codex' ? 'codex' : 'claude'); } catch { return []; }
    });

    ipcMain.handle('console:skills.install', (_evt, projectRoot: string, id: string, tool: SkillTool): { ok: boolean; path?: string; error?: string } => {
        try { return installSkill(projectRoot, id, tool === 'codex' ? 'codex' : 'claude'); }
        catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });
}
