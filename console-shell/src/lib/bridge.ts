// console-shell/src/lib/bridge.ts
//
// Typed renderer-side surface for window.refringenceConsole.
// MUST stay in lock-step with console-electron/src/preload/preload.ts.

export type GateStatus = 'green' | 'amber' | 'red' | 'blocked';

export interface ReleaseGate {
    id: string;
    label: string;
    artifact: string;
    status: GateStatus;
    notes?: string;
    blocker?: string;
}

export interface ReleaseChecklist {
    version: string;
    status: 'in-progress' | 'shipped' | 'cancelled';
    target_date: string;
    release_manager: string;
    gates: ReleaseGate[];
}

export interface ReleaseSummary {
    version: string;
    overall_status: GateStatus;
    green: number;
    amber: number;
    red: number;
    blocked: number;
    gate_count: number;
}

export type DocCategory =
    | 'plan' | 'onboarding' | 'runbook' | 'adr' | 'reference'
    | 'compliance' | 'testing' | 'operations' | 'unknown';

export interface DocEntry {
    path: string;
    title: string;
    category: DocCategory;
    audience?: 'human' | 'agent' | 'both';
    last_reviewed?: string;
    sizeBytes: number;
    mtimeMs: number;
}

export interface PromptfooResultRow {
    testId: string;
    description?: string;
    success: boolean;
    latencyMs?: number;
    costUsd?: number;
    score?: number;
    error?: string;
}

export interface EvalRunResult {
    ok: boolean;
    experimentName?: string;
    url?: string;
    total?: number;
    passed?: number;
    error?: string;
}

export interface PromptfooSummary {
    timestamp?: string;
    total: number;
    passed: number;
    failed: number;
    errors: number;
    totalCostUsd?: number;
    durationMs?: number;
    results: PromptfooResultRow[];
}

export interface VersionInfo {
    name: string;
    version: string;
    electron: string;
    node: string;
}

export interface RepoFileEntry {
    path: string;
    language: string;
    sizeBytes: number;
    loc: number;
    mtimeMs: number;
}

export interface RepoPackageEntry {
    name: string;
    path: string;
    file_count: number;
    total_loc: number;
    total_bytes: number;
    languages: Record<string, number>;
    sample_files: RepoFileEntry[];
}

export interface RepoSummary {
    repo_root: string;
    total_packages: number;
    total_files: number;
    total_loc: number;
    packages: RepoPackageEntry[];
}

export interface MetricsSummary {
    timestamp: string;
    ci: {
        configured: boolean;
        status: 'passing' | 'failing' | 'running' | 'none';
        conclusion: string | null;
        workflow: string | null;
        ranAt: string | null;
    };
    sbom: {
        present: boolean;
        components: number;
        spec_version: string | null;
        size_bytes: number;
    };
    promptfoo: {
        present: boolean;
        last_run: string | null;
        passed: number;
        failed: number;
        errors: number;
    };
    qa_runs: {
        count: number;
        latest_run_id: string | null;
    };
    cost_today_usd: number;
    cycle_log: {
        commits_landed: number;
        cycles_completed: number;
    };
}

export interface RunEntry {
    runId: string;
    startedAt: string;
    artifactKinds: string[];
    totalFiles: number;
    totalBytes: number;
}

export interface ObsCounters {
    runs: number;
    runs_last_24h: number;
    errors: number;
    errors_last_24h: number;
}

export interface RunArtifactFile {
    relPath: string;
    kind: string;
    sizeBytes: number;
}

export interface RunDetail {
    runId: string;
    files: RunArtifactFile[];
    status: 'ok' | 'failed' | 'unknown';
    statusSource: 'manifest' | 'heuristic';
}

export interface IssueLabel {
    name: string;
    color: string;
    description?: string;
}

export interface IssueRow {
    number: number;
    title: string;
    state: 'open' | 'closed';
    url: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
    assignees: string[];
    labels: IssueLabel[];
    milestone?: { title: string; number: number };
    commentCount: number;
    body?: string;
}

export interface IssueFetchHealth {
    ghAvailable: boolean;
    ghVersion: string | null;
    repo: string;
    authStatus: 'ok' | 'no-auth' | 'unknown';
    error?: string;
}

export interface IssueListOptions {
    repo?: string;
    /** The picked project's root; the repo is derived from its git remote. */
    projectRoot?: string;
    state?: 'open' | 'closed' | 'all';
    limit?: number;
    label?: string;
}

export interface IssueComment {
    author: string;
    body: string;
    createdAt: string;
}

