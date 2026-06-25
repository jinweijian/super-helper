import { join } from 'node:path';
import { defaultConfig, ensureConfig } from '../config.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import { readOption, hasFlag } from './args.js';

export async function runAcceptCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  if (subcommand !== 'knowledge') {
    console.error('Usage: super-helper accept knowledge --workspace <path> [--knowledge-root <path>] [--mock-worker|--real-worker] [--report-dir <path>]');
    process.exit(1);
  }

  const projectWorkspaceRoot = readOption(argv, '--workspace') ?? process.cwd();
  const explicitKnowledgeRoot = readOption(argv, '--knowledge-root');
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
  const reportDir = readOption(argv, '--report-dir') ?? join(knowledgeWorkspaceRoot, 'reports');
  const timeoutMs = Number(readOption(argv, '--timeout-ms') ?? config.claude.timeoutMs ?? 5000);
  const realWorker = hasFlag(argv, '--real-worker');
  const mockWorker = hasFlag(argv, '--mock-worker') || !realWorker;
  const keepCases = hasFlag(argv, '--keep-cases');
  const redact = !hasFlag(argv, '--no-redact');

  const { runKnowledgeAcceptance } = await import('../runtime/knowledge-acceptance.js');
  const result = await runKnowledgeAcceptance({
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
