// console-electron/src/main/config-templates.ts
//
// Pure functions that return deploy/CI config-file strings tailored to a
// detected stack descriptor. No file I/O, no network, no side effects.
// The Opus integrator wires these into generators.ts + the AI generate_config
// tool; these functions only produce strings.

export interface StackDescriptor {
    framework?: string;       // e.g. 'next', 'vite', 'remix', 'express', 'none'
    packageManager?: string;  // 'npm' | 'yarn' | 'pnpm' | 'bun'
    hasMonorepo?: boolean;
    buildCmd?: string;        // e.g. 'npm run build'
    outputDir?: string;       // e.g. 'dist', '.next', 'out'
    startCmd?: string;        // e.g. 'node dist/server.js'
    nodeVersion?: string;     // e.g. '20'
}

export type ConfigKind =
    | 'vercel.json'
    | 'render.yaml'
    | 'railway.json'
    | 'Dockerfile'
    | 'docker-compose.yaml'
    | 'github-actions-ci.yml';

export const CONFIG_KINDS: ConfigKind[] = [
    'vercel.json',
    'render.yaml',
    'railway.json',
    'Dockerfile',
    'docker-compose.yaml',
    'github-actions-ci.yml',
];

function nodeVer(stack: StackDescriptor): string {
    return stack.nodeVersion ?? '20';
}

function pm(stack: StackDescriptor): string {
    return stack.packageManager ?? 'npm';
}

function installCmd(stack: StackDescriptor): string {
    const p = pm(stack);
    if (p === 'yarn') return 'yarn install --frozen-lockfile';
    if (p === 'pnpm') return 'pnpm install --frozen-lockfile';
    if (p === 'bun') return 'bun install --frozen-lockfile';
    return 'npm ci';
}

function buildLine(stack: StackDescriptor): string {
    return stack.buildCmd ?? `${pm(stack)} run build`;
}

function testLine(stack: StackDescriptor): string {
    const p = pm(stack);
    if (p === 'yarn') return 'yarn test --if-present';
    if (p === 'pnpm') return 'pnpm test --if-present';
    if (p === 'bun') return 'bun test';
    return 'npm test --if-present';
}

function startLine(stack: StackDescriptor): string {
    return stack.startCmd ?? 'node dist/index.js';
}

function outputDirectory(stack: StackDescriptor): string {
    return stack.outputDir ?? 'dist';
}

// --- vercel.json -----------------------------------------------------------
// For known frameworks Vercel auto-detects everything; we emit a minimal stub
// that only pins what the user explicitly specified. For unknown / no framework
// we emit a static-output config.
export function vercelJson(stack: StackDescriptor): string {
    const known = new Set(['next', 'nuxt', 'sveltekit', 'remix', 'astro', 'gatsby', 'vite', 'create-react-app']);
    const fw = stack.framework?.toLowerCase() ?? '';

    if (known.has(fw)) {
        const note = `// Vercel auto-detects ${stack.framework} - zero config needed.\n// Add overrides only if you need them.\n`;
        const obj: Record<string, unknown> = {};
        if (stack.buildCmd) obj['buildCommand'] = stack.buildCmd;
        if (stack.outputDir) obj['outputDirectory'] = stack.outputDir;
        if (stack.nodeVersion) obj['functions'] = { 'api/**': { runtime: `nodejs${stack.nodeVersion}.x` } };
        if (Object.keys(obj).length === 0) return `${note}{}`;
        return `${note}${JSON.stringify(obj, null, 2)}`;
    }

    const obj: Record<string, unknown> = {
        version: 2,
        builds: [{ src: outputDirectory(stack) + '/**', use: '@vercel/static' }],
        routes: [{ src: '/(.*)', dest: '/$1' }],
    };
    if (stack.buildCmd) obj['buildCommand'] = stack.buildCmd;
    if (stack.outputDir) obj['outputDirectory'] = stack.outputDir;
    return JSON.stringify(obj, null, 2);
}

// --- render.yaml -----------------------------------------------------------
export function renderYaml(stack: StackDescriptor): string {
    const lines: string[] = [
        'services:',
        '  - type: web',
        `    name: app`,
        '    runtime: node',
        `    nodeVersion: "${nodeVer(stack)}"`,
        `    buildCommand: "${installCmd(stack)} && ${buildLine(stack)}"`,
        `    startCommand: "${startLine(stack)}"`,
        '    envVars:',
        '      - key: NODE_ENV',
        '        value: production',
    ];
    if (stack.outputDir) {
        lines.push(`    # Build outputs to ${stack.outputDir}`);
    }
    return lines.join('\n') + '\n';
}