export interface IssueDetail extends IssueRow {
    body: string;
    comments: IssueComment[];
}

// Q3-batch-2 IPC contracts (pipeline / ollama / repo-introspect).
// Each interface mirrors the IPC handler's return shape verbatim.

export interface PipelineJob {
    id: string;
    name: string;
    runs_on: string;
    needs: string[];
    steps_count: number;
}

export interface PipelineWorkflow {
    name: string;
    path: string;
    triggers: string[];
    jobs: PipelineJob[];
}

export interface PipelineDetect {
    project_root: string;
    workflows: PipelineWorkflow[];
    vercelDetected: boolean;
    netlifyDetected: boolean;
}

export interface WorkflowRun {
    workflowName: string;
    status: string;
    conclusion: string | null;
    createdAt: string;
    displayTitle: string;
    databaseId: number;
    headBranch: string;
}

export interface PipelineRuns {
    available: boolean;
    reason?: string;
    latestByWorkflow: Record<string, WorkflowRun>;
}

export interface OllamaStatus {
    running: boolean;
    version?: string;
    models?: string[];
}

export interface ProjectSummary {
    name: string;
    description: string;
    license: string;
    languages: Record<string, number>;
    runCommands: string[];
}

export interface HotFile {
    path: string;
    changes: number;
    commits: number;
}

export interface ReadingEntry {
    path: string;
    score: number;
}

export interface ProjectShape {
    projectType: string;
    primaryLanguage: string;
    entryPoint?: string;
    startCommand?: string;
    isMonorepo: boolean;
    packageCount: number;
    runnable: boolean;
    workspaceTool?: string | null;
    workspaceGlobs?: string[];
}

export interface ProjectCapabilities {
    hasGitRepo: boolean;
    hasCiWorkflows: boolean;
    hasTests: boolean;
    hasEvals: boolean;
    hasReleaseChecklists: boolean;
    hasServicesConfig: boolean;
    hasDocs: boolean;
    hasEnvFiles: boolean;
    workflowDir?: string;
    docsDir?: string;
}

export type ProjectStack = 'node' | 'python' | 'rust' | 'go' | 'mixed' | 'unknown';

export interface StackDetectDetails {
    hasPackageJson: boolean;
    hasPyproject: boolean;
    hasCargo: boolean;
    hasGoMod: boolean;
    hasDockerfile: boolean;
    hasWorkflows: boolean;
}

export interface StackDetect {
    stacks: ProjectStack[];
    primary: string;
    details: StackDetectDetails;
}

export interface PickFolderResult {
    canceled: boolean;
    path?: string;
}

export interface LibraryEntry {
    path: string;
    relPath: string;
    ext: string;
    size: number;
    mtimeMs: number;
    category: 'docs' | 'config' | 'data' | 'workflow' | 'license' | 'readme' | 'changelog' | 'other';
}

export interface LibraryFile {
    content: string;
    mime: string;
    truncated: boolean;
}

export interface ActivityCommit {
    hash: string;
    subject: string;
    author: string;
    relativeTime: string;
    isoTime: string;
}

// Phase 3 deploy-wedge connection contracts. Metadata only on the
// renderer side — tokens never cross the bridge.

export interface GithubConnectionMeta {
    connected: boolean;
    login?: string;
    connectedAt?: string;
}

export interface VercelConnectionMeta {
    connected: boolean;
    user?: string;
    connectedAt?: string;
}

export interface SentryConnectionMeta {
    connected: boolean;
    user?: string;
    org?: string;
    connectedAt?: string;
}

export type SlackTeam = 'tech' | 'nontech' | 'test';

export interface SlackConnectionMeta {
    connected: boolean;
    team?: string;
    user?: string;
    connectedAt?: string;
    channelTeams?: Record<string, SlackTeam>;
}

export interface ConnectionMeta {
    github: GithubConnectionMeta;
    vercel: VercelConnectionMeta;
    sentry: SentryConnectionMeta;
    slack: SlackConnectionMeta;
}

// ── connector platform (generic usage-dashboard layer) ──────────────────
export interface ConnectorExtraField {
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
}

export interface ConnectorCatalogEntry {
    id: string;
    name: string;
    category: string;
    blurb: string;
    tokenSource: 'connector' | 'connections';
    tokenLabel: string;
    tokenPlaceholder: string;
    howToGet?: string;
    extraFields: ConnectorExtraField[];
    hasUsage: boolean;
    manageUrl?: string;
}

