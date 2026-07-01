// console-electron/src/main/ipc/prompts.ts
//
// Prompt-library IPC. Thin wrapper over ../prompts.ts: every method takes
// the renderer's active project root, returns { ok, entry?/entries?, error? },
// and never throws across the bridge.
import { ipcMain } from 'electron';
import {
    listPrompts,
    getPrompt,
    createPrompt,
    updatePrompt,
    deletePrompt,
    toggleFavorite,
    type PromptEntry,
    type PromptInput,
} from '../prompts';

interface ListResult { ok: boolean; entries?: PromptEntry[]; error?: string }
interface EntryResult { ok: boolean; entry?: PromptEntry; error?: string }
interface OkResult { ok: boolean; error?: string }

export function registerPromptsHandlers(): void {
    ipcMain.handle('console:prompts.list', (_e, projectRoot: string): ListResult => {
        try {
            return { ok: true, entries: listPrompts(projectRoot) };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle('console:prompts.get', (_e, projectRoot: string, id: string): EntryResult => {
        try {
            const entry = getPrompt(projectRoot, id);
            return entry ? { ok: true, entry } : { ok: false, error: 'Prompt not found' };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle('console:prompts.create', (_e, projectRoot: string, input: PromptInput): EntryResult => {
        try {
            const entry = createPrompt(projectRoot, input);
            return entry ? { ok: true, entry } : { ok: false, error: 'Could not create the prompt' };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle(
        'console:prompts.update',
        (_e, projectRoot: string, id: string, input: Partial<PromptInput>): EntryResult => {
            try {
                const entry = updatePrompt(projectRoot, id, input);
                return entry ? { ok: true, entry } : { ok: false, error: 'Prompt not found' };
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    );

    ipcMain.handle('console:prompts.delete', (_e, projectRoot: string, id: string): OkResult => {
        try {
            return deletePrompt(projectRoot, id)
                ? { ok: true }
                : { ok: false, error: 'Prompt not found' };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle('console:prompts.toggleFavorite', (_e, projectRoot: string, id: string): EntryResult => {
        try {
            const entry = toggleFavorite(projectRoot, id);
            return entry ? { ok: true, entry } : { ok: false, error: 'Prompt not found' };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
}
