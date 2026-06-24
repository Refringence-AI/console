// console-electron/src/main/ipc/vercelDeploy.ts
//
// Zero-config deploy to Vercel from Console. Uploads a project's source files
// (excluding deps, build output, and anything secret), then creates a
// deployment - Vercel auto-detects the framework (or uses the settings we pass)
// and builds + serves it. Works even when the project has NOTHING wired for
// deployment (no vercel.json): a project with no build script deploys static.
//
// The `name` field on POST /v13/deployments creates the Vercel project on the
// first deploy, so this single flow handles create + deploy.
//
// The Vercel token is passed in by connections.ts (read from safeStorage). It
// is never read from disk here and never logged.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const VERCEL_API = 'https://api.vercel.com';

// Build output, deps, and VCS metadata - rebuilt by Vercel, never uploaded.
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '.vercel', '.svelte-kit', '.astro', 'coverage', '.cache', '.turbo',
  '.parcel-cache', '.vite', '.output',
]);

// Never upload secrets or local junk, even if the project doesn't gitignore them.
function skipFile(name: string): boolean {
  if (name === '.DS_Store' || name === 'Thumbs.db') return true;
  if (name.endsWith('.log')) return true;
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (/\.(pem|key|p12|pfx|crt)$/i.test(name)) return true;
  if (name.startsWith('id_rsa') || name.startsWith('id_ed25519')) return true;
  if (name === '.npmrc') return true; // may carry a registry token
  return false;
}

export interface DeployFile { file: string; sha: string; size: number; abs: string }

export function walkProject(root: string, maxFiles = 4000): DeployFile[] {
  const out: DeployFile[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) {
        if (skipFile(e.name)) continue;
        const abs = path.join(dir, e.name);
        let buf: Buffer;
        try { buf = fs.readFileSync(abs); } catch { continue; }
        out.push({
          file: rel ? `${rel}/${e.name}` : e.name, // forward-slashed for the API
          sha: crypto.createHash('sha1').update(buf).digest('hex'),
          size: buf.length,
          abs,
        });
      }
    }
  };
  walk(root, '');
  return out;
}

export interface DetectedSettings {
  framework: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  installCommand: string | null;
  hasPackageJson: boolean;
  hasBuildScript: boolean;
  isStatic: boolean;
  suggestedName: string;
}

// Vercel project names: lowercase, alnum + . _ -, <=100 chars.
function sanitizeName(raw: string): string {
  return (raw || 'project')
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100) || 'project';
}

export function detectDeploy(root: string): DetectedSettings {
  let pkg: {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { pkg = null; }

  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const has = (d: string) => Object.prototype.hasOwnProperty.call(deps, d);

  let framework: string | null = null;
  let outputDirectory: string | null = null;
  if (has('next')) framework = 'nextjs';
  else if (has('@sveltejs/kit')) framework = 'sveltekit';
  else if (has('nuxt')) framework = 'nuxtjs';
  else if (has('astro')) { framework = 'astro'; outputDirectory = 'dist'; }
  else if (has('@angular/core')) framework = 'angular';
  else if (has('gatsby')) framework = 'gatsby';
  else if (has('vite')) { framework = 'vite'; outputDirectory = 'dist'; }
  else if (has('react-scripts')) { framework = 'create-react-app'; outputDirectory = 'build'; }

  const hasBuildScript = !!pkg?.scripts?.build;
  return {
    framework,
    buildCommand: null, // null => Vercel uses the framework default / `npm run build`
    outputDirectory,
    installCommand: null,
    hasPackageJson: !!pkg,
    hasBuildScript,
    isStatic: !pkg || !hasBuildScript,
    suggestedName: sanitizeName(pkg?.name || path.basename(root)),
  };
}

async function uploadFile(token: string, f: DeployFile): Promise<void> {
  const res = await fetch(`${VERCEL_API}/v2/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'x-vercel-digest': f.sha,
    },
    body: fs.readFileSync(f.abs),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = await res.json() as { error?: { message?: string } };
      if (b?.error?.message) detail = b.error.message;
    } catch { /* ignore */ }
    throw new Error(`upload ${f.file}: ${detail}`);
  }
}

export interface DeploySettings {
  name: string;
  framework: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  installCommand: string | null;
  target: 'production' | 'preview';
}

export interface DeployResult { id: string; url: string; inspectorUrl: string; state: string }

export async function deployProject(token: string, root: string, settings: DeploySettings): Promise<DeployResult> {
  const files = walkProject(root);
  if (files.length === 0) throw new Error('no deployable files found in this project');

  // Upload with small concurrency.
  let idx = 0;
  const worker = async () => { while (idx < files.length) await uploadFile(token, files[idx++]); };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));

  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: settings.name,
      files: files.map((f) => ({ file: f.file, sha: f.sha, size: f.size })),
      projectSettings: {
        framework: settings.framework,
        buildCommand: settings.buildCommand,
        outputDirectory: settings.outputDirectory,
        installCommand: settings.installCommand,
      },
      target: settings.target,
    }),
  });
  type DeployBody = { id?: string; url?: string; inspectorUrl?: string; readyState?: string; error?: { message?: string } };
  let body: DeployBody | null = null;
  try { body = await res.json() as DeployBody; } catch { /* ignore */ }
  if (!res.ok) throw new Error(body?.error?.message || `Vercel deployment failed: HTTP ${res.status}`);
  return {
    id: body?.id ?? '',
    url: body?.url ?? '',
    inspectorUrl: body?.inspectorUrl ?? '',
    state: body?.readyState ?? 'QUEUED',
  };
}

export async function deploymentState(token: string, id: string): Promise<{ state: string; url: string }> {
  const res = await fetch(`${VERCEL_API}/v13/deployments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  type StateBody = { readyState?: string; state?: string; url?: string; alias?: string[] };
  let body: StateBody | null = null;
  try { body = await res.json() as StateBody; } catch { /* ignore */ }
  // Prefer the production alias (the clean PUBLIC url, e.g. <project>.vercel.app)
  // over the deployment-specific url, which Vercel's deployment protection locks
  // behind a login wall. The shortest alias is the auto-assigned production
  // domain; fall back to the deployment url only if no alias is assigned yet.
  const aliases = (body?.alias ?? []).filter(Boolean).sort((a, b) => a.length - b.length);
  const url = aliases[0] ?? body?.url ?? '';
  return { state: body?.readyState ?? body?.state ?? 'UNKNOWN', url };
}