export interface ConnectorStatus {
    id: string;
    connected: boolean;
    account?: string;
    connectedAt?: string;
}

export interface ConnectorUsageMetric {
    label: string;
    value: string;
    sub?: string;
    tone?: 'default' | 'good' | 'warn' | 'bad';
}

export interface ConnectorUsageReport {
    ok: boolean;
    metrics?: ConnectorUsageMetric[];
    asOf?: string;
    note?: string;
    manageUrl?: string;
    error?: string;
}

export interface SlackChannel {
    id: string;
    name: string;
    isPrivate: boolean;
    team: SlackTeam | null;
}

// Normalized to a gh-issue-like shape so the Workboard can reuse its card.
export interface SlackIssue {
    id: string;
    title: string;
    team: SlackTeam;
    channel: string;
    user: string;
    ts: string;
    permalink: string;
    severity?: string;
}

export interface SentryIssue {
    id: string;
    title: string;
    culprit: string;
    level: string;
    count: number;
    lastSeen: string;
    permalink: string;
}

export interface VercelProject {
    id: string;
    name: string;
    framework: string | null;
}

export interface VercelDetectedSettings {
    framework: string | null;
    buildCommand: string | null;
    outputDirectory: string | null;
    installCommand: string | null;
    hasPackageJson: boolean;
    hasBuildScript: boolean;
    isStatic: boolean;
    suggestedName: string;
}

export interface VercelDeploySettings {
    name: string;
    framework: string | null;
    buildCommand: string | null;
    outputDirectory: string | null;
    installCommand: string | null;
    target: 'production' | 'preview';
}

export interface VercelDeployResult {
    id: string;
    url: string;
    inspectorUrl: string;
    state: string;
}

export interface VercelDeployment {
    id: string;
    name: string;
    url: string;
    state: string;
    createdAt: number | null;
    target: string | null;
}

export interface EnvFileNames {
    file: string;
    names: string[];
}

export interface EnvLocalNames {
    files: EnvFileNames[];
    allNames: string[];
}

// A service Console can connect straight from the project's .env. NAME only -
// the value is read transiently main-side at connect time, never returned.
export interface EnvConnectable {
    id: string;
    name: string;
    category: string;
    keyName: string;
}

// Hardcoded secrets found in source/config. preview is REDACTED; the full
// secret never crosses the bridge.
export interface SecretFinding { file: string; line: number; type: string; preview: string }
export interface SecretScan {
    scanned: number;
    findings: SecretFinding[];
    truncated: boolean;
    scannedAt: string;
}

// Project hygiene: presence of the files a healthy repo carries.
export interface HygieneItem { id: string; label: string; present: boolean; detail?: string; suggestion?: string }
export interface HygieneReport { items: HygieneItem[]; score: number; scannedAt: string }

// Agent skill from the curated library, installable into the open project's
// .claude/skills (or .codex/skills).
export type SkillTool = 'claude' | 'codex';
export interface SkillMeta {
    id: string;
    name: string;
    description: string;
    tags: string[];
}

// Dependency health: known vulnerabilities (OSV.dev) + newer releases (npm).
export interface VulnerableDep { name: string; version: string; vulns: { id: string }[] }
export interface OutdatedDep { name: string; current: string; latest: string }
export interface DepScan {
    ecosystem: 'npm';
    total: number;
    checked: number;
    vulnerable: VulnerableDep[];
    outdated: OutdatedDep[];
    scannedAt: string;
    error?: string;
}

// Phase 1b streaming process runner. The renderer never sends a shell
// string: it picks a `kind` that maps main-side to a resolved binary.

export type RunnerKind = 'npm' | 'gh' | 'playwright' | 'node';

export interface RunnerStartOpts {
    kind: RunnerKind;
    args: string[];
    cwd?: string;
    label?: string;
    timeoutMs?: number;
}

export interface RunnerOutput {
    runId: string;
    line: string;
    stream: 'stdout' | 'stderr';
    ts: number;
}

export interface RunnerComplete {
    runId: string;
    exitCode: number | null;
    durationMs: number;
    killed: boolean;
}

// Live architecture dependency graph (Phase 2a). Mirrors the IPC handler
// shapes in console-electron/src/main/ipc/architecture-graph.ts verbatim.

export type ArchTier = 'shell' | 'presentation' | 'domain' | 'data' | 'infra' | 'test' | 'external';

export interface DependencyNode {
    id: string;
    label: string;
    tier: ArchTier;
    loc: number;
    fileCount: number;
    /** True for external-dependency nodes (only present when includeExternal). */
    external?: boolean;
}

