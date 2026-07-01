// console-electron/src/main/ipc/index.ts
//
// Wires up all Console IPC handlers. Called from main.ts after
// app.whenReady() so handlers register before the renderer first calls.
//
// Pattern: each handler module lives in its own file under
// src/main/ipc/<panel>.ts and exports a registerXHandlers() function.
// Adding a new IPC channel: add the typed method to bridge.ts in
// console-shell, add the preload wrapper, register here.
import { registerReleaseHandlers } from './release';
import { registerDocsHandlers } from './docs';
import { registerEvalsHandlers } from './evals';
import { registerVersionHandlers } from './version';
import { registerRepoHandlers } from './repo';
import { registerMetricsHandlers } from './metrics';
import { registerObservabilityHandlers } from './observability';
import { registerIssuesHandlers } from './issues';
import { registerPipelineHandlers } from './pipeline';
import { registerOllamaHandlers } from './ollama';
import { registerRepoIntrospectHandlers } from './repo-introspect';
import { registerProjectHandlers } from './project';
import { registerLibraryHandlers } from './library';
import { registerActivityHandlers } from './activity';
import { registerConnectionsHandlers } from './connections';
import { registerConnectorsHandlers } from './connectors';
import { registerEnvHandlers } from './env';
import { registerDepsHandlers } from './deps';
import { registerSecretsHandlers } from './secrets';
import { registerSkillsHandlers } from './skills';
import { registerHygieneHandlers } from './hygiene';
import { registerGenerateHandlers } from './generate';
import { registerDoraHandlers } from './dora';
import { registerDbSaturationHandlers } from './db-saturation';
import { registerSbomHandlers } from './sbom';
import { registerSetupHandlers } from './setup';
import { registerSpendAttributionHandlers } from './spend-attribution';
import { registerPiiScanHandlers } from './pii-scan';
import { registerMigrationDriftHandlers } from './migration-drift';
import { registerEnvDiffHandlers } from './env-diff';
import { registerLicenseCheckHandlers } from './license-check';
import { registerAiConfigHandlers } from './ai-config';
import { registerDeadConfigHandlers } from './dead-config';
import { registerEcnHandlers } from './ecn';
import { registerPrLinkHandlers } from './pr-link';
import { registerFsWatchHandlers } from './fs-watch';
import { registerGroundHandlers } from './ground';
import { registerNotifyHandlers } from './notify';
import { registerWindowHandlers } from './window';
import { registerRunnerHandlers } from './runner';
import { registerArchGraphHandlers } from './architecture-graph';
import { registerAiHandlers } from './ai';
import { registerPromptsHandlers } from './prompts';
import { registerDevSessionsHandlers } from './devsessions';
import { registerDevHandoffHandlers } from './devhandoff';
import { registerSlackHandlers } from './slack';
import { registerGuidelinesHandlers } from './guidelines';
import { registerIntelHandlers } from './intel';
import { registerUpdateHandlers } from './update';
import { registerDevtoolsConfigHandlers } from './devtools-config';
import { registerDesignSystemHandlers } from './design-system';
import { registerChecksHandlers } from './checks';

export function registerAllConsoleIpc(): void {
    registerVersionHandlers();
    registerReleaseHandlers();
    registerDocsHandlers();
    registerEvalsHandlers();
    registerRepoHandlers();
    registerMetricsHandlers();
    registerObservabilityHandlers();
    registerIssuesHandlers();
    registerPipelineHandlers();
    registerOllamaHandlers();
    registerRepoIntrospectHandlers();
    registerProjectHandlers();
    registerLibraryHandlers();
    registerActivityHandlers();
    registerConnectionsHandlers();
    registerConnectorsHandlers();
    registerEnvHandlers();
    registerDepsHandlers();
    registerSecretsHandlers();
    registerSkillsHandlers();
    registerHygieneHandlers();
    registerGenerateHandlers();
    registerDoraHandlers();
    registerDbSaturationHandlers();
    registerSbomHandlers();
    registerSetupHandlers();
    registerSpendAttributionHandlers();
    registerPiiScanHandlers();
    registerMigrationDriftHandlers();
    registerEnvDiffHandlers();
    registerLicenseCheckHandlers();
    registerAiConfigHandlers();
    registerDeadConfigHandlers();
    registerEcnHandlers();
    registerPrLinkHandlers();
    registerFsWatchHandlers();
    registerGroundHandlers();
    registerNotifyHandlers();
    registerWindowHandlers();
    registerRunnerHandlers();
    registerArchGraphHandlers();
    registerAiHandlers();
    registerPromptsHandlers();
    registerDevSessionsHandlers();
    registerDevHandoffHandlers();
    registerSlackHandlers();
    registerGuidelinesHandlers();
    registerIntelHandlers();
    registerUpdateHandlers();
    registerDevtoolsConfigHandlers();
    registerDesignSystemHandlers();
    registerChecksHandlers();
}
