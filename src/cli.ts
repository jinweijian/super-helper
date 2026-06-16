#!/usr/bin/env node

import { join } from 'node:path';
import { runDoctorCommand, runServerCommand, runStatusCommand } from './cli/index.js';
import { configPath, defaultConfig, ensureConfig, saveConfig, type SuperHelperConfig } from './config.js';
import {
  createEmbeddingProvider,
  formatEmbeddingSafeError,
  runEmbeddingSmokeTest,
  runRerankSmokeTest,
  type EmbeddingProviderConfig,
  type RerankProviderConfig,
} from './embedding/index.js';
import { startServer } from './server.js';
import {
  applyKnowledgeRepairPlan,
  auditKnowledgeQuality,
  buildKnowledgeVectorIndex,
  buildDraftSlices,
  defaultSourceDirectory,
  evaluateQualityGate,
  extractSourceBlocks,
  generateKnowledgeRepairPlan,
  initKnowledgeWorkspace,
  loadSourceDocuments,
  normalizeSourceBlocks,
  publishApprovedDraftSlices,
  readKnowledgeRepairPlan,
  readSourceBlocks,
  resolveKnowledgeWorkspaceRoot,
  reviewDraftSlices,
  runKnowledgeEval,
  searchKnowledge,
  updateKnowledgeIndex,
  updateKnowledgeIndexWithQuality,
  writeKnowledgeQualityReport,
  writeKnowledgeRepairPlan,
  writeSourceQualityReport,
} from './knowledge/index.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'dashboard';
  const argv = process.argv.slice(3);

  if (command === 'onboard' || command === 'dashboard') {
    await runServerCommand({ mode: command, argv });
    return;
  }

  if (command === 'status') {
    await runStatusCommand({ argv });
    return;
  }

  if (command === 'doctor') {
    const result = await runDoctorCommand({ argv });
    if (!result.ok) {
      process.exit(1);
    }
    return;
  }

  if (command === 'init') {
    const path = configPath();
    const config = ensureConfig();
    saveConfig(config);
    console.log(`super helper config ready at ${path}`);
    return;
  }

  if (command === 'knowledge') {
    await handleKnowledgeCommand();
    return;
  }

  if (command === 'embedding') {
    await handleEmbeddingCommand();
    return;
  }

  if (command === 'rerank') {
    await handleRerankCommand();
    return;
  }

  if (command === 'accept') {
    await handleAcceptCommand();
    return;
  }

  if (command === 'model' && process.argv[3] === 'set') {
    const name = process.argv[4] ?? 'default';
    const baseUrl = readArg('--base-url');
    const model = readArg('--model');
    const apiKey = readArg('--api-key');
    const apiKeyEnv = readArg('--api-key-env');
    if (!baseUrl || !model || (!apiKey && !apiKeyEnv)) {
      console.error('Usage: super-helper model set <name> --base-url <url> --model <model> (--api-key-env <env> | --api-key <key>)');
      process.exit(1);
    }

    const config = ensureConfig();
    config.models.providers[name] = {
      type: 'openai-compatible',
      baseUrl,
      model,
      apiKey,
      apiKeyEnv,
      temperature: 0,
    };
    config.agent.modelProvider = name;
    config.agent.useModelForPreflight = true;
    saveConfig(config);
    console.log(`agent model provider "${name}" configured`);
    return;
  }

  if (command === 'workspace' && process.argv[3] === 'set') {
    const rootPath = readArg('--path');
    if (!rootPath) {
      console.error('Usage: super-helper workspace set --path <project-path> [--name <name>]');
      process.exit(1);
    }

    const config = ensureConfig();
    config.workspaces[0] = {
      id: 'current',
      name: readArg('--name') ?? 'Current Project',
      rootPath,
      mcpToolIds: config.workspaces[0]?.mcpToolIds ?? [],
    };
    saveConfig(config);
    console.log(`workspace configured: ${rootPath}`);
    return;
  }

  if (command === 'mcp' && process.argv[3] === 'add') {
    const id = process.argv[4];
    const protocol = readArg('--protocol') as 'stdio' | 'http' | 'sse' | undefined;
    if (!id || !protocol || !['stdio', 'http', 'sse'].includes(protocol)) {
      console.error('Usage: super-helper mcp add <id> --protocol <stdio|http|sse> [--name <name>] [--permission read_only|read_write] [--config-json <json>]');
      process.exit(1);
    }

    const config = ensureConfig();
    const tool = {
      id,
      name: readArg('--name') ?? id,
      protocol,
      permission: (readArg('--permission') as 'read_only' | 'read_write' | undefined) ?? 'read_only',
      enabled: true,
      config: readJsonArg('--config-json'),
    };
    config.mcpTools = config.mcpTools.filter((item) => item.id !== id).concat(tool);
    config.workspaces[0] = {
      ...config.workspaces[0],
      mcpToolIds: Array.from(new Set([...(config.workspaces[0]?.mcpToolIds ?? []), id])),
    };
    saveConfig(config);
    console.log(`MCP tool configured: ${id}`);
    return;
  }

  if (command === 'dev' || command === 'serve') {
    const config = ensureConfig();
    const portArg = readArg('--port');
    if (portArg) {
      config.server.port = Number(portArg);
    }
    const hostArg = readArg('--host');
    if (hostArg) {
      config.server.host = hostArg;
    }
    const workspaceArg = readArg('--workspace');
    if (workspaceArg) {
      config.workspaces[0] = {
        ...config.workspaces[0],
        id: 'current',
        name: 'Current Project',
        rootPath: workspaceArg,
      };
    }

    const server = await startServer({ config });
    console.log(`super helper running at ${server.url}`);
    console.log(`config: ${configPath()}`);
    console.log('Press Ctrl+C to stop.');

    const stop = async (): Promise<void> => {
      await server.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
    await new Promise<void>(() => undefined);
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

async function handleKnowledgeCommand(): Promise<void> {
  const subcommand = process.argv[3];
  const context = resolveKnowledgeCommandContext();
  const projectWorkspaceRoot = context.projectWorkspaceRoot;
  const workspaceRoot = context.knowledgeWorkspaceRoot;

  if (subcommand === 'vector' && process.argv[4] === 'build') {
    const embedding = embeddingConfigFromFlags(context.config.embedding);
    if (!embedding.enabled) {
      console.log('embedding disabled');
      console.log(`provider: ${embedding.provider}`);
      console.log(`model: ${embedding.model}`);
      process.exit(1);
    }
    try {
      const provider = createEmbeddingProvider(embedding);
      const result = await buildKnowledgeVectorIndex({ workspaceRoot, provider, config: embedding });
      console.log('knowledge vector index built');
      console.log(`workspace: ${projectWorkspaceRoot}`);
      console.log(`knowledge workspace: ${workspaceRoot}`);
      console.log(`provider: ${result.provider}`);
      console.log(`model: ${result.model}`);
      console.log(`dimensions: ${result.dimensions}`);
      console.log(`distance: ${result.distance}`);
      console.log(`vectors: ${result.vectorCount}`);
      console.log(`skipped: ${result.skipped.length}`);
      console.log(`failed: ${result.failures.length}`);
      console.log(`vectors path: ${result.vectorsPath}`);
      console.log(`manifest: ${result.manifestPath}`);
      return;
    } catch (error) {
      console.error(formatEmbeddingSafeError(error));
      process.exit(1);
    }
  }

  if (subcommand === 'init') {
    const sourceDir = readArg('--source-dir') ?? readArg('--source') ?? defaultSourceDirectory();
    const gate = readQualityGateArg('warn');
    const legacyActivePublish = process.argv.includes('--legacy-active-publish');
    const result = initKnowledgeWorkspace({
      workspaceRoot,
      sourceDir,
      force: process.argv.includes('--force'),
      legacyActivePublish,
      qualityGate: gate,
    });
    console.log('knowledge workspace ready');
    console.log(`workspace: ${projectWorkspaceRoot}`);
    console.log(`knowledge workspace: ${workspaceRoot}`);
    console.log(`knowledge: ${result.knowledgeRoot}`);
    if (sourceDir) {
      console.log(`source dir: ${sourceDir}`);
    }
    console.log(`directories created: ${result.directories.length}`);
    console.log(`files written: ${result.files.length}`);
    if (result.ingestReportPath) {
      console.log(`ingest report: ${result.ingestReportPath}`);
    }
    if (legacyActivePublish) {
      console.log('warning: legacy active publish enabled; normal review/publish gate was bypassed.');
    }
    printQualitySummary(result);
    if (result.qualityGateResult && !result.qualityGateResult.passed) {
      console.error(`gate failed: ${result.qualityGateResult.reason}`);
      process.exit(result.qualityGateResult.exitCode);
    }
    console.log('next: super-helper knowledge update --workspace <workspace> [--knowledge-root <path>]');
    return;
  }

  if (subcommand === 'update') {
    const gate = readQualityGateArg('warn');
    const result = gate === 'off'
      ? updateKnowledgeIndexWithQuality({ workspaceRoot, qualityGate: 'off' })
      : updateKnowledgeIndexWithQuality({ workspaceRoot, qualityGate: gate });
    console.log('knowledge index updated');
    console.log(`workspace: ${projectWorkspaceRoot}`);
    console.log(`knowledge workspace: ${workspaceRoot}`);
    console.log(`knowledge: ${result.knowledgeRoot}`);
    console.log(`documents: ${result.documentCount}`);
    console.log(`chunks: ${result.chunkCount}`);
    console.log(`source documents: ${result.sourceDocumentCount}`);
    console.log(`manifest: ${result.manifestPath}`);
    console.log(`chunks path: ${result.chunksPath}`);
    printQualitySummary(result);
    if (result.qualityGateResult && !result.qualityGateResult.passed) {
      console.error(`gate failed: ${result.qualityGateResult.reason}`);
      process.exit(result.qualityGateResult.exitCode);
    }
    return;
  }

  if (subcommand === 'search') {
    const query = readArg('--query') ?? process.argv[4];
    if (!query) {
      console.error('Usage: super-helper knowledge search --query <question> [--workspace <path>] [--limit <n>]');
      process.exit(1);
    }
    const limit = Number(readArg('--limit') ?? '5');
    const result = searchKnowledge({ workspaceRoot, query, limit: Number.isFinite(limit) ? limit : 5 });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'extract') {
    const sourceId = readArg('--source-id');
    const sources = sourceId ? [sourceId] : loadSourceDocuments(workspaceRoot).map((s) => s.id);
    let totalBlocks = 0;
    for (const id of sources) {
      const sourceMeta = loadSourceDocuments(workspaceRoot).find((s) => s.id === id);
      if (!sourceMeta?.path) continue;
      const absolutePath = resolveSourcePath(workspaceRoot, sourceMeta.path);
      const { report } = extractSourceBlocks({ workspaceRoot, sourceDocumentId: id, sourcePath: absolutePath });
      console.log(`extracted: ${id} -> ${Object.values(report.blockCounts).reduce((a, b) => a + b, 0)} blocks (parser=${report.parserStrategy})`);
      totalBlocks += Object.values(report.blockCounts).reduce((a, b) => a + b, 0);
    }
    console.log(`total blocks: ${totalBlocks}`);
    return;
  }

  if (subcommand === 'normalize') {
    const sourceId = readArg('--source-id');
    const sources = sourceId ? [sourceId] : loadSourceDocuments(workspaceRoot).map((s) => s.id);
    let totalBlocks = 0;
    for (const id of sources) {
      const blocks = readSourceBlocks(workspaceRoot, id);
      if (blocks.length === 0) {
        console.log(`normalized: ${id} skipped (no extracted blocks)`);
        continue;
      }
      const { report } = normalizeSourceBlocks({ workspaceRoot, sourceDocumentId: id, blocks });
      console.log(`normalized: ${id} -> ${report.outputBlockCount} blocks`);
      totalBlocks += report.outputBlockCount;
    }
    console.log(`total normalized blocks: ${totalBlocks}`);
    console.log('next: super-helper knowledge slice --workspace <workspace> [--knowledge-root <path>]');
    return;
  }

  if (subcommand === 'slice') {
    const sources = loadSourceDocuments(workspaceRoot);
    for (const source of sources) {
      if (!source.path) continue;
      const absolutePath = resolveSourcePath(workspaceRoot, source.path);
      const { blocks: extractedBlocks } = extractSourceBlocks({ workspaceRoot, sourceDocumentId: source.id, sourcePath: absolutePath });
      const { blocks: normalized } = normalizeSourceBlocks({ workspaceRoot, sourceDocumentId: source.id, blocks: extractedBlocks });
      const report = buildDraftSlices({ workspaceRoot, sourceDocumentId: source.id, sourceTitle: source.title, sourceKind: source.source_kind ?? 'whitepaper', sourceDocumentPath: source.path, normalizedBlocks: normalized });
      console.log(`sliced: ${source.id} -> ${report.draftIds.length} draft slices`);
    }
    return;
  }

  if (subcommand === 'audit') {
    const gate = readQualityGateArg('warn');
    if (gate === 'off') {
      console.log('quality audit skipped (gate=off)');
      return;
    }
    const report = auditKnowledgeQuality({ workspaceRoot, gate });
    const path = writeKnowledgeQualityReport({ workspaceRoot, report });
    const sourcePath = writeSourceQualityReport({ workspaceRoot, report });
    const gateResult = evaluateQualityGate(report, gate);
    console.log(`quality report: ${path}`);
    console.log(`source quality report: ${sourcePath}`);
    console.log(`severity: error=${report.severityCounts.error} warn=${report.severityCounts.warn} info=${report.severityCounts.info}`);
    console.log(`top issues: ${Object.entries(report.issueCounts).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (!gateResult.passed) {
      console.error(`gate failed: ${gateResult.reason}`);
      process.exit(gateResult.exitCode);
    }
    return;
  }

  if (subcommand === 'repair') {
    if (process.argv.includes('--plan')) {
      const plan = generateKnowledgeRepairPlan({ workspaceRoot });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = writeKnowledgeRepairPlan({ workspaceRoot, plan, timestamp });
      console.log(`repair plan: ${path}`);
      console.log(`actions: total=${plan.summary.total} safe=${plan.summary.safe} review_required=${plan.summary.reviewRequired}`);
      return;
    }
    const planPath = readArg('--apply');
    if (!planPath) {
      console.error('Usage: super-helper knowledge repair --plan | --apply <plan-path>');
      process.exit(1);
    }
    const plan = readKnowledgeRepairPlan(planPath);
    if (!plan) {
      console.error(`repair plan not found or malformed: ${planPath}`);
      process.exit(1);
    }
    const result = applyKnowledgeRepairPlan({ workspaceRoot, planPath });
    console.log(`repair applied: ${result.appliedActions.length} applied, ${result.skippedActions.length} skipped`);
    if (result.changedFiles.length > 0) {
      console.log(`changed files: ${result.changedFiles.length}`);
    }
    return;
  }

  if (subcommand === 'review') {
    const action = (readArg('--action') ?? process.argv[4]) as 'approve' | 'reject' | 'request_edits' | 'accept_warnings';
    const reviewer = readArg('--reviewer') ?? 'local-user';
    const notes = readArg('--notes') ?? '';
    const sourceId = readArg('--source-id');
    if (!sourceId || !['approve', 'reject', 'request_edits', 'accept_warnings'].includes(action)) {
      console.error('Usage: super-helper knowledge review --source-id <id> --action <approve|reject|request_edits|accept_warnings> --reviewer <name> [--notes <text>]');
      process.exit(1);
    }
    const record = reviewDraftSlices({ workspaceRoot, sourceDocumentId: sourceId, action, reviewer, notes });
    console.log(`review ${record.action}: ${record.reviewedIds.length} slices, reviewer=${record.reviewer}`);
    return;
  }

  if (subcommand === 'publish') {
    const gate = readQualityGateArg('warn');
    const sourceId = readArg('--source-id');
    const report = publishApprovedDraftSlices({ workspaceRoot, sourceDocumentId: sourceId, qualityGate: gate });
    console.log(`publish: ${report.publishedIds.length} published, ${report.rejectedIds.length} rejected, dirty=${report.indexDirty}`);
    if (report.qualityReportPath) {
      console.log(`quality report used: ${report.qualityReportPath}`);
    }
    return;
  }

  if (subcommand === 'eval') {
    const questionsPath = readArg('--questions');
    if (!questionsPath) {
      console.error('Usage: super-helper knowledge eval --questions <file> [--workspace <path>]');
      process.exit(1);
    }
    const report = runKnowledgeEval({ workspaceRoot, questionsPath });
    console.log(`eval: ${report.questionCount} questions, hit@1=${report.hitAt1}, hit@3=${report.hitAt3}, hit@5=${report.hitAt5}, answerBearingRate=${report.answerBearingRate.toFixed(2)}, falsePositives=${report.falsePositiveCount}`);
    if (report.failures.length > 0) {
      console.log(`failures: ${report.failures.length}`);
      process.exit(2);
    }
    return;
  }

  console.error('Usage: super-helper knowledge <init|update|search|extract|normalize|slice|audit|repair|review|publish|eval|vector build> [--workspace <path>] [--knowledge-root <path>]');
  process.exit(1);
}

async function handleEmbeddingCommand(): Promise<void> {
  const subcommand = process.argv[3];
  if (subcommand !== 'test') {
    console.error('Usage: super-helper embedding test [--enable] [--provider siliconflow|fake] [--model <model>] [--dimensions <n>] [--api-key-env <env>] [--base-url <url>]');
    process.exit(1);
  }

  const config = ensureConfig(readArg('--home'));
  const embedding = embeddingConfigFromFlags(config.embedding);
  const result = await runEmbeddingSmokeTest({ config: embedding, force: process.argv.includes('--enable') });
  if (!result.ok && result.error?.code === 'disabled') {
    console.log('embedding disabled');
    console.log(`provider: ${result.provider}`);
    console.log(`model: ${result.model}`);
    return;
  }
  console.log(result.ok ? 'embedding model ok' : 'embedding model failed');
  console.log(`provider: ${result.provider}`);
  console.log(`model: ${result.model}`);
  console.log(`dimensions: ${result.dimensions}`);
  console.log(`durationMs: ${result.durationMs}`);
  if (result.error) {
    console.log(`error: ${result.error.code} ${result.error.safeMessage}`);
  }
  if (!result.ok) {
    process.exit(1);
  }
}

async function handleRerankCommand(): Promise<void> {
  const subcommand = process.argv[3];
  if (subcommand !== 'test') {
    console.error('Usage: super-helper rerank test [--enable] [--provider siliconflow] [--model <model>] [--api-key-env <env>] [--base-url <url>]');
    process.exit(1);
  }

  const config = ensureConfig(readArg('--home'));
  const rerank = rerankConfigFromFlags(config.rerank);
  const result = await runRerankSmokeTest({ config: rerank, force: process.argv.includes('--enable') });
  if (!result.ok && result.error?.code === 'disabled') {
    console.log('rerank disabled');
    console.log(`provider: ${result.provider}`);
    console.log(`model: ${result.model}`);
    return;
  }
  console.log(result.ok ? 'rerank model ok' : 'rerank model failed');
  console.log(`provider: ${result.provider}`);
  console.log(`model: ${result.model}`);
  console.log(`durationMs: ${result.durationMs}`);
  if (result.topScore !== undefined) {
    console.log(`top score: ${result.topScore}`);
  }
  if (result.error) {
    console.log(`error: ${result.error.code} ${result.error.safeMessage}`);
  }
  if (!result.ok) {
    process.exit(1);
  }
}

function resolveKnowledgeCommandContext(): {
  config: SuperHelperConfig;
  projectWorkspaceRoot: string;
  knowledgeWorkspaceRoot: string;
} {
  const explicit = readArg('--workspace') ?? readArg('--path');
  const explicitKnowledgeRoot = readArg('--knowledge-root');
  const config = explicit && explicitKnowledgeRoot ? defaultConfig() : ensureConfig();

  if (explicit) {
    config.workspaces[0] = {
      ...config.workspaces[0],
      id: config.workspaces[0]?.id ?? 'current',
      name: config.workspaces[0]?.name ?? 'Current Project',
      rootPath: explicit,
    };
  }
  if (explicitKnowledgeRoot) {
    // When the user passes --knowledge-root explicitly, treat it as the absolute knowledge root
    // and disable per-workspace isolation so the CLI does not nest under workspaces/<key>/.
    config.knowledge.rootDir = explicitKnowledgeRoot;
    config.knowledge.isolateByWorkspace = false;
  }

  return {
    config,
    projectWorkspaceRoot: config.workspaces[0]?.rootPath ?? process.cwd(),
    knowledgeWorkspaceRoot: resolveKnowledgeWorkspaceRoot(config, config.workspaces[0]?.id),
  };
}

function resolveSourcePath(workspaceRoot: string, relativeOrAbsolute: string): string {
  // If it's an absolute path, return it; otherwise resolve against the knowledge workspace root.
  if (relativeOrAbsolute.startsWith('/')) {
    return relativeOrAbsolute;
  }
  return join(workspaceRoot, relativeOrAbsolute);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function readQualityGateArg(defaultGate: 'warn' | 'strict' | 'off'): 'warn' | 'strict' | 'off' {
  const value = readArg('--quality-gate') ?? defaultGate;
  if (value !== 'warn' && value !== 'strict' && value !== 'off') {
    console.error('Invalid --quality-gate. Expected warn|strict|off.');
    process.exit(1);
  }
  return value;
}

function embeddingConfigFromFlags(existing: EmbeddingProviderConfig): EmbeddingProviderConfig {
  return {
    ...existing,
    enabled: process.argv.includes('--enable') || existing.enabled,
    provider: readArg('--provider') ?? existing.provider,
    model: readArg('--model') ?? existing.model,
    baseUrl: readArg('--base-url') ?? existing.baseUrl,
    endpoint: readArg('--endpoint') ?? existing.endpoint,
    apiKeyEnv: readArg('--api-key-env') ?? existing.apiKeyEnv,
    dimensions: optionalPositiveInteger(readArg('--dimensions')) ?? existing.dimensions,
    distance: readArg('--distance') ?? existing.distance,
    batchSize: optionalPositiveInteger(readArg('--batch-size')) ?? existing.batchSize,
    timeoutMs: optionalPositiveInteger(readArg('--timeout-ms')) ?? existing.timeoutMs,
  };
}

function rerankConfigFromFlags(existing: RerankProviderConfig): RerankProviderConfig {
  return {
    ...existing,
    enabled: process.argv.includes('--enable') || existing.enabled,
    provider: readArg('--provider') ?? existing.provider,
    model: readArg('--model') ?? existing.model,
    baseUrl: readArg('--base-url') ?? existing.baseUrl,
    endpoint: readArg('--endpoint') ?? existing.endpoint,
    apiKeyEnv: readArg('--api-key-env') ?? existing.apiKeyEnv,
    timeoutMs: optionalPositiveInteger(readArg('--timeout-ms')) ?? existing.timeoutMs,
    topN: optionalPositiveInteger(readArg('--top-n')) ?? existing.topN,
  };
}

function optionalPositiveInteger(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function printQualitySummary(result: {
  qualityReportPath?: string;
  sourceQualityReportPath?: string;
  qualityGateResult?: { passed: boolean; reason?: string };
  qualitySeverityCounts?: Record<string, number>;
  qualityIssueCounts?: Record<string, number>;
}): void {
  if (result.qualityGateResult?.reason === 'quality gate disabled') {
    console.log('quality audit skipped (gate=off)');
    return;
  }
  if (result.qualityReportPath) {
    console.log(`quality report: ${result.qualityReportPath}`);
  }
  if (result.sourceQualityReportPath) {
    console.log(`source quality report: ${result.sourceQualityReportPath}`);
  }
  if (result.qualitySeverityCounts) {
    console.log(`severity: error=${result.qualitySeverityCounts.error ?? 0} warn=${result.qualitySeverityCounts.warn ?? 0} info=${result.qualitySeverityCounts.info ?? 0}`);
  }
  if (result.qualityIssueCounts) {
    const topIssues = Object.entries(result.qualityIssueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code, count]) => `${code}=${count}`)
      .join(', ');
    if (topIssues) {
      console.log(`top issues: ${topIssues}`);
    }
  }
}

async function handleAcceptCommand(): Promise<void> {
  const subcommand = process.argv[3];
  if (subcommand !== 'knowledge') {
    console.error('Usage: super-helper accept knowledge --workspace <path> [--knowledge-root <path>] [--mock-worker|--real-worker] [--report-dir <path>]');
    process.exit(1);
  }

  const projectWorkspaceRoot = readArg('--workspace') ?? process.cwd();
  const explicitKnowledgeRoot = readArg('--knowledge-root');
  const config = explicitKnowledgeRoot ? defaultConfig() : ensureConfig();
  if (explicitKnowledgeRoot) {
    config.knowledge.rootDir = explicitKnowledgeRoot;
    config.knowledge.isolateByWorkspace = false;
  }
  config.workspaces[0] = {
    ...config.workspaces[0],
    id: config.workspaces[0]?.id ?? 'current',
    name: config.workspaces[0]?.name ?? 'Current Project',
    rootPath: projectWorkspaceRoot,
    mcpToolIds: config.workspaces[0]?.mcpToolIds ?? [],
  };
  const knowledgeWorkspaceRoot = resolveKnowledgeWorkspaceRoot(config, config.workspaces[0]?.id);
  const reportDir = readArg('--report-dir') ?? join(knowledgeWorkspaceRoot, 'reports');
  const timeoutMs = Number(readArg('--timeout-ms') ?? config.claude.timeoutMs ?? 5000);
  const realWorker = process.argv.includes('--real-worker');
  const mockWorker = process.argv.includes('--mock-worker') || !realWorker;
  const keepCases = process.argv.includes('--keep-cases');
  const redact = !process.argv.includes('--no-redact');

  const { runKnowledgeAcceptance } = await import('./runtime/knowledge-acceptance.js');
  const result = runKnowledgeAcceptance({
    config,
    projectWorkspaceRoot,
    knowledgeWorkspaceRoot,
    reportDir,
    mockWorker,
    realWorker,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
    redact,
    keepCases,
  });

  console.log(`acceptance report: ${result.reportPath}`);
  console.log(`overall: ${result.report.overallPassed ? 'passed' : 'failed'}`);
  for (const scenario of result.report.scenarios) {
    console.log(`  ${scenario.passed ? 'PASS' : 'FAIL'} ${scenario.id}: ${scenario.reason}`);
  }
  if (!result.report.overallPassed) {
    process.exit(2);
  }
}

function readJsonArg(name: string): unknown {
  const value = readArg(name);
  if (!value) {
    return undefined;
  }

  return JSON.parse(value);
}

function printUsage(): void {
  console.error('Usage: super-helper [dashboard|onboard|status|doctor|init|dev|knowledge <init|update|search|extract|normalize|slice|audit|repair|review|publish|eval|vector build>|embedding test|rerank test|model set|workspace set|mcp add]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