export interface DependencyEdge {
    source: string;
    target: string;
    weight: number;
}

export interface DependencyGraph {
    nodes: DependencyNode[];
    edges: DependencyEdge[];
    cycles: string[][];
    /** True when the walk hit a depth/file cap; the renderer shows a banner. */
    truncated: boolean;
    /** Files actually walked (the cap when truncated). */
    fileCount: number;
}

export interface ArchGraphOptions {
    includeExternal: boolean;
    // Opt-in: off keeps the graph to JS/TS imports only (the clean default);
    // on also runs the Python/Rust/Go/Java/Kotlin extractors.
    allLanguages: boolean;
}

export interface ArchOverlay {
    positions: Record<string, { x: number; y: number }>;
    tierOverrides: Record<string, string>;
    notes: Record<string, string>;
    hidden: string[];
}

// Phase P4 multi-provider AI. The renderer only ever sees provider ids,
// model options, and boolean key status; raw keys stay in the main process.

export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'kimi';

export type AiChatRole = 'system' | 'user' | 'assistant';

export interface AiChatMessage {
    role: AiChatRole;
    content: string;
}

export interface AiModelOption {
    id: string;
    label: string;
    provider: AiProviderId;
    context?: number;
    /** One-line capability note shown under the model in the picker. */
    description?: string;
}

export interface AiProviderInfo {
    id: AiProviderId;
    name: string;
    hasCredentials: boolean;
}

export interface AiChatStartOpts {
    model: string;
    messages: AiChatMessage[];
    system?: string;
    /** When set, the assistant gets read-only tools + context for this project. */
    projectRoot?: string;
}

export interface AiChatDelta {
    chatId: string;
    delta: string;
}

export interface AiChatToolCall {
    chatId: string;
    id: string;
    name: string;
    input: unknown;
}

export interface AiChatToolResult {
    chatId: string;
    id: string;
    name: string;
    output: unknown;
}

export interface AiChatDone {
    chatId: string;
}

export interface AiChatError {
    chatId: string;
    error: string;
}

// Phase P5 prompt library + dev-tool router. Prompts live per-project at
// <projectRoot>/.refringence-console/prompts.json; the router writes the
// drafted prompt into the dev tool's own entry file or runs `claude`.

export type PromptVariableType = 'text' | 'multiline' | 'select';

export interface PromptVariable {
    name: string;
    type: PromptVariableType;
    label: string;
    options?: string[];
    default?: string;
}

export interface PromptEntry {
    id: string;
    title: string;
    body: string;
    variables: PromptVariable[];
    category: string;
    tags: string[];
    favorite: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface PromptInput {
    title: string;
    body: string;
    variables?: PromptVariable[];
    category?: string;
    tags?: string[];
    favorite?: boolean;
}

export type DevToolWriteMode = 'replace' | 'append';

export interface DevToolDetect {
    cursor: boolean;
    claudeCli: boolean;
    windsurf: boolean;
}

export interface DevToolWriteResult {
    ok: boolean;
    path?: string;
    error?: string;
}

export interface ClaudeRunResult {
    ok: boolean;
    runId?: string;
    error?: string;
}

export interface ClaudeOutput {
    runId: string;
    line: string;
    stream: 'stdout' | 'stderr';
    ts: number;
}

export interface ClaudeComplete {
    runId: string;
    exitCode: number | null;
    durationMs: number;
}

// Phase P6 project guideline file. Generated markdown lands in a managed
// block in AGENTS.md or .cursorrules via the same writers the router uses.

export type GuidelineTarget = 'agents-md' | 'cursorrules';

export interface GuidelineStatus {
    agentsMd: boolean;
    cursorRules: boolean;
}

// Project Intelligence Engine. The deterministic profiler (no AI) fills
// everything except `ai`; AI enrichment fills `ai` when a provider is
// connected. Mirrors console-electron/src/main/intel/types.ts. Env handling
// carries key NAMES only, never values.

export type IntelServiceCategory =
    | 'repo' | 'hosting-frontend' | 'hosting-backend' | 'database'
    | 'observability' | 'analytics' | 'payment' | 'queue'
    | 'ai-model' | 'comms' | 'search' | 'auth' | 'email' | 'cdn';

export type IntelServiceConfidence = 'high' | 'medium';
export type IntelServiceEvidence = 'env' | 'dep' | 'config' | 'mcp';

export interface DetectedService {
    id: string;
    name: string;
    category: IntelServiceCategory;
    confidence: IntelServiceConfidence;
    via: IntelServiceEvidence[];
    evidence: string[];
    powers: string | null;
    pricing: string;
    docsUrl: string;
}

export interface LanguageStat {
    language: string;
    files: number;
    loc: number;
    bytes: number;
    share: number;
}

export type PackageKind = 'app' | 'lib' | 'tooling' | 'test' | 'docs' | 'unknown';

export interface IntelPackageInfo {
    name: string;
    relPath: string;
    role: string;
    loc: number;
    fileCount: number;
    description?: string;
    version?: string;
    kind: PackageKind;
    frameworks: string[];
    private?: boolean;
}

export interface FrameworkVersion {
    name: string;
    version: string;
}

export type ActivityLevel = 'active' | 'slowing' | 'dormant' | 'abandoned' | 'unknown';

export interface Contributor {
    name: string;
    commits: number;
    share: number;
}

export interface CodeRatios {
    sourceLoc: number;
    testLoc: number;
    docsLoc: number;
    configFiles: number;
    testToSource: number;
    docsToSource: number;
}

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
    churn: number;
    dependedOnBy: number;
    score: number;
}

