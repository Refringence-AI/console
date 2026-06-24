// console-electron/src/main/ipc/project.ts
//
// Project picker + stack detection IPC. Backs Connect wizard, Settings
// Project section, Pipeline panel, and OverviewPanel NewcomerBanner.
//
// Channels:
//   console:project.pickFolder()      -> { canceled, path? }
//   console:project.detectStack(root) -> { stacks[], primary, details }
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type Stack = 'node' | 'python' | 'rust' | 'go' | 'mixed' | 'unknown';

export interface StackDetectDetails {
    hasPackageJson: boolean;
    hasPyproject: boolean;
    hasCargo: boolean;
    hasGoMod: boolean;
    hasDockerfile: boolean;
    hasWorkflows: boolean;
}

export interface StackDetect {
    stacks: Stack[];
    primary: string;
    details: StackDetectDetails;
}

export interface PickFolderResult {
    canceled: boolean;
    path?: string;
}

function safeExists(p: string): boolean {
    try {
        return fs.existsSync(p);
    } catch {
        return false;
    }
}

function primaryLabel(stacks: Stack[]): string {
    if (stacks.length === 0) return 'unknown';
    if (stacks.length > 1) return 'mixed';
    const map: Record<Stack, string> = {
        node: 'Node / JavaScript',
        python: 'Python',
        rust: 'Rust',
        go: 'Go',
        mixed: 'Mixed',
        unknown: 'Unknown',
    };
    return map[stacks[0]];
}

export function registerProjectHandlers(): void {
    ipcMain.handle('console:project.pickFolder', async (): Promise<PickFolderResult> => {
        const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        try {
            const result = focused
                ? await dialog.showOpenDialog(focused, { properties: ['openDirectory'] })
                : await dialog.showOpenDialog({ properties: ['openDirectory'] });
            if (result.canceled || result.filePaths.length === 0) {
                return { canceled: true };
            }
            return { canceled: false, path: result.filePaths[0] };
        } catch {
            return { canceled: true };
        }
    });

    ipcMain.handle('console:project.detectStack', (_evt, root: string): StackDetect => {
        const details: StackDetectDetails = {
            hasPackageJson: false,
            hasPyproject: false,
            hasCargo: false,
            hasGoMod: false,
            hasDockerfile: false,
            hasWorkflows: false,
        };
        const stacks: Stack[] = [];

        if (!root || !safeExists(root)) {
            return { stacks, primary: 'unknown', details };
        }

        details.hasPackageJson = safeExists(path.join(root, 'package.json'));
        details.hasPyproject =
            safeExists(path.join(root, 'pyproject.toml')) ||
            safeExists(path.join(root, 'setup.py')) ||
            safeExists(path.join(root, 'requirements.txt'));
        details.hasCargo = safeExists(path.join(root, 'Cargo.toml'));
        details.hasGoMod = safeExists(path.join(root, 'go.mod'));
        details.hasDockerfile = safeExists(path.join(root, 'Dockerfile'));
        details.hasWorkflows = safeExists(path.join(root, '.github', 'workflows'));

        if (details.hasPackageJson) stacks.push('node');
        if (details.hasPyproject) stacks.push('python');
        if (details.hasCargo) stacks.push('rust');
        if (details.hasGoMod) stacks.push('go');

        return { stacks, primary: primaryLabel(stacks), details };
    });
}
