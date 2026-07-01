import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Loader2, KeyRound, Check, Minus, Copy } from 'lucide-react';
import { bridge, type LiveMigrationDiff } from '../../lib/bridge';
import { useActiveProject } from '../../lib/activeProject';
import { toast } from 'sonner';
import { SectionLabel, Button } from '@/components/ui';
import { FixButton, type FixKind } from './FixWithPrompt';

/**
 * Dependency health: checks the project's declared deps against OSV.dev (known
 * vulnerabilities) and the npm registry (newer releases). Read-only network
 * lookups - never installs, writes, or runs the project. Auto-runs once per
 * panel session (cached 10m); a Re-check forces a fresh pull.
 */
export function DependencyHealth() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const scan = useQuery({
        queryKey: ['deps', 'scan', root],
        queryFn: () => bridge.deps.scan(root),
        enabled: root.length > 0,
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    });
    const d = scan.data;
    if (root.length === 0) return null;
    // npm-only signal; nothing to show for a project with no package.json deps.
    if (d && d.total === 0 && !scan.isLoading) return null;

    return (
        <section className="flex flex-col gap-2.5" data-testid="repo-deps-health">
            <div className="flex items-center gap-2">
                <SectionLabel>Dependency health</SectionLabel>
                {d && (
                    <button
                        type="button"
                        onClick={() => void scan.refetch()}
                        className="ml-auto text-label uppercase tracking-wide text-muted-foreground underline-offset-2 hover:underline"
                        data-testid="repo-deps-recheck"
                    >
                        {scan.isFetching ? 'Checking…' : 'Re-check'}
                    </button>
                )}
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                {scan.isLoading && (
                    <div className="flex flex-col gap-2.5" data-testid="repo-deps-loading">
                        <p className="flex items-center gap-2 text-small text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Scanning dependencies against OSV and npm for vulnerable + outdated packages…
                        </p>
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="h-9 animate-pulse rounded-lg bg-secondary/70" />
                        ))}
                    </div>
                )}
                {scan.isError && <p className="text-small text-danger-text">Could not check dependencies right now.</p>}
                {d && (
                    <>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-small">
                            <span className="text-muted-foreground">Checked <span className="tabular-nums text-foreground">{d.checked}</span></span>
                            <span className={d.vulnerable.length ? 'text-danger-text' : 'text-muted-foreground'}>
                                Vulnerable <span className="tabular-nums">{d.vulnerable.length}</span>
                            </span>
                            <span className="text-muted-foreground">Outdated <span className="tabular-nums text-foreground">{d.outdated.length}</span></span>
                        </div>

                        {d.vulnerable.length === 0 && d.outdated.length === 0 && (
                            <p className="flex items-center gap-1.5 text-small text-success-text">
                                <CheckCircle2 className="size-3.5" /> No known vulnerabilities or updates. Looking healthy.
                            </p>
                        )}

                        {d.vulnerable.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                                {d.vulnerable.slice(0, 6).map((v) => (
                                    <div key={v.name} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2" data-testid={`repo-vuln-${v.name}`}>
                                        <AlertTriangle className="size-3.5 shrink-0 text-danger-text" />
                                        <span className="font-mono text-small text-foreground">{v.name}@{v.version}</span>
                                        <button
                                            type="button"
                                            onClick={() => void bridge.openExternal(`https://osv.dev/vulnerability/${v.vulns[0].id}`)}
                                            className="ml-auto text-label uppercase tracking-wide text-muted-foreground underline-offset-2 hover:underline"
                                        >
                                            {v.vulns.length} advisor{v.vulns.length === 1 ? 'y' : 'ies'}
                                        </button>
                                    </div>
                                ))}
                                {d.vulnerable.length > 6 && (
                                    <p className="text-label uppercase tracking-wide text-muted-foreground">+{d.vulnerable.length - 6} more vulnerable</p>
                                )}
                                <FixButton kind="vulnerable-deps" detail={d.vulnerable.map((v) => `${v.name}@${v.version}`).join(', ')} />
                            </div>
                        )}

                        {d.outdated.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                                <span className="flex items-center gap-1.5 text-label uppercase tracking-wide text-muted-foreground">
                                    <ArrowUpCircle className="size-3" /> Updates available
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {d.outdated.slice(0, 12).map((o) => (
                                        <span key={o.name} className="rounded-md border border-border bg-secondary/40 px-2 py-0.5 font-mono text-label text-muted-foreground">
                                            {o.name} {o.current}<span className="text-foreground">→{o.latest}</span>
                                        </span>
                                    ))}
                                    {d.outdated.length > 12 && <span className="text-label text-muted-foreground">+{d.outdated.length - 12} more</span>}
                                </div>
                                <FixButton kind="outdated-deps" detail={d.outdated.map((o) => `${o.name} ${o.current}->${o.latest}`).join(', ')} />
                            </div>
                        )}
                        {d.error && <p className="text-label text-muted-foreground">Partial result: {d.error}</p>}
                    </>
                )}
            </div>
        </section>
    );
}

