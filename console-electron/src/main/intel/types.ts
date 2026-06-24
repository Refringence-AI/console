// console-electron/src/main/intel/types.ts
//
// The ProjectProfile is the single data shape every downstream surface reads:
// the mount/study flow streams it, the Project Report renders it, the services
// pane derives its connect cards from `services`, and the architecture Systems
// view consumes `depGraph` + `ai`. Layer 1 (the deterministic profiler) fills
// everything except `ai`; Layer 2 (AI enrichment) fills `ai` when a provider is
// connected. Nothing here is secret: env handling carries key NAMES only, never
// values.
import type { DependencyGraph } from '../ipc/architecture-graph';
import type { ProjectShape } from '../ipc/repo-introspect';

export type ServiceCategory =
    | 'repo' | 'hosting-frontend' | 'hosting-backend' | 'database'
    | 'observability' | 'analytics' | 'payment' | 'queue'
    | 'ai-model' | 'comms' | 'search' | 'auth' | 'email' | 'cdn';

export type ServiceConfidence = 'high' | 'medium';
export type ServiceEvidence = 'env' | 'dep' | 'config' | 'mcp';

export interface DetectedService {
    id: string;
    name: string;
    category: ServiceCategory;
    confidence: ServiceConfidence;
    /** Which signal families fired, deduped + ordered strongest-first. */
    via: ServiceEvidence[];
    /** Human-readable proof lines, e.g. "dep: @sentry/node", "env: SENTRY_DSN". */
    evidence: string[];
    /** The Console panel this service powers when connected, or null. */
    powers: string | null;
    /** One-line free-vs-paid summary, for the suggest UI. */
    pricing: string;
    docsUrl: string;
}

export interface LanguageStat {
    language: string;
    files: number;
    loc: number;
    bytes: number;
    /** Share of total code LOC, 0..1. */
    share: number;
}

export type PackageKind = 'app' | 'lib' | 'tooling' | 'test' | 'docs' | 'unknown';

export interface PackageInfo {
    name: string;
    relPath: string;
    role: string;
    loc: number;
    fileCount: number;
    /** From the package's own manifest, when present. */
    description?: string;
    version?: string;
    kind: PackageKind;
    /** Frameworks detected on this package's own deps. */
    frameworks: string[];
    private?: boolean;
}

export interface ReadmeInfo {
    present: boolean;
    title: string;
    description: string;
    sections: string[];
    wordCount: number;
}

export interface FrameworkVersion {
    name: string;
    version: string;
}

export interface StackInfo {
    primaryLanguage: string;
    languages: LanguageStat[];
    frontend: string[];
    backend: string[];
    runtimes: string[];
    buildTools: string[];
    packageManager: string | null;
    /** Curated frameworks with their resolved/declared versions (React 19, ...). */
    notableFrameworks: FrameworkVersion[];
}

export interface AiTooling {
    /** MCP server names declared in .mcp.json / .cursor/mcp.json. */
    mcpServers: string[];
    /** AI SDK package names found in dependencies. */
    aiSdks: string[];
    /** Eval / tracing frameworks found (langsmith, promptfoo, ...). */
    evalFrameworks: string[];
    /** Agent / assistant config files present (.claude, AGENTS.md, ...). */
    agentConfigs: string[];
}

export interface CicdInfo {
    hasCi: boolean;
    provider: string | null;
    workflows: string[];
}

export interface InventoryInfo {
    hasTests: boolean;
    hasEvals: boolean;
    hasDocs: boolean;
    hasReleaseChecklists: boolean;
    docsCount: number;
    hasDockerfile: boolean;
    hasLockfile: boolean;
    hasLicense: boolean;
    hasGitignore: boolean;
}

export type ActivityLevel = 'active' | 'slowing' | 'dormant' | 'abandoned' | 'unknown';

export interface Contributor {
    name: string;
    commits: number;
    share: number;
}

export interface GitInfo {
    isRepo: boolean;
    branch: string | null;
    commitCount: number;
    contributors: number;
    lastCommitIso: string | null;
    firstCommitIso: string | null;
    commitsLast90d: number;
    cadencePerWeek: number;
    activity: ActivityLevel;
    /** Min authors whose cumulative share >= 50%. 1 = bus-factor risk. */
    busFactor: number;
    topContributors: Contributor[];
    hotFiles: { path: string; changes: number; commits: number }[];
}

export type HealthSeverity = 'good' | 'info' | 'warn' | 'risk';

export interface HealthSignal {
    id: string;
    label: string;
    severity: HealthSeverity;
    detail: string;
}

export interface HealthSummary {
    /** 0..100 weighted rollup; the Overview reads this as a vital. */
    score: number;
    signals: HealthSignal[];
}

