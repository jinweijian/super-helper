import { defaultConfig, ensureConfig } from '../config.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import {
  createBm25RecallStrategy,
  createRetrievalService,
} from '../retrieval/index.js';
import { readNumberOption, readOption } from './args.js';

export async function runRetrievalCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  if (subcommand !== 'search' && subcommand !== 'debug') {
    console.error('Usage: super-helper retrieval <search|debug> --query <question> [--workspace <path>] [--knowledge-root <path>] [--limit <n>]');
    process.exit(1);
  }
  const query = readOption(argv, '--query') ?? argv[1];
  if (!query) {
    console.error('Usage: super-helper retrieval <search|debug> --query <question> [--workspace <path>] [--knowledge-root <path>] [--limit <n>]');
    process.exit(1);
  }

  const context = resolveRetrievalContext(argv);
  const service = createRetrievalService({
    strategies: [createBm25RecallStrategy()],
  });
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
      })),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify(result.evidence, null, 2));
}

function resolveRetrievalContext(argv: string[]): {
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
    projectWorkspaceRoot: config.workspaces[0]?.rootPath ?? process.cwd(),
    knowledgeWorkspaceRoot: resolveKnowledgeWorkspaceRoot(config, config.workspaces[0]?.id),
  };
}