// --- railway.json ----------------------------------------------------------
export function railwayJson(stack: StackDescriptor): string {
    const obj: Record<string, unknown> = {
        '$schema': 'https://railway.app/railway.schema.json',
        build: {
            builder: 'NIXPACKS',
        },
        deploy: {
            startCommand: startLine(stack),
            healthcheckPath: '/',
            restartPolicyType: 'ON_FAILURE',
            restartPolicyMaxRetries: 10,
        },
    };
    return JSON.stringify(obj, null, 2);
}

// --- Dockerfile ------------------------------------------------------------
// Multi-stage: deps -> build -> production image.
export function dockerfile(stack: StackDescriptor): string {
    const node = nodeVer(stack);
    const p = pm(stack);
    const install = installCmd(stack);
    const build = buildLine(stack);
    const start = startLine(stack);
    const out = outputDirectory(stack);

    let lockCopy = 'package-lock.json* ';
    if (p === 'yarn') lockCopy = 'yarn.lock ';
    if (p === 'pnpm') lockCopy = 'pnpm-lock.yaml ';
    if (p === 'bun') lockCopy = 'bun.lockb ';

    const pmInstall = p === 'pnpm'
        ? `RUN corepack enable && corepack prepare pnpm@latest --activate\n`
        : p === 'yarn'
            ? `RUN corepack enable\n`
            : p === 'bun'
                ? `RUN npm i -g bun\n`
                : '';

    return [
        `# syntax=docker/dockerfile:1`,
        ``,
        `# --- deps stage ---`,
        `FROM node:${node}-alpine AS deps`,
        `WORKDIR /app`,
        `COPY package.json ${lockCopy}./`,
        pmInstall ? pmInstall.trimEnd() : '',
        `RUN ${install}`,
        ``,
        `# --- build stage ---`,
        `FROM node:${node}-alpine AS builder`,
        `WORKDIR /app`,
        `COPY --from=deps /app/node_modules ./node_modules`,
        `COPY . .`,
        `RUN ${build}`,
        ``,
        `# --- production stage ---`,
        `FROM node:${node}-alpine AS runner`,
        `WORKDIR /app`,
        `ENV NODE_ENV=production`,
        `COPY --from=builder /app/${out} ./${out}`,
        `COPY --from=builder /app/package.json ./`,
        `RUN ${install} --omit=dev || true`,
        `EXPOSE 3000`,
        `CMD ${JSON.stringify(start.split(' '))}`,
        ``,
    ].filter((l) => l !== '').join('\n');
}

// --- docker-compose.yaml ---------------------------------------------------
export function composeYaml(stack: StackDescriptor): string {
    const lines: string[] = [
        'services:',
        '  app:',
        '    build: .',
        '    ports:',
        '      - "3000:3000"',
        '    environment:',
        '      - NODE_ENV=production',
        '    restart: unless-stopped',
    ];
    if (stack.hasMonorepo) {
        lines.push('    # Monorepo: mount the repo root so sub-packages resolve correctly.');
        lines.push('    volumes:');
        lines.push('      - .:/app');
        lines.push('      - /app/node_modules');
    }
    return lines.join('\n') + '\n';
}

// --- GitHub Actions CI -----------------------------------------------------
export function githubActionsCi(stack: StackDescriptor): string {
    const node = nodeVer(stack);
    const install = installCmd(stack);
    const build = buildLine(stack);
    const test = testLine(stack);

    const lines: string[] = [
        `name: CI`,
        ``,
        `on:`,
        `  push:`,
        `    branches: [main, master]`,
        `  pull_request:`,
        `    branches: [main, master]`,
        ``,
        `jobs:`,
        `  build-and-test:`,
        `    runs-on: ubuntu-latest`,
        ``,
        `    steps:`,
        `      - uses: actions/checkout@v4`,
        ``,
        `      - name: Set up Node.js`,
        `        uses: actions/setup-node@v4`,
        `        with:`,
        `          node-version: "${node}"`,
        `          cache: "${pm(stack) === 'npm' ? 'npm' : pm(stack)}"`,
        ``,
        `      - name: Install dependencies`,
        `        run: ${install}`,
        ``,
        `      - name: Build`,
        `        run: ${build}`,
        ``,
        `      - name: Test`,
        `        run: ${test}`,
    ];
    return lines.join('\n') + '\n';
}

// --- Dispatcher ------------------------------------------------------------
export function generateConfig(kind: ConfigKind, stack: StackDescriptor): string {
    switch (kind) {
        case 'vercel.json':          return vercelJson(stack);
        case 'render.yaml':          return renderYaml(stack);
        case 'railway.json':         return railwayJson(stack);
        case 'Dockerfile':           return dockerfile(stack);
        case 'docker-compose.yaml':  return composeYaml(stack);
        case 'github-actions-ci.yml': return githubActionsCi(stack);
        default: return '';
    }
}
