// console-electron/src/main/ai/config-gen.ts
//
// The shared backend for generate_config: detect the project's stack from disk,
// pick the destination path for a config kind, and produce the file content via
// the pure config-templates. Used by the AI generate_config tool today and by a
// panel action later (build the backend once, expose it twice).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateConfig, type ConfigKind, type StackDescriptor } from '../config-templates';

export function deriveStack(root: string): StackDescriptor {
    const stack: StackDescriptor = {};
    let pm = 'npm';
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) pm = 'pnpm';
    else if (fs.existsSync(path.join(root, 'yarn.lock'))) pm = 'yarn';
    else if (fs.existsSync(path.join(root, 'bun.lockb'))) pm = 'bun';
    stack.packageManager = pm;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            scripts?: Record<string, string>;
        };
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        stack.framework = 'next' in deps ? 'next'
            : 'vite' in deps ? 'vite'
                : '@remix-run/react' in deps || '@remix-run/node' in deps ? 'remix'
                    : 'express' in deps || 'fastify' in deps ? 'express'
                        : 'none';
        if (pkg.scripts?.build) stack.buildCmd = `${pm} run build`;
        if (pkg.scripts?.start) stack.startCmd = `${pm} run start`;
        stack.outputDir = stack.framework === 'next' ? '.next' : stack.framework === 'vite' ? 'dist' : undefined;
    } catch { /* no package.json; templates fall back to sensible defaults */ }
    stack.hasMonorepo = fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))
        || fs.existsSync(path.join(root, 'turbo.json'))
        || fs.existsSync(path.join(root, 'lerna.json'));
    return stack;
}

export function configDestPath(kind: ConfigKind): string {
    return kind === 'github-actions-ci.yml' ? '.github/workflows/ci.yml' : kind;
}

export function buildConfig(root: string, kind: ConfigKind): { content: string; destPath: string; stack: StackDescriptor } {
    const stack = deriveStack(root);
    return { content: generateConfig(kind, stack), destPath: configDestPath(kind), stack };
}
