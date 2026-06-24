// console-electron/src/preload/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
    getVersion: () => ipcRenderer.invoke('console:getVersion'),
    openExternal: (url: string) => ipcRenderer.invoke('console:openExternal', url),
    openPath: (p: string) => ipcRenderer.invoke('console:openPath', p),
    notify: (title: string, body: string) => ipcRenderer.invoke('console:notify', title, body),
    window: {
        minimize: () => ipcRenderer.invoke('console:window.minimize'),
        toggleMaximize: () => ipcRenderer.invoke('console:window.toggleMaximize'),
        close: () => ipcRenderer.invoke('console:window.close'),
        isMaximized: () => ipcRenderer.invoke('console:window.isMaximized'),
        newWindow: () => ipcRenderer.invoke('console:window.new'),
        setTitle: (title: string) => ipcRenderer.invoke('console:window.setTitle', title),
        growForDock: (extraWidth: number) => ipcRenderer.invoke('console:window.growForDock', extraWidth),
        onMaximizeChange: (cb: (isMax: boolean) => void) => {
            const listener = (_e: unknown, isMax: boolean) => cb(isMax);
            ipcRenderer.on('console:window.maximized-changed', listener);
            return () => { ipcRenderer.removeListener('console:window.maximized-changed', listener); };
        },
    },

    release: {
        list:    (root: string) => ipcRenderer.invoke('console:release.list', root),
        get:     (root: string) => ipcRenderer.invoke('console:release.get', root),
        summary: (root: string) => ipcRenderer.invoke('console:release.summary', root),
    },
    docs: {
        list: (root: string) => ipcRenderer.invoke('console:docs.list', root),
        read: (root: string, relPath: string) => ipcRenderer.invoke('console:docs.read', root, relPath),
    },
    evals: {
        promptfooSummary:  (root: string) => ipcRenderer.invoke('console:evals.promptfoo.summary', root),
        health:            (root: string) => ipcRenderer.invoke('console:evals.health', root),
        langsmithStatus:   () => ipcRenderer.invoke('console:eval.langsmithStatus'),
        setLangsmithKey:   (key: string) => ipcRenderer.invoke('console:eval.setLangsmithKey', key),
        clearLangsmithKey: () => ipcRenderer.invoke('console:eval.clearLangsmithKey'),
        run:               () => ipcRenderer.invoke('console:eval.run'),
    },
    repo: {
        summary: (root: string) => ipcRenderer.invoke('console:repo.summary', root),
    },
    arch: {
        graph:        (projectRoot: string, options?: unknown) => ipcRenderer.invoke('console:arch.graph', projectRoot, options),
        recompute:    (projectRoot: string, options?: unknown) => ipcRenderer.invoke('console:arch.recompute', projectRoot, options),
        overlayRead:  (projectRoot: string) => ipcRenderer.invoke('console:arch.overlay.read', projectRoot),
        overlayWrite: (projectRoot: string, overlay: unknown) => ipcRenderer.invoke('console:arch.overlay.write', projectRoot, overlay),
    },
    metrics: {
        summary: (root: string) => ipcRenderer.invoke('console:metrics.summary', root),
    },
    obs: {
        runs:      (root: string) => ipcRenderer.invoke('console:obs.runs', root),
        counters:  (root: string) => ipcRenderer.invoke('console:obs.counters', root),
        runDetail: (root: string, runId: string) => ipcRenderer.invoke('console:obs.runDetail', root, runId),
    },
    issues: {
        health: () => ipcRenderer.invoke('console:issues.health'),
        list:   (opts?: { repo?: string; projectRoot?: string; state?: 'open' | 'closed' | 'all'; limit?: number; label?: string }) =>
            ipcRenderer.invoke('console:issues.list', opts),
        detail: (num: number, projectRoot?: string) =>
            ipcRenderer.invoke('console:issues.detail', num, projectRoot),
        relabel: (opts: { number: number; addLabels?: string[]; removeLabels?: string[]; repo?: string; projectRoot?: string }) =>
            ipcRenderer.invoke('console:issues.relabel', opts),
    },

    pipeline: {
        detect: (projectRoot: string) => ipcRenderer.invoke('console:pipeline.detect', projectRoot),
        runs:   (projectRoot: string) => ipcRenderer.invoke('console:pipeline.runs', projectRoot),
    },
    ollama: {
        detect:   () => ipcRenderer.invoke('console:ollama.detect'),
        generate: (opts: { model: string; prompt: string }) => ipcRenderer.invoke('console:ollama.generate', opts),
    },
    repoIntrospect: {
        summary:      (projectRoot: string) => ipcRenderer.invoke('console:repo.summary.full', projectRoot),
        hotFiles:     (projectRoot: string, sinceDays?: number) => ipcRenderer.invoke('console:repo.hotFiles', projectRoot, sinceDays),
        readingOrder: (projectRoot: string) => ipcRenderer.invoke('console:repo.readingOrder', projectRoot),
        shape:        (projectRoot: string) => ipcRenderer.invoke('console:repo.shape', projectRoot),
        capabilities: (projectRoot: string) => ipcRenderer.invoke('console:repo.capabilities', projectRoot),
    },
    project: {
        pickFolder:  () => ipcRenderer.invoke('console:project.pickFolder'),
        detectStack: (root: string) => ipcRenderer.invoke('console:project.detectStack', root),
    },
    library: {
        list: (projectRoot: string) => ipcRenderer.invoke('console:library.list', projectRoot),
        read: (projectRoot: string, relPath: string) => ipcRenderer.invoke('console:library.read', projectRoot, relPath),
    },
    activity: {
        recentCommits: (root: string, limit?: number) => ipcRenderer.invoke('console:activity.recentCommits', root, limit),
    },
    runner: {
        start: (opts: { kind: 'npm' | 'gh' | 'playwright' | 'node'; args: string[]; cwd?: string; label?: string; timeoutMs?: number }) =>
            ipcRenderer.invoke('console:runner.start', opts),
        stop: (runId: string) => ipcRenderer.invoke('console:runner.stop', runId),
        onOutput: (cb: (e: { runId: string; line: string; stream: 'stdout' | 'stderr'; ts: number }) => void) => {
            const listener = (_e: unknown, payload: { runId: string; line: string; stream: 'stdout' | 'stderr'; ts: number }) => cb(payload);
            ipcRenderer.on('console:runner.output', listener);
            return () => { ipcRenderer.removeListener('console:runner.output', listener); };
        },
        onComplete: (cb: (e: { runId: string; exitCode: number | null; durationMs: number; killed: boolean }) => void) => {
            const listener = (_e: unknown, payload: { runId: string; exitCode: number | null; durationMs: number; killed: boolean }) => cb(payload);
            ipcRenderer.on('console:runner.complete', listener);
            return () => { ipcRenderer.removeListener('console:runner.complete', listener); };
        },
    },
    update: {
        check: () => ipcRenderer.invoke('console:update.check'),
        install: () => ipcRenderer.invoke('console:update.install'),
        onEvent: (cb: (e: { status: string; version?: string; percent?: number; message?: string }) => void) => {
            const listener = (_e: unknown, payload: { status: string; version?: string; percent?: number; message?: string }) => cb(payload);
            ipcRenderer.on('console:update.event', listener);
            return () => { ipcRenderer.removeListener('console:update.event', listener); };
        },
    },
    deps: {
        scan: (projectRoot: string) => ipcRenderer.invoke('console:deps.scan', projectRoot),
    },
    secrets: {
        scan: (projectRoot: string) => ipcRenderer.invoke('console:secrets.scan', projectRoot),
    },
    hygiene: {
        scan: (projectRoot: string) => ipcRenderer.invoke('console:hygiene.scan', projectRoot),
    },
    skills: {
        list: () => ipcRenderer.invoke('console:skills.list'),
        installed: (projectRoot: string, tool: string) => ipcRenderer.invoke('console:skills.installed', projectRoot, tool),
        install: (projectRoot: string, id: string, tool: string) => ipcRenderer.invoke('console:skills.install', projectRoot, id, tool),
    },
    env: {
        localNames: (projectRoot: string) => ipcRenderer.invoke('console:env.localNames', projectRoot),
        scanConnectable: (projectRoot: string) => ipcRenderer.invoke('console:env.scanConnectable', projectRoot),
        connect: (projectRoot: string, serviceId: string) => ipcRenderer.invoke('console:env.connect', projectRoot, serviceId),
    },
    connections: {
        list: () => ipcRenderer.invoke('console:connections.list'),
        github: {
            connect:    () => ipcRenderer.invoke('console:connections.github.connect'),
            disconnect: () => ipcRenderer.invoke('console:connections.github.disconnect'),
        },
        vercel: {
            connect:     (token: string) => ipcRenderer.invoke('console:connections.vercel.connect', token),
            disconnect:  () => ipcRenderer.invoke('console:connections.vercel.disconnect'),
            projects:    () => ipcRenderer.invoke('console:connections.vercel.projects'),
            deployments: (projectId?: string) => ipcRenderer.invoke('console:connections.vercel.deployments', projectId),
            redeploy:    (projectId: string, deploymentId: string) =>
                ipcRenderer.invoke('console:connections.vercel.redeploy', projectId, deploymentId),
            detectDeploy: (projectRoot: string) => ipcRenderer.invoke('console:connections.vercel.detectDeploy', projectRoot),
            deploy:      (projectRoot: string, settings: unknown) => ipcRenderer.invoke('console:connections.vercel.deploy', projectRoot, settings),
            deployState: (id: string) => ipcRenderer.invoke('console:connections.vercel.deployState', id),
        },
        sentry: {
            connect:    (token: string, org: string) => ipcRenderer.invoke('console:connections.sentry.connect', token, org),
            disconnect: () => ipcRenderer.invoke('console:connections.sentry.disconnect'),
            issues:     () => ipcRenderer.invoke('console:connections.sentry.issues'),
        },
        slack: {
            connect:    (token: string) => ipcRenderer.invoke('console:connections.slack.connect', token),
            disconnect: () => ipcRenderer.invoke('console:connections.slack.disconnect'),
        },
    },
    connectors: {
        catalog:    () => ipcRenderer.invoke('console:connectors.catalog'),
        status:     () => ipcRenderer.invoke('console:connectors.status'),
        connect:    (id: string, token: string, extra?: Record<string, string>) => ipcRenderer.invoke('console:connectors.connect', id, token, extra),
        disconnect: (id: string) => ipcRenderer.invoke('console:connectors.disconnect', id),
        usage:      (id: string) => ipcRenderer.invoke('console:connectors.usage', id),
    },
    slack: {
        channels:       () => ipcRenderer.invoke('console:slack.channels'),
        setChannelTeam: (channelId: string, team: string) => ipcRenderer.invoke('console:slack.setChannelTeam', channelId, team),
        issues:         () => ipcRenderer.invoke('console:slack.issues'),
    },
    guidelines: {
        generate: () => ipcRenderer.invoke('console:guidelines.generate'),
        write:    (root: string, target: 'agents-md' | 'cursorrules') => ipcRenderer.invoke('console:guidelines.write', root, target),
        status:   (root?: string) => ipcRenderer.invoke('console:guidelines.status', root),
    },
    ai: {
        providers:       () => ipcRenderer.invoke('console:ai.providers'),
        listModels:      () => ipcRenderer.invoke('console:ai.listModels'),
        availableModels: () => ipcRenderer.invoke('console:ai.availableModels'),
        getKeyStatus:    () => ipcRenderer.invoke('console:ai.getKeyStatus'),
        setKey:       (id: string, key: string) => ipcRenderer.invoke('console:ai.setKey', id, key),
        clearKey:     (id: string) => ipcRenderer.invoke('console:ai.clearKey', id),
        chat: {
            start:  (opts: { model: string; messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; system?: string; projectRoot?: string }) =>
                ipcRenderer.invoke('console:ai.chat.start', opts),
            cancel: (chatId: string) => ipcRenderer.invoke('console:ai.chat.cancel', chatId),
            onDelta: (cb: (e: { chatId: string; delta: string }) => void) => {
                const listener = (_e: unknown, payload: { chatId: string; delta: string }) => cb(payload);
                ipcRenderer.on('console:ai.chat.delta', listener);
                return () => { ipcRenderer.removeListener('console:ai.chat.delta', listener); };
            },
            onToolCall: (cb: (e: { chatId: string; id: string; name: string; input: unknown }) => void) => {
                const listener = (_e: unknown, payload: { chatId: string; id: string; name: string; input: unknown }) => cb(payload);
                ipcRenderer.on('console:ai.chat.toolCall', listener);
                return () => { ipcRenderer.removeListener('console:ai.chat.toolCall', listener); };
            },
            onToolResult: (cb: (e: { chatId: string; id: string; name: string; output: unknown }) => void) => {
                const listener = (_e: unknown, payload: { chatId: string; id: string; name: string; output: unknown }) => cb(payload);
                ipcRenderer.on('console:ai.chat.toolResult', listener);
                return () => { ipcRenderer.removeListener('console:ai.chat.toolResult', listener); };
            },
            onDone: (cb: (e: { chatId: string }) => void) => {
                const listener = (_e: unknown, payload: { chatId: string }) => cb(payload);
                ipcRenderer.on('console:ai.chat.done', listener);
                return () => { ipcRenderer.removeListener('console:ai.chat.done', listener); };
            },
            onError: (cb: (e: { chatId: string; error: string }) => void) => {
                const listener = (_e: unknown, payload: { chatId: string; error: string }) => cb(payload);
                ipcRenderer.on('console:ai.chat.error', listener);
                return () => { ipcRenderer.removeListener('console:ai.chat.error', listener); };
            },
        },
    },
    prompts: {
        list:           (projectRoot: string) => ipcRenderer.invoke('console:prompts.list', projectRoot),
        get:            (projectRoot: string, id: string) => ipcRenderer.invoke('console:prompts.get', projectRoot, id),
        create:         (projectRoot: string, input: unknown) => ipcRenderer.invoke('console:prompts.create', projectRoot, input),
        update:         (projectRoot: string, id: string, input: unknown) => ipcRenderer.invoke('console:prompts.update', projectRoot, id, input),
        delete:         (projectRoot: string, id: string) => ipcRenderer.invoke('console:prompts.delete', projectRoot, id),
        toggleFavorite: (projectRoot: string, id: string) => ipcRenderer.invoke('console:prompts.toggleFavorite', projectRoot, id),
    },
    devhandoff: {
        detect:          () => ipcRenderer.invoke('console:devhandoff.detect'),
        writeCursorRules: (root: string, content: string, mode?: 'replace' | 'append') =>
            ipcRenderer.invoke('console:devhandoff.writeCursorRules', root, content, mode),
        writeAgentsMd:   (root: string, content: string, mode?: 'replace' | 'append') =>
            ipcRenderer.invoke('console:devhandoff.writeAgentsMd', root, content, mode),
        runClaude:       (opts: { prompt: string; cwd?: string }) => ipcRenderer.invoke('console:devhandoff.runClaude', opts),
        openInCursor:    (root?: string) => ipcRenderer.invoke('console:devhandoff.openInCursor', root),
        onClaudeOutput: (cb: (e: { runId: string; line: string; stream: 'stdout' | 'stderr'; ts: number }) => void) => {
            const listener = (_e: unknown, payload: { runId: string; line: string; stream: 'stdout' | 'stderr'; ts: number }) => cb(payload);
            ipcRenderer.on('console:devhandoff.claude.output', listener);
            return () => { ipcRenderer.removeListener('console:devhandoff.claude.output', listener); };
        },
        onClaudeComplete: (cb: (e: { runId: string; exitCode: number | null; durationMs: number }) => void) => {
            const listener = (_e: unknown, payload: { runId: string; exitCode: number | null; durationMs: number }) => cb(payload);
            ipcRenderer.on('console:devhandoff.claude.complete', listener);
            return () => { ipcRenderer.removeListener('console:devhandoff.claude.complete', listener); };
        },
    },
    intel: {
        profile:    (projectRoot: string, opts?: { force?: boolean }) => ipcRenderer.invoke('console:intel.profile', projectRoot, opts),
        mountStart: (projectRoot: string) => ipcRenderer.invoke('console:intel.mount.start', projectRoot),
        enrich:     (projectRoot: string, opts?: { model?: string }) => ipcRenderer.invoke('console:intel.enrich', projectRoot, opts),
        onMountStep: (cb: (e: unknown) => void) => {
            const listener = (_e: unknown, payload: unknown) => cb(payload);
            ipcRenderer.on('console:intel.mount.step', listener);
            return () => { ipcRenderer.removeListener('console:intel.mount.step', listener); };
        },
        onMountProfile: (cb: (e: unknown) => void) => {
            const listener = (_e: unknown, payload: unknown) => cb(payload);
            ipcRenderer.on('console:intel.mount.profile', listener);
            return () => { ipcRenderer.removeListener('console:intel.mount.profile', listener); };
        },
        onMountDone: (cb: (e: unknown) => void) => {
            const listener = (_e: unknown, payload: unknown) => cb(payload);
            ipcRenderer.on('console:intel.mount.done', listener);
            return () => { ipcRenderer.removeListener('console:intel.mount.done', listener); };
        },
    },
};

contextBridge.exposeInMainWorld('refringenceConsole', bridge);

export type ConsoleBridge = typeof bridge;