export interface ReadingStep {
    path: string;
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
    readingOrder: ReadingStep[];
    hotspots: Hotspot[];
    containers: ContainerInfo;
    workflows: WorkflowDetail[];
    envGroups: EnvGroup[];
    todoCount: number;
    release: ReleaseInfo;
}

export interface ReadmeInfo {
    present: boolean;
    title: string;
    description: string;
    sections: string[];
    wordCount: number;
}

export interface StackInfo {
    primaryLanguage: string;
    languages: LanguageStat[];
    frontend: string[];
    backend: string[];
    runtimes: string[];
    buildTools: string[];
    packageManager: string | null;
    notableFrameworks: FrameworkVersion[];
}

export interface AiTooling {
    mcpServers: string[];
    aiSdks: string[];
    evalFrameworks: string[];
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
    score: number;
    signals: HealthSignal[];
}

export interface ProjectMetrics {
    fileCount: number;
    totalBytes: number;
    totalLoc: number;
    sizeLabel: string;
    truncated: boolean;
    ratios: CodeRatios;
}

export interface ProjectIdentity {
    name: string;
    title: string;
    description: string;
    root: string;
    license: string;
    repositoryUrl?: string;
    homepage?: string;
    keywords: string[];
    version?: string;
    private?: boolean;
}

