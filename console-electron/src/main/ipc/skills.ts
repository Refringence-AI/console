// console-electron/src/main/ipc/skills.ts
//
// Agent-skills library IPC: list the catalogue, see what's installed in the open
// project, and install a skill into <project>/.claude/skills (or .codex/skills).
import { ipcMain } from 'electron';
import { listSkills, installedSkills, installSkill, type SkillMeta, type SkillTool } from '../skills';

export function registerSkillsHandlers(): void {
    ipcMain.handle('console:skills.list', (): SkillMeta[] => {
        try { return listSkills(); } catch { return []; }
    });

    ipcMain.handle('console:skills.installed', (_evt, projectRoot: string, tool: SkillTool): string[] => {
        try { return installedSkills(projectRoot, tool === 'codex' ? 'codex' : 'claude'); } catch { return []; }
    });

    ipcMain.handle('console:skills.install', (_evt, projectRoot: string, id: string, tool: SkillTool): { ok: boolean; path?: string; error?: string } => {
        try { return installSkill(projectRoot, id, tool === 'codex' ? 'codex' : 'claude'); }
        catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    });
}