export interface CodeRatios {
    sourceLoc: number;
    testLoc: number;
    docsLoc: number;
    configFiles: number;
    /** test LOC / source LOC, 0..n. */
    testToSource: number;
    /** doc LOC / source LOC, 0..n. */
    docsToSource: number;
}

export interface ProjectMetrics {
    fileCount: number;
    totalBytes: number;
    totalLoc: number;
    sizeLabel: string;
    /** Files actually inventoried; equals fileCount unless the walk truncated. */
    truncated: boolean;
    ratios: CodeRatios;
}

export interface ProjectIdentity {
    name: string;
    /** Display title, prettified from the repo/dir name. */
    title: string;
    description: string;
    root: string;
    license: string;
    /** GitHub (or other) remote slug from package.json repository, when present. */
    repositoryUrl?: string;
    homepage?: string;
    keywords: string[];
    version?: string;
    private?: boolean;
}

// --- Tier-2 deterministic detail signals (the `detail` group) --------------

export interface RunCommand {
    group: 'run' | 'build' | 'test' | 'quality' | 'deploy' | 'data' | 'other';
    name: string;
    cmd: string;
    pkg: string;
}

export interface DataLayer {
    orm: string[];
    engines: string[];
}

export interface TestingInfo {
    frameworks: string[];
    linters: string[];
    formatters: string[];
    typecheck: string[];
}

export interface Hotspot {
    path: string;
    loc: number;
    /** total line-changes over the window, from git hot files. */
    churn: number;
    /** how many internal packages depend on it. */
    dependedOnBy: number;
    /** loc-normalized risk score, higher = riskier. */
    score: number;
}

export interface ReadingStep {
    path: string;
    /** deterministic reason: entry / most-depended-upon / frequently-changed / largest. */
    reason: string;
}

export interface ContainerInfo {
    dockerfiles: { path: string; baseImages: string[]; ports: number[] }[];
    composeServices: { name: string; image: string; ports: string[]; dependsOn: string[] }[];
}

export interface WorkflowDetail {
    file: string;
    triggers: string[];
    jobs: string[];
    needs: { job: string; on: string[] }[];
    deploys: string[];
}

export interface EnvGroup {
    prefix: string;
    names: string[];
    clientExposed: boolean;
}

export interface ReleaseInfo {
    latestTag: string | null;
    tagCount: number;
    hasChangelog: boolean;
}

export interface ProjectDetail {
    commands: RunCommand[];
    dataLayer: DataLayer;
    testing: TestingInfo;
    apiStyle: string[];
    /** "read these first" - deterministic, AI refines the rationale. */
    readingOrder: ReadingStep[];
    /** risk-ranked modules - deterministic, available with no AI. */
    hotspots: Hotspot[];
    containers: ContainerInfo;
    workflows: WorkflowDetail[];
    envGroups: EnvGroup[];
    /** count of TODO/FIXME/HACK/XXX markers across source. */
    todoCount: number;
    release: ReleaseInfo;
}

/** AI-enriched layer. Null until a provider is connected and enrichment runs. */
export interface ProjectIntel {
    /** Plain-English "what this project is about" (domain/audience/purpose). */
    narrative: string;
    /** One-line elevator summary. */
    tagline: string;
    /** Semantic systems diagram; every path validated against the real tree. */
    systemDiagram: SystemDiagram | null;
    /** Prioritized suggestions ("connect Sentry", "add tests", ...). */
    suggestions: { title: string; detail: string; priority: 'high' | 'medium' | 'low' }[];
    /** One plain-English line per real package (path validated). */
    packageNotes: { path: string; oneLiner: string }[];
    /** "what a senior would fix day one", each citing a real path. */
    changeFirst: { title: string; rationale: string; evidencePath: string }[];
    /** A getting-started guide synthesized from the real run commands. */
    runGuide: string;
    model: string;
    generatedAt: string;
}

export interface SystemNode {
    id: string;
    label: string;
    kind: string;
    /** Real repo-relative paths this system maps to (validated). */
    paths: string[];
    summary: string;
}

export interface SystemEdge {
    source: string;
    target: string;
    label: string;
}

export interface SystemDiagram {
    nodes: SystemNode[];
    edges: SystemEdge[];
}

export interface ProjectProfile {
    identity: ProjectIdentity;
    stack: StackInfo;
    shape: ProjectShape;
    packages: PackageInfo[];
    metrics: ProjectMetrics;
    readme: ReadmeInfo;
    services: DetectedService[];
    aiTooling: AiTooling;
    cicd: CicdInfo;
    inventory: InventoryInfo;
    git: GitInfo;
    health: HealthSummary;
    detail: ProjectDetail;
    depGraph: DependencyGraph;
    ai: ProjectIntel | null;
    generatedAt: string;
    signature: string;
    durationMs: number;
}