export interface SystemNode {
    id: string;
    label: string;
    kind: string;
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

export interface ProjectIntel {
    narrative: string;
    tagline: string;
    systemDiagram: SystemDiagram | null;
    suggestions: { title: string; detail: string; priority: 'high' | 'medium' | 'low' }[];
    packageNotes: { path: string; oneLiner: string }[];
    changeFirst: { title: string; rationale: string; evidencePath: string }[];
    runGuide: string;
    model: string;
    generatedAt: string;
}

export interface ProjectProfile {
    identity: ProjectIdentity;
    stack: StackInfo;
    shape: ProjectShape;
    packages: IntelPackageInfo[];
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

export interface IntelMountStep {
    mountId: string;
    phase: 'init' | 'step';
    steps?: { id: string; label: string }[];
    current: string | null;
    label?: string;
}

export interface IntelMountProfile {
    mountId: string;
    profile: ProjectProfile;
    cached: boolean;
}

export interface IntelMountDone {
    mountId: string;
    ok: boolean;
    profile: ProjectProfile | null;
    error?: string;
}

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'not-available'
    | 'downloaded'
    | 'error';

export interface UpdateEvent {
    status: UpdateStatus;
    version?: string;
    percent?: number;
    message?: string;
}

export interface ConsoleBridge {
    getVersion(): Promise<VersionInfo>;
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<{ ok: boolean; error?: string }>;
    notify(title: string, body: string): Promise<void>;
    window: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<boolean>;
        close(): Promise<void>;
        isMaximized(): Promise<boolean>;
        newWindow(): Promise<void>;
        setTitle(title: string): Promise<void>;
        // Grow the OS window by `extraWidth` px (clamped to the work area) so
        // a newly-opened right dock fits without squishing content. Resolves
        // with the width actually added (0 if already at the work-area edge).
        growForDock(extraWidth: number): Promise<number>;
        onMaximizeChange(cb: (isMax: boolean) => void): () => void;
    };
    release: {
        list(root: string): Promise<{ version: string; status: string }[]>;
        get(root: string): Promise<ReleaseChecklist | null>;
        summary(root: string): Promise<ReleaseSummary | null>;
    };
    docs: {
        list(root: string): Promise<DocEntry[]>;
        read(root: string, relPath: string): Promise<string | null>;
    };
    evals: {
        promptfooSummary(root: string): Promise<PromptfooSummary | null>;
        health(root: string): Promise<{ promptfooOutputPresent: boolean; promptfooOutputPath: string }>;
        langsmithStatus(): Promise<{ connected: boolean }>;
        setLangsmithKey(key: string): Promise<{ ok: boolean; valid?: boolean; error?: string }>;
        clearLangsmithKey(): Promise<{ ok: boolean }>;
        run(): Promise<EvalRunResult>;
    };
    repo: {
        summary(root: string): Promise<RepoSummary>;
    };
    arch: {
        graph(projectRoot: string, options?: ArchGraphOptions): Promise<DependencyGraph>;
        recompute(projectRoot: string, options?: ArchGraphOptions): Promise<DependencyGraph>;
        overlayRead(projectRoot: string): Promise<ArchOverlay | null>;
        overlayWrite(projectRoot: string, overlay: ArchOverlay): Promise<{ ok: boolean; error?: string }>;
    };
    metrics: {
        summary(root: string): Promise<MetricsSummary>;
    };
    obs: {
        runs(root: string): Promise<RunEntry[]>;
        counters(root: string): Promise<ObsCounters>;
        runDetail(root: string, runId: string): Promise<RunDetail>;
    };
    issues: {
        health(): Promise<IssueFetchHealth>;
        list(opts?: IssueListOptions): Promise<IssueRow[]>;
        detail(num: number, projectRoot?: string): Promise<IssueDetail | null>;
        relabel(opts: { number: number; addLabels?: string[]; removeLabels?: string[]; repo?: string; projectRoot?: string }): Promise<{ ok: boolean; error?: string }>;
    };
    pipeline: {
        detect(projectRoot: string): Promise<PipelineDetect>;
        runs(projectRoot: string): Promise<PipelineRuns>;
    };
    ollama: {
        detect(): Promise<OllamaStatus>;
        generate(opts: { model: string; prompt: string }): Promise<{ text: string }>;
    };
    repoIntrospect: {
        summary(projectRoot: string): Promise<ProjectSummary>;
        hotFiles(projectRoot: string, sinceDays?: number): Promise<HotFile[]>;
        readingOrder(projectRoot: string): Promise<ReadingEntry[]>;
        shape(projectRoot: string): Promise<ProjectShape>;
        capabilities(projectRoot: string): Promise<ProjectCapabilities>;
    };
    project: {
        pickFolder(): Promise<PickFolderResult>;
        detectStack(root: string): Promise<StackDetect>;
    };
    library: {
        list(projectRoot: string): Promise<LibraryEntry[]>;
        read(projectRoot: string, relPath: string): Promise<LibraryFile>;
    };
    activity: {
        recentCommits(root: string, limit?: number): Promise<ActivityCommit[]>;
    };
    runner: {
        start(opts: RunnerStartOpts): Promise<{ runId: string }>;
        stop(runId: string): Promise<void>;
        onOutput(cb: (e: RunnerOutput) => void): () => void;
        onComplete(cb: (e: RunnerComplete) => void): () => void;
    };
    update: {
        check(): Promise<{ ok: boolean; reason?: string }>;
        install(): Promise<void>;
        onEvent(cb: (e: UpdateEvent) => void): () => void;
    };
    deps: {
        scan(projectRoot: string): Promise<DepScan>;
    };
    secrets: {
        scan(projectRoot: string): Promise<SecretScan>;
    };
    hygiene: {
        scan(projectRoot: string): Promise<HygieneReport>;
    };
    skills: {
        list(): Promise<SkillMeta[]>;
        installed(projectRoot: string, tool: SkillTool): Promise<string[]>;
        install(projectRoot: string, id: string, tool: SkillTool): Promise<{ ok: boolean; path?: string; error?: string }>;
    };
    env: {
        localNames(projectRoot: string): Promise<EnvLocalNames>;
        scanConnectable(projectRoot: string): Promise<EnvConnectable[]>;
        connect(projectRoot: string, serviceId: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
    };
    connections: {
        list(): Promise<ConnectionMeta>;
        github: {
            connect(): Promise<{ ok: boolean; login?: string; error?: string }>;
            disconnect(): Promise<{ ok: boolean; error?: string }>;
        };
        vercel: {
            connect(token: string): Promise<{ ok: boolean; user?: string; error?: string }>;
            disconnect(): Promise<{ ok: boolean; error?: string }>;
            projects(): Promise<{ ok: boolean; projects?: VercelProject[]; error?: string }>;
            deployments(projectId?: string): Promise<{ ok: boolean; deployments?: VercelDeployment[]; error?: string }>;
            redeploy(projectId: string, deploymentId: string): Promise<{ ok: boolean; deployment?: { id: string; url: string; state: string }; error?: string }>;
            detectDeploy(projectRoot: string): Promise<{ ok: boolean; settings?: VercelDetectedSettings; error?: string }>;
            deploy(projectRoot: string, settings: VercelDeploySettings): Promise<{ ok: boolean; deployment?: VercelDeployResult; error?: string }>;
            deployState(id: string): Promise<{ ok: boolean; state?: string; url?: string; error?: string }>;
        };
        sentry: {
            connect(token: string, org: string): Promise<{ ok: boolean; user?: string; org?: string; error?: string }>;
            disconnect(): Promise<{ ok: boolean; error?: string }>;
            issues(): Promise<{ ok: boolean; issues?: SentryIssue[]; error?: string }>;
        };
        slack: {
            connect(token: string): Promise<{ ok: boolean; team?: string; user?: string; error?: string }>;
            disconnect(): Promise<{ ok: boolean; error?: string }>;
        };
    };
    connectors: {
        catalog(): Promise<ConnectorCatalogEntry[]>;
        status(): Promise<ConnectorStatus[]>;
        connect(id: string, token: string, extra?: Record<string, string>): Promise<{ ok: boolean; account?: string; error?: string }>;
        disconnect(id: string): Promise<{ ok: boolean; error?: string }>;
        usage(id: string): Promise<ConnectorUsageReport>;
    };
    slack: {
        channels(): Promise<{ ok: boolean; channels?: SlackChannel[]; error?: string }>;
        setChannelTeam(channelId: string, team: string): Promise<{ ok: boolean; error?: string }>;
        issues(): Promise<{ ok: boolean; issues?: SlackIssue[]; error?: string }>;
    };
    guidelines: {
        generate(): Promise<{ ok: boolean; content?: string; error?: string }>;
        write(root: string, target: GuidelineTarget): Promise<DevToolWriteResult>;
        status(root?: string): Promise<GuidelineStatus>;
    };
    ai: {
        providers(): Promise<AiProviderInfo[]>;
        listModels(): Promise<AiModelOption[]>;
        availableModels(): Promise<AiModelOption[]>;
        getKeyStatus(): Promise<Record<string, boolean>>;
        setKey(id: AiProviderId, key: string): Promise<{ ok: boolean; valid?: boolean; error?: string }>;
        clearKey(id: AiProviderId): Promise<{ ok: boolean }>;
        chat: {
            start(opts: AiChatStartOpts): Promise<{ chatId: string }>;
            cancel(chatId: string): Promise<void>;
            onDelta(cb: (e: AiChatDelta) => void): () => void;
            onToolCall(cb: (e: AiChatToolCall) => void): () => void;
            onToolResult(cb: (e: AiChatToolResult) => void): () => void;
            onDone(cb: (e: AiChatDone) => void): () => void;
            onError(cb: (e: AiChatError) => void): () => void;
        };
    };
    prompts: {
        list(projectRoot: string): Promise<{ ok: boolean; entries?: PromptEntry[]; error?: string }>;
        get(projectRoot: string, id: string): Promise<{ ok: boolean; entry?: PromptEntry; error?: string }>;
        create(projectRoot: string, input: PromptInput): Promise<{ ok: boolean; entry?: PromptEntry; error?: string }>;
        update(projectRoot: string, id: string, input: Partial<PromptInput>): Promise<{ ok: boolean; entry?: PromptEntry; error?: string }>;
        delete(projectRoot: string, id: string): Promise<{ ok: boolean; error?: string }>;
        toggleFavorite(projectRoot: string, id: string): Promise<{ ok: boolean; entry?: PromptEntry; error?: string }>;
    };
    devhandoff: {
        detect(): Promise<DevToolDetect>;
        writeCursorRules(root: string, content: string, mode?: DevToolWriteMode): Promise<DevToolWriteResult>;
        writeAgentsMd(root: string, content: string, mode?: DevToolWriteMode): Promise<DevToolWriteResult>;
        runClaude(opts: { prompt: string; cwd?: string }): Promise<ClaudeRunResult>;
        openInCursor(root?: string): Promise<DevToolWriteResult>;
        onClaudeOutput(cb: (e: ClaudeOutput) => void): () => void;
        onClaudeComplete(cb: (e: ClaudeComplete) => void): () => void;
    };
    intel: {
        profile(projectRoot: string, opts?: { force?: boolean }): Promise<ProjectProfile | null>;
        mountStart(projectRoot: string): Promise<{ mountId: string; ok: boolean }>;
        enrich(projectRoot: string, opts?: { model?: string }): Promise<{ ok: boolean; intel?: ProjectIntel; error?: string }>;
        onMountStep(cb: (e: IntelMountStep) => void): () => void;
        onMountProfile(cb: (e: IntelMountProfile) => void): () => void;
        onMountDone(cb: (e: IntelMountDone) => void): () => void;
    };
}

declare global {
    interface Window {
        refringenceConsole: ConsoleBridge;
    }
}

const stub = (): never => { throw new Error('Console bridge not wired'); };

export const bridge: ConsoleBridge =
    typeof window !== 'undefined' && window.refringenceConsole
        ? window.refringenceConsole
        : ({
              getVersion: stub,
              openExternal: stub,
              openPath: stub,
              notify: stub,
              window: {
                  minimize: stub,
                  toggleMaximize: stub,
                  close: stub,
                  isMaximized: stub,
                  newWindow: stub,
                  setTitle: stub,
                  growForDock: stub,
                  onMaximizeChange: () => () => {},
              },
              release: { list: stub, get: stub, summary: stub },
              docs: { list: stub, read: stub },
              evals: { promptfooSummary: stub, health: stub, langsmithStatus: stub, setLangsmithKey: stub, clearLangsmithKey: stub, run: stub },
              repo: { summary: stub },
              arch: { graph: stub, recompute: stub, overlayRead: stub, overlayWrite: stub },
              metrics: { summary: stub },
              obs: { runs: stub, counters: stub, runDetail: stub },
              issues: { health: stub, list: stub, detail: stub, relabel: stub },
              pipeline: { detect: stub, runs: stub },
              ollama: { detect: stub, generate: stub },
              repoIntrospect: { summary: stub, hotFiles: stub, readingOrder: stub, shape: stub, capabilities: stub },
              project: { pickFolder: stub, detectStack: stub },
              library: { list: stub, read: stub },
              activity: { recentCommits: stub },
              runner: { start: stub, stop: stub, onOutput: () => () => {}, onComplete: () => () => {} },
              update: { check: stub, install: stub, onEvent: () => () => {} },
              deps: { scan: stub },
              secrets: { scan: stub },
              hygiene: { scan: stub },
              skills: { list: stub, installed: stub, install: stub },
              env: { localNames: stub, scanConnectable: stub, connect: stub },
              connections: {
                  list: stub,
                  github: { connect: stub, disconnect: stub },
                  vercel: { connect: stub, disconnect: stub, projects: stub, deployments: stub, redeploy: stub, detectDeploy: stub, deploy: stub, deployState: stub },
                  sentry: { connect: stub, disconnect: stub, issues: stub },
                  slack: { connect: stub, disconnect: stub },
              },
              connectors: { catalog: stub, status: stub, connect: stub, disconnect: stub, usage: stub },
              slack: { channels: stub, setChannelTeam: stub, issues: stub },
              guidelines: { generate: stub, write: stub, status: stub },
              ai: {
                  providers: stub,
                  listModels: stub,
                  availableModels: stub,
                  getKeyStatus: stub,
                  setKey: stub,
                  clearKey: stub,
                  chat: {
                      start: stub,
                      cancel: stub,
                      onDelta: () => () => {},
                      onToolCall: () => () => {},
                      onToolResult: () => () => {},
                      onDone: () => () => {},
                      onError: () => () => {},
                  },
              },
              prompts: {
                  list: stub,
                  get: stub,
                  create: stub,
                  update: stub,
                  delete: stub,
                  toggleFavorite: stub,
              },
              devhandoff: {
                  detect: stub,
                  writeCursorRules: stub,
                  writeAgentsMd: stub,
                  runClaude: stub,
                  openInCursor: stub,
                  onClaudeOutput: () => () => {},
                  onClaudeComplete: () => () => {},
              },
              intel: {
                  profile: stub,
                  mountStart: stub,
                  enrich: stub,
                  onMountStep: () => () => {},
                  onMountProfile: () => () => {},
                  onMountDone: () => () => {},
              },
          } as unknown as ConsoleBridge);
