import { join } from 'node:path';
import { defaultConfig, ensureConfig, type SuperHelperConfig } from '../config.js';
import {
  createEmbeddingProvider,
  formatEmbeddingSafeError,
  type EmbeddingProviderConfig,
} from '../embedding/index.js';
import {
  applyKnowledgeRepairPlan,
  auditKnowledgeQuality,
  buildDraftSlices,
  buildKnowledgeVectorIndex,
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
  updateKnowledgeIndexWithQuality,
  writeKnowledgeQualityReport,
  writeKnowledgeRepairPlan,
  writeSourceQualityReport,
} from '../knowledge/index.js';
import { hasFlag, readOption } from './args.js';

type QualityGateArg = 'warn' | 'strict' | 'off';

export async function runKnowledgeCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  const context = resolveKnowledgeCommandContext(argv);
  const projectWorkspaceRoot = context.projectWorkspaceRoot;
  const workspaceRoot = context.knowledgeWorkspaceRoot;

  if (subcommand === 'vector' && argv[1] === 'build') {
    const embedding = embeddingConfigFromFlags(context.config.embedding, argv);
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
    const sourceDir = readOption(argv, '--source-dir') ?? readOption(argv, '--source') ?? defaultSourceDirectory();
    const gate = readQualityGateArg(argv, 'warn');
    const legacyActivePublish = hasFlag(argv, '--legacy-active-publish');
    const result = initKnowledgeWorkspace({
      workspaceRoot,
      sourceDir,
      force: hasFlag(argv, '--force'),
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
    const gate = readQualityGateArg(argv, 'warn');
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
    const query = readOption(argv, '--query') ?? argv[1];
    if (!query) {
      console.error('Usage: super-helper knowledge search --query <question> [--workspace <path>] [--limit <n>]');
      process.exit(1);
    }
    const limit = Number(readOption(argv, '--limit') ?? '5');
    const result = searchKnowledge({ workspaceRoot, query, limit: Number.isFinite(limit) ? limit : 5 });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'extract') {
    const sourceId = readOption(argv, '--source-id');
    const sourceDocuments = loadSourceDocuments(workspaceRoot);
    const sources = sourceId ? [sourceId] : sourceDocuments.map((source) => source.id);
    let totalBlocks = 0;
    for (const id of sources) {
      const sourceMeta = sourceDocuments.find((source) => source.id === id);
      if (!sourceMeta?.path) continue;
      const absolutePath = resolveSourcePath(workspaceRoot, sourceMeta.path);
      const { report } = extractSourceBlocks({ workspaceRoot, sourceDocumentId: id, sourcePath: absolutePath });
      const blockCount = Object.values(report.blockCounts).reduce((total, count) => total + count, 0);
      console.log(`extracted: ${id} -> ${blockCount} blocks (parser=${report.parserStrategy})`);
      totalBlocks += blockCount;
    }
    console.log(`total blocks: ${totalBlocks}`);
    return;
  }

  if (subcommand === 'normalize') {
    const sourceId = readOption(argv, '--source-id');
    const sourceDocuments = loadSourceDocuments(workspaceRoot);
    const sources = sourceId ? [sourceId] : sourceDocuments.map((source) => source.id);
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
      const { blocks: extractedBlocks } = extractSourceBlocks({
        workspaceRoot,
        sourceDocumentId: source.id,
        sourcePath: absolutePath,
      });
      const { blocks: normalized } = normalizeSourceBlocks({
        workspaceRoot,
        sourceDocumentId: source.id,
        blocks: extractedBlocks,
      });
      const report = buildDraftSlices({
        workspaceRoot,
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourceKind: source.source_kind ?? 'whitepaper',
        sourceDocumentPath: source.path,
        normalizedBlocks: normalized,
      });
      console.log(`sliced: ${source.id} -> ${report.draftIds.length} draft slices`);
    }
    return;
  }

  if (subcommand === 'audit') {
    const gate = readQualityGateArg(argv, 'warn');
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
    console.log(`top issues: ${Object.entries(report.issueCounts).slice(0, 5).map(([code, count]) => `${code}=${count}`).join(', ')}`);
    if (!gateResult.passed) {
      console.error(`gate failed: ${gateResult.reason}`);
      process.exit(gateResult.exitCode);
    }
    return;
  }

  if (subcommand === 'repair') {
    if (hasFlag(argv, '--plan')) {
      const plan = generateKnowledgeRepairPlan({ workspaceRoot });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = writeKnowledgeRepairPlan({ workspaceRoot, plan, timestamp });
      console.log(`repair plan: ${path}`);
      console.log(`actions: total=${plan.summary.total} safe=${plan.summary.safe} review_required=${plan.summary.reviewRequired}`);
      return;
    }
    const planPath = readOption(argv, '--apply');
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
    const action = (readOption(argv, '--action') ?? argv[1]) as 'approve' | 'reject' | 'request_edits' | 'accept_warnings';
    const reviewer = readOption(argv, '--reviewer') ?? 'local-user';
    const notes = readOption(argv, '--notes') ?? '';
    const sourceId = readOption(argv, '--source-id');
    if (!sourceId || !['approve', 'reject', 'request_edits', 'accept_warnings'].includes(action)) {
      console.error('Usage: super-helper knowledge review --source-id <id> --action <approve|reject|request_edits|accept_warnings> --reviewer <name> [--notes <text>]');
      process.exit(1);
    }
    const record = reviewDraftSlices({ workspaceRoot, sourceDocumentId: sourceId, action, reviewer, notes });
    console.log(`review ${record.action}: ${record.reviewedIds.length} slices, reviewer=${record.reviewer}`);
    return;
  }

  if (subcommand === 'publish') {
    const gate = readQualityGateArg(argv, 'warn');
    const sourceId = readOption(argv, '--source-id');
    const report = publishApprovedDraftSlices({ workspaceRoot, sourceDocumentId: sourceId, qualityGate: gate });
    console.log(`publish: ${report.publishedIds.length} published, ${report.rejectedIds.length} rejected, dirty=${report.indexDirty}`);
    if (report.qualityReportPath) {
      console.log(`quality report used: ${report.qualityReportPath}`);
    }
    return;
  }

  if (subcommand === 'eval') {
    const questionsPath = readOption(argv, '--questions');
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

function resolveKnowledgeCommandContext(argv: string[]): {
  config: SuperHelperConfig;
  projectWorkspaceRoot: string;
  knowledgeWorkspaceRoot: string;
} {
  const explicit = readOption(argv, '--workspace') ?? readOption(argv, '--path');
  const explicitKnowledgeRoot = readOption(argv, '--knowledge-root');
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
  if (relativeOrAbsolute.startsWith('/')) {
    return relativeOrAbsolute;
  }
  return join(workspaceRoot, relativeOrAbsolute);
}

function readQualityGateArg(argv: string[], defaultGate: QualityGateArg): QualityGateArg {
  const value = readOption(argv, '--quality-gate') ?? defaultGate;
  if (value !== 'warn' && value !== 'strict' && value !== 'off') {
    console.error('Invalid --quality-gate. Expected warn|strict|off.');
    process.exit(1);
  }
  return value;
}

function embeddingConfigFromFlags(existing: EmbeddingProviderConfig, argv: string[]): EmbeddingProviderConfig {
  return {
    ...existing,
    enabled: hasFlag(argv, '--enable') || existing.enabled,
    provider: readOption(argv, '--provider') ?? existing.provider,
    model: readOption(argv, '--model') ?? existing.model,
    baseUrl: readOption(argv, '--base-url') ?? existing.baseUrl,
    endpoint: readOption(argv, '--endpoint') ?? existing.endpoint,
    apiKeyEnv: readOption(argv, '--api-key-env') ?? existing.apiKeyEnv,
    dimensions: optionalPositiveInteger(readOption(argv, '--dimensions')) ?? existing.dimensions,
    distance: readOption(argv, '--distance') ?? existing.distance,
    batchSize: optionalPositiveInteger(readOption(argv, '--batch-size')) ?? existing.batchSize,
    timeoutMs: optionalPositiveInteger(readOption(argv, '--timeout-ms')) ?? existing.timeoutMs,
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