/**
 * Keys in the open: scans source + config for hardcoded secrets (well-known token
 * formats + private keys). The renderer only ever sees a redacted preview. .env
 * files are skipped on purpose. Auto-runs once per panel session.
 */
export function SecretsCheck() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const scan = useQuery({
        queryKey: ['secrets', 'scan', root],
        queryFn: () => bridge.secrets.scan(root),
        enabled: root.length > 0,
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    });
    const d = scan.data;
    if (root.length === 0) return null;

    return (
        <section className="flex flex-col gap-2.5" data-testid="repo-secrets-check">
            <div className="flex items-center gap-2">
                <SectionLabel>Exposed secrets</SectionLabel>
                {d && (
                    <button
                        type="button"
                        onClick={() => void scan.refetch()}
                        className="ml-auto text-label uppercase tracking-wide text-muted-foreground underline-offset-2 hover:underline"
                    >
                        {scan.isFetching ? 'Scanning…' : 'Re-scan'}
                    </button>
                )}
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                {scan.isLoading && (
                    <p className="flex items-center gap-2 text-small text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Scanning source for keys in the open…
                    </p>
                )}
                {d && d.findings.length === 0 && (
                    <p className="flex items-center gap-1.5 text-small text-success-text">
                        <CheckCircle2 className="size-3.5" /> No keys found in source. Scanned {d.scanned} files.
                    </p>
                )}
                {d && d.findings.length > 0 && (
                    <>
                        <p className="flex items-center gap-1.5 text-small text-danger-text">
                            <KeyRound className="size-3.5" /> {d.findings.length} possible secret{d.findings.length === 1 ? '' : 's'} in source - move {d.findings.length === 1 ? 'it' : 'them'} to .env.
                        </p>
                        <div className="flex flex-col gap-1.5">
                            {d.findings.slice(0, 8).map((f, i) => (
                                <div key={`${f.file}:${f.line}:${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2" data-testid="repo-secret-finding">
                                    <AlertTriangle className="size-3.5 shrink-0 text-danger-text" />
                                    <span className="min-w-0 flex-1 truncate font-mono text-small text-foreground" title={`${f.file}:${f.line}`}>
                                        {f.file}<span className="text-muted-foreground">:{f.line}</span>
                                    </span>
                                    <span className="shrink-0 text-label uppercase tracking-wide text-muted-foreground">{f.type}</span>
                                    <code className="shrink-0 font-mono text-label text-muted-foreground">{f.preview}</code>
                                </div>
                            ))}
                            {d.findings.length > 8 && (
                                <p className="text-label uppercase tracking-wide text-muted-foreground">+{d.findings.length - 8} more</p>
                            )}
                        </div>
                        <FixButton kind="exposed-secret" detail={d.findings.map((f) => `${f.file}:${f.line}`).join(', ')} />
                    </>
                )}
            </div>
        </section>
    );
}

/**
 * Project setup: presence of the files a healthy repo carries (README, LICENSE,
 * .gitignore, CI, lockfile, tests, .env.example). Present items show as chips;
 * missing ones list a one-line suggestion. Cheap local check, auto-runs.
 */
export function HygieneCheck() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const scan = useQuery({
        queryKey: ['hygiene', 'scan', root],
        queryFn: () => bridge.hygiene.scan(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    const d = scan.data;
    if (root.length === 0) return null;
    if (d && d.items.length === 0) return null;
    const present = d ? d.items.filter((i) => i.present) : [];
    const missing = d ? d.items.filter((i) => !i.present) : [];

    return (
        <section className="flex flex-col gap-2.5" data-testid="repo-hygiene">
            <SectionLabel>Project setup</SectionLabel>
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                {scan.isLoading && (
                    <div className="flex flex-col gap-2.5" data-testid="repo-hygiene-loading">
                        <p className="flex items-center gap-2 text-small text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Checking your project files for setup essentials…
                        </p>
                        <div className="h-9 w-1/2 animate-pulse rounded-lg bg-secondary/70" />
                        <div className="h-1.5 w-full animate-pulse rounded-full bg-secondary/40" />
                        {[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-secondary/70" />)}
                    </div>
                )}
                {d && (
                    <>
                        <div className="flex items-center gap-3">
                            <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-card-title tabular-nums ${missing.length === 0 ? 'bg-success/15 text-success-text' : 'bg-secondary text-foreground'}`}>
                                {missing.length === 0 ? <CheckCircle2 className="size-5" /> : present.length}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-card-title text-foreground">{missing.length === 0 ? 'Setup complete' : `${present.length} of ${d.items.length} essentials in place`}</p>
                                <p className="text-small text-muted-foreground">{missing.length === 0 ? 'This repo has everything a healthy project needs.' : `${missing.length} ${missing.length === 1 ? 'thing' : 'things'} to add before it is ship-ready.`}</p>
                            </div>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.round((present.length / Math.max(1, d.items.length)) * 100)}%` }} />
                        </div>
                        {present.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {present.map((i) => (
                                    <span key={i.id} className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-label text-success-text">
                                        <Check className="size-3" />{i.label}{i.id === 'license' && i.detail && i.detail !== 'present' ? ` · ${i.detail}` : ''}
                                    </span>
                                ))}
                            </div>
                        )}
                        {missing.length === 0 ? (
                            <p className="flex items-center gap-1.5 text-small text-success-text">
                                <CheckCircle2 className="size-3.5" /> Everything a healthy repo needs is here.
                            </p>
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                {missing.map((i) => {
                                    const canGenerate = i.id === 'gitignore' || i.id === 'license' || i.id === 'readme';
                                    return (
                                    <div key={i.id} className="group flex items-start gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 transition hover:border-foreground/15 hover:bg-secondary/50" data-testid={`repo-hygiene-missing-${i.id}`}>
                                        <Minus className="mt-0.5 size-3.5 shrink-0 text-warning" />
                                        <div className="min-w-0 flex-1">
                                            <span className="text-small font-medium text-foreground">Missing {i.label}</span>
                                            {i.suggestion && <p className="text-small leading-relaxed text-muted-foreground">{i.suggestion}</p>}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                                            {canGenerate && (
                                                <Button
                                                    variant="outline"
                                                    size="xs"
                                                    data-testid={`repo-hygiene-gen-${i.id}`}
                                                    onClick={async () => {
                                                        const r = await bridge.generate.file(root, i.id as 'gitignore' | 'license' | 'readme');
                                                        if (r.ok) { toast.success(`Added ${r.path}`); void scan.refetch(); }
                                                        else toast.error(r.error ?? 'Could not generate the file');
                                                    }}
                                                >
                                                    Generate
                                                </Button>
                                            )}
                                            <FixButton kind={`missing-${i.id}` as FixKind} />
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

/**
 * Environment variables: compares .env.example to .env and surfaces config
 * gaps (documented keys not set) + undocumented keys. Privacy-safe: it reads
 * only the KEY NAMES, never a value, and respects the per-project .env consent.
 */
export function EnvCheck() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const q = useQuery({
        queryKey: ['checks', 'run', root],
        queryFn: () => bridge.checks.run(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    if (root.length === 0) return null;
    const env = q.data?.find((c) => c.id === 'env-diff');
    // No .env.example to check against -> nothing useful to show.
    if (env && env.status === 'skip' && env.findings.length === 0) return null;

    return (
        <section className="flex flex-col gap-2.5" data-testid="repo-env-check">
            <SectionLabel>Environment variables</SectionLabel>
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                {q.isLoading && (
                    <p className="flex items-center gap-2 text-small text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Comparing .env.example with your .env…
                    </p>
                )}
                {env && (
                    <>
                        <div className="flex items-center gap-3">
                            <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${env.status === 'pass' ? 'bg-success/15 text-success-text' : env.status === 'warn' ? 'bg-warning/15 text-warning' : 'bg-secondary text-muted-foreground'}`}>
                                {env.status === 'pass' ? <CheckCircle2 className="size-5" /> : env.status === 'warn' ? <AlertTriangle className="size-5" /> : <KeyRound className="size-5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-card-title text-foreground">{env.title}</p>
                                <p className="text-small text-muted-foreground">{env.summary}</p>
                            </div>
                        </div>
                        {env.findings.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                                {env.findings.slice(0, 12).map((f) => (
                                    <div key={`${f.label}-${f.severity}`} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-1.5">
                                        <Minus className={`size-3.5 shrink-0 ${f.severity === 'warn' ? 'text-warning' : 'text-muted-foreground'}`} />
                                        <code className="font-mono text-label text-foreground">{f.label}</code>
                                        {f.detail && <span className="truncate text-label text-muted-foreground">{f.detail}</span>}
                                    </div>
                                ))}
                                {env.findings.length > 12 && (
                                    <span className="text-label text-muted-foreground">+{env.findings.length - 12} more</span>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

/**
 * Renders one deterministic CheckResult (from bridge.checks.run) as a status
 * card: an icon, the summary, the flagged findings, and the next action. Shared
 * by the migration-drift and committed-files cards.
 */
function CheckCard({ checkId, sectionLabel, testid, hideOnSkip = true }: {
    checkId: string;
    sectionLabel: string;
    testid: string;
    hideOnSkip?: boolean;
}) {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const q = useQuery({
        queryKey: ['checks', 'run', root],
        queryFn: () => bridge.checks.run(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    if (root.length === 0) return null;
    const m = q.data?.find((c) => c.id === checkId);
    if (!m || (hideOnSkip && m.status === 'skip')) return null;
    const rows = m.findings.filter((f) => f.label !== 'tool' && f.label !== 'count');

    return (
        <section className="flex flex-col gap-2.5" data-testid={testid}>
            <SectionLabel>{sectionLabel}</SectionLabel>
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                    <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${m.status === 'pass' ? 'bg-success/15 text-success-text' : m.status === 'fail' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'}`}>
                        {m.status === 'pass' ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-card-title text-foreground">{m.title}</p>
                        <p className="text-small text-muted-foreground">{m.summary}</p>
                    </div>
                </div>
                {rows.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        {rows.slice(0, 12).map((f) => (
                            <div key={`${f.label}-${f.severity}`} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-1.5">
                                <Minus className={`size-3.5 shrink-0 ${f.severity === 'fail' ? 'text-danger' : f.severity === 'warn' ? 'text-warning' : 'text-muted-foreground'}`} />
                                <code className="font-mono text-label text-foreground">{f.label}</code>
                                {f.detail && <span className="truncate text-label text-muted-foreground">{f.detail}</span>}
                            </div>
                        ))}
                        {rows.length > 12 && <span className="text-label text-muted-foreground">+{rows.length - 12} more</span>}
                    </div>
                )}
                {m.nextAction && <NextAction text={m.nextAction} />}
            </div>
        </section>
    );
}

// A check's next action, with a one-click copy of the shell command it quotes
// (e.g. git rm --cached) so the suggested fix is also an action.
function NextAction({ text }: { text: string }) {
    const cmd = /"([^"]+)"/.exec(text)?.[1] ?? null;
    const [copied, setCopied] = useState(false);
    return (
        <div className="flex items-start gap-2">
            <p className="flex-1 text-small leading-relaxed text-muted-foreground">{text}</p>
            {cmd && (
                <button
                    type="button"
                    onClick={() => { void navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-label text-muted-foreground transition-colors hover:text-foreground"
                    title={`Copy: ${cmd}`}
                    data-testid="check-copy-fix"
                >
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copied ? 'Copied' : 'Copy fix'}
                </button>
            )}
        </div>
    );
}

/**
 * Repository health: a one-line rollup of the deterministic checks (env, database
 * migrations, committed files), so the Repo panel leads with the verdict before
 * the per-check cards. Reads the same checks query, deduped.
 */
export function RepoHealthSummary() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const q = useQuery({
        queryKey: ['checks', 'run', root],
        queryFn: () => bridge.checks.run(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    if (root.length === 0) return null;
    const checks = (q.data ?? []).filter((c) => c.status !== 'skip' && c.id !== 'error');
    if (checks.length === 0) return null;
    const fails = checks.filter((c) => c.status === 'fail');
    const warns = checks.filter((c) => c.status === 'warn');
    const attention = fails.length + warns.length;
    const tone = fails.length ? 'fail' : warns.length ? 'warn' : 'pass';
    const worst = fails[0] ?? warns[0];

    return (
        <section className="flex flex-col gap-2.5" data-testid="repo-health-summary">
            <SectionLabel>Repository health</SectionLabel>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone === 'pass' ? 'bg-success/15 text-success-text' : tone === 'fail' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'}`}>
                    {tone === 'pass' ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-card-title text-foreground">
                        {attention === 0
                            ? `All ${checks.length} ${checks.length === 1 ? 'check is' : 'checks are'} passing`
                            : `${attention} of ${checks.length} ${attention === 1 ? 'check needs' : 'checks need'} attention`}
                    </p>
                    <p className="truncate text-small text-muted-foreground">
                        {worst ? worst.summary : 'No issues across the deterministic checks.'}
                    </p>
                </div>
            </div>
        </section>
    );
}

/**
 * Database migrations: detects migration drift from files alone - a missing
 * rollback, a version clash, a journal/folder mismatch, an empty migration, or
 * hand-applied SQL with no tracking. Read-only; never opens a database.
 */
export function MigrationDriftCheck() {
    return <CheckCard checkId="migration-drift" sectionLabel="Database migrations" testid="repo-migration-check" />;
}

/**
 * Committed files: flags build output, tool caches, logs, a committed .env, or
 * conflicting lockfiles that ended up in the repo, cross-checked against
 * .gitignore so an ignored path is never flagged.
 */
export function StaleArtifactsCheck() {
    return <CheckCard checkId="stale-artifacts" sectionLabel="Committed files" testid="repo-stale-check" hideOnSkip={false} />;
}

/**
 * Unused dependencies: a package.json dependency imported nowhere in source,
 * config, or scripts. Findings are low-confidence (a dep can be used dynamically
 * or in CSS), so they read as "verify before removing", never "delete this".
 */
export function UnusedDepsCheck() {
    return <CheckCard checkId="unused-deps" sectionLabel="Unused dependencies" testid="repo-unused-deps" />;
}

/**
 * The optional live half of the migration check: compare the migration files
 * against what actually ran on the database. Only shown when the project has
 * migrations. The read-only connection string is used once and never stored.
 */
export function MigrationLiveDiff() {
    const { project } = useActiveProject();
    const root = project?.path ?? '';
    const q = useQuery({
        queryKey: ['checks', 'run', root],
        queryFn: () => bridge.checks.run(root),
        enabled: root.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    const m = q.data?.find((c) => c.id === 'migration-drift');
    const [open, setOpen] = useState(false);
    const [conn, setConn] = useState('');
    const [busy, setBusy] = useState(false);
    const [diff, setDiff] = useState<LiveMigrationDiff | null>(null);
    if (root.length === 0 || !m || m.status === 'skip') return null;

    async function compare() {
        setBusy(true);
        try { setDiff(await bridge.checks.migrationLiveDiff(root, conn)); }
        catch (e) { setDiff({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
        finally { setBusy(false); }
    }

    return (
        <section className="flex flex-col gap-2.5" data-testid="repo-migration-live">
            <SectionLabel>Migrations vs the live database</SectionLabel>
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <p className="text-small leading-relaxed text-muted-foreground">
                    Compare your migration files against what actually ran on the database. Paste a scoped, read-only connection string; it is used once and never stored, and only read queries run.
                </p>
                {!open ? (
                    <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)} data-testid="migration-live-open">
                        Compare to live database
                    </Button>
                ) : (
                    <div className="flex flex-col gap-2">
                        <input
                            type="password"
                            value={conn}
                            onChange={(e) => setConn(e.target.value)}
                            placeholder="postgresql://readonly:...@host:5432/db"
                            className="h-8 rounded-md border border-border bg-background px-2 font-mono text-small text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-testid="migration-live-conn"
                        />
                        <div className="flex items-center gap-2">
                            <Button size="sm" loading={busy} disabled={conn.trim().length === 0} onClick={compare} data-testid="migration-live-compare">
                                Compare
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setConn(''); setDiff(null); }}>Cancel</Button>
                        </div>
                        <p className="text-label uppercase tracking-wide text-muted-foreground/70">Used once, never stored. Read-only queries only.</p>
                    </div>
                )}
                {diff && <LiveDiffResult diff={diff} />}
            </div>
        </section>
    );
}

function LiveDiffResult({ diff }: { diff: LiveMigrationDiff }) {
    if (!diff.ok) return <p className="text-small text-danger" data-testid="migration-live-error">{diff.error}</p>;
    const extra = diff.extra ?? [];
    const pending = diff.pending ?? [];
    const inSync = extra.length === 0 && pending.length === 0;
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2.5" data-testid="migration-live-result">
            <p className="text-small text-foreground">
                {diff.tool}: {diff.appliedCount} applied, {diff.fileCount} in files{inSync ? '. In sync.' : '.'}
            </p>
            {extra.length > 0 && (
                <div className="flex flex-col gap-0.5">
                    <p className="text-label text-warning-text">Applied to the database but not in your files ({extra.length}), the drift:</p>
                    {extra.slice(0, 8).map((v) => <code key={v} className="font-mono text-label text-foreground/80">{v}</code>)}
                </div>
            )}
            {pending.length > 0 && (
                <div className="flex flex-col gap-0.5">
                    <p className="text-label text-muted-foreground">In your files but not applied yet ({pending.length}):</p>
                    {pending.slice(0, 8).map((v) => <code key={v} className="font-mono text-label text-foreground/80">{v}</code>)}
                </div>
            )}
        </div>
    );
}
