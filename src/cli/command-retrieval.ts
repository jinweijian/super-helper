import { defaultConfig, ensureConfig, type SuperHelperConfig } from '../config.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import { createConfiguredRetrievalService } from '../retrieval/configured-search.js';
import {
  loadRuntimeRetrievalEvaluationQuestions,
  runRuntimeRetrievalEvaluation,
} from '../runtime/retrieval-evaluation.js';
import { readNumberOption, readOption } from './args.js';

export async function runRetrievalCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  if (subcommand !== 'search' && subcommand !== 'debug' && subcommand !== 'eval') {
    printUsage();
    process.exit(1);
  }
  const context = resolveRetrievalContext(argv);
  if (subcommand === 'eval') {
    const questionsPath = readOption(argv, '--questions');
    if (!questionsPath) {
      printUsage();
      process.exit(1);
    }
    const report = await runRuntimeRetrievalEvaluation({
      config: context.config,
      workspaceRoot: context.knowledgeWorkspaceRoot,
      questions: loadRuntimeRetrievalEvaluationQuestions(questionsPath),
      reportPath: readOption(argv, '--report'),
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
      process.exit(1);
    }
    return;
  }
  const query = readOption(argv, '--query') ?? argv[1];
  if (!query) {
    printUsage();
    process.exit(1);
  }

  const service = createConfiguredRetrievalService(context.config);
  const result = await service.retrieve({
    workspaceRoot: context.knowledgeWorkspaceRoot,
    query,
    limit: readNumberOption(argv, '--limit') ?? 5,
  });

  if (subcommand === 'debug') {
    console.log(JSON.stringify({
      query: result.query,
      trace: result.trace,
      candidates: result.candidates.map((candidate) => ({
        id: candidate.id,
        chunkId: candidate.chunkId,
        source: candidate.source,
        score: candidate.score,
        finalScore: candidate.finalScore,
        strategyScores: candidate.strategyScores,
        bm25FieldContributions: candidate.metadata?.bm25FieldContributions,
      })),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify(result.evidence, null, 2));
}

function resolveRetrievalContext(argv: string[]): {
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
      mcpToolIds: config.workspaces[0]?.mcpToolIds ?? [],
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

function printUsage(): void {
  console.error('Usage: super-helper retrieval <search|debug> --query <question> [--workspace <path>] [--knowledge-root <path>] [--limit <n>]');
  console.error('       super-helper retrieval eval --questions <json> [--report <json>] [--workspace <path>] [--knowledge-root <path>]');
}
