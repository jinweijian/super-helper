import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const srcRoot = join(repoRoot, 'src');

function tsFilesUnder(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...tsFilesUnder(path));
    } else if (entry.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function relativeSource(path) {
  return relative(repoRoot, path).split(sep).join('/');
}

function assertNoImportPattern(files, patterns, message) {
  const offenders = [];
  for (const file of files) {
    const source = read(file);
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        offenders.push(`${relativeSource(file)} matches ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, [], message);
}

test('knowledge module does not import provider modules', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'knowledge')),
    [
      /from\s+['"]\.\.\/providers(?:\/|['"])/,
      /from\s+['"]\.\.\/embedding(?:\/|['"])/,
      /import\s*\(\s*['"]\.\.\/providers(?:\/|['"])/,
      /import\s*\(\s*['"]\.\.\/embedding(?:\/|['"])/,
    ],
    'knowledge must own local assets and artifacts, not provider factories or compatibility provider modules',
  );
});

test('embedding provider implementations do not reverse-import the legacy embedding facade', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'providers', 'embedding')),
    [
      /from\s+['"](?:\.\.\/)+embedding(?:\/|['"])/,
      /import\s*\(\s*['"](?:\.\.\/)+embedding(?:\/|['"])/,
    ],
    'provider implementations must live under src/providers and never load implementation from src/embedding',
  );
});

test('legacy embedding files contain compatibility exports only', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'embedding')),
    [
      /\bclass\s+[A-Za-z_$]/,
      /\bfunction\s+[A-Za-z_$]/,
      /\binterface\s+[A-Za-z_$]/,
      /\bconst\s+[A-Za-z_$][\w$]*\s*=/,
    ],
    'src/embedding is a compatibility facade and must not contain provider or metadata implementations',
  );
});

test('configured retrieval composes the registry service without keyword or legacy shortcuts', () => {
  assertNoImportPattern(
    [join(srcRoot, 'retrieval', 'configured-search.ts')],
    [
      /\bsearchKnowledge\b/,
      /from\s+['"]\.\/legacy-rag(?:\.js)?['"]/,
    ],
    'configured retrieval must always use the registry/service production path',
  );
});

test('knowledge indexer is a thin compatibility facade without retrieval implementation', () => {
  const path = join(srcRoot, 'knowledge', 'indexer.ts');
  const source = read(path);
  assert.ok(source.split(/\r?\n/).length <= 120, 'knowledge/indexer.ts must stay at or below 120 lines');
  assertNoImportPattern(
    [path],
    [
      /\bKnowledgeEmbeddingQueryProvider\b/,
      /\bKnowledgeRerankProvider\b/,
      /\bsourceTypeWeight\b/,
      /\bconfidenceWeight\b/,
      /\bscoreChunk\b/,
      /\bpassesFilters\b/,
    ],
    'knowledge indexer must not own provider-shaped ports or retrieval ranking',
  );
});

test('knowledge consumes stable embedding contracts instead of declaring provider-shaped ports', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'knowledge')),
    [
      /\binterface\s+KnowledgeEmbedding(?:Provider|Config|Document)[A-Za-z_$\w]*/,
    ],
    'knowledge must consume stable contracts and must not declare embedding/rerank provider-shaped interfaces',
  );
});

test('keyword recall imports retrieval compatibility search instead of knowledge indexer', () => {
  assertNoImportPattern(
    [join(srcRoot, 'retrieval', 'recall', 'keyword', 'strategy.ts')],
    [/from\s+['"]\.\.\/\.\.\/\.\.\/knowledge\/indexer(?:\.js)?['"]/],
    'keyword recall must not route through the knowledge compatibility facade',
  );
});

test('knowledge CLI is a thin dispatcher with focused handler modules', () => {
  const dispatcher = join(srcRoot, 'cli', 'command-knowledge.ts');
  assert.ok(read(dispatcher).split(/\r?\n/).length <= 120, 'command-knowledge.ts must stay at or below 120 lines');
  const commandRoot = join(srcRoot, 'cli', 'knowledge');
  assert.equal(existsSync(commandRoot), true, 'src/cli/knowledge must exist');
  const files = existsSync(commandRoot) ? new Set(readdirSync(commandRoot)) : new Set();
  for (const file of ['context.ts', 'output.ts', 'command-workspace.ts', 'command-pipeline.ts', 'command-vector.ts']) {
    assert.equal(files.has(file), true, `${file} must exist under src/cli/knowledge`);
  }
});

test('production source does not import the legacy embedding facade', () => {
  const productionFiles = tsFilesUnder(srcRoot).filter((path) => {
    const relative = relativeSource(path);
    return !relative.startsWith('src/embedding/') && !relative.startsWith('src/providers/');
  });
  assertNoImportPattern(
    productionFiles,
    [
      /from\s+['"](?:\.\.\/|\.\/)+embedding(?:\/|['"])/,
      /import\s*\(\s*['"](?:\.\.\/|\.\/)+embedding(?:\/|['"])/,
    ],
    'production modules must import embedding/rerank capabilities from src/providers directly',
  );
});

test('runtime module does not instantiate embedding or rerank providers', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'runtime')),
    [
      /\bcreateEmbeddingProvider\b/,
      /\bcreateRerankProvider\b/,
      /from\s+['"]\.\.\/providers\/(?:embedding|rerank)\/factory(?:\.js)?['"]/,
      /from\s+['"]\.\.\/embedding(?:\/|['"])/,
    ],
    'runtime must depend on retrieval services, not provider factories or legacy embedding provider modules',
  );
});

test('diagnostic runtime is a thin composition root with focused collaborators', () => {
  const runtimePath = join(srcRoot, 'runtime', 'diagnostic-runtime.ts');
  const source = read(runtimePath);
  assert.ok(source.split(/\r?\n/).length <= 300, 'diagnostic-runtime.ts must stay at or below 300 lines');

  const runtimeFiles = new Set(readdirSync(join(srcRoot, 'runtime')));
  const collaborators = [
    ['turn-queue.ts', 'CaseTurnQueue'],
    ['session-lifecycle.ts', 'SessionLifecycle'],
    ['preflight-service.ts', 'PreflightService'],
    ['experience-turn.ts', 'ExperienceTurnService'],
    ['knowledge-turn.ts', 'KnowledgeTurnService'],
    ['worker-diagnosis.ts', 'WorkerDiagnosisService'],
    ['review-presentation.ts', 'ReviewPresentationService'],
    ['case-curation-service.ts', 'CaseCurationService'],
  ];
  for (const [file, symbol] of collaborators) {
    assert.equal(runtimeFiles.has(file), true, `${file} must exist under src/runtime`);
    assert.match(source, new RegExp(`\\b${symbol}\\b`), `DiagnosticRuntime must compose ${symbol}`);
  }

  assertNoImportPattern(
    [runtimePath],
    [
      /from\s+['"]\.\.\/knowledge(?:\/|['"])/,
      /\bresolveKnowledgeWorkspaceRoot\b/,
      /\bknowledgeRoot\b/,
      /\bexistsSync\b/,
      /\bcreateEmbeddingProvider\b/,
      /\bcreateRerankProvider\b/,
    ],
    'DiagnosticRuntime must coordinate services without owning knowledge paths, artifacts, or providers',
  );
});

test('settings service is a thin compatibility facade with focused owners', () => {
  const settingsRoot = join(srcRoot, 'settings');
  const facadePath = join(settingsRoot, 'service.ts');
  const source = read(facadePath);
  assert.ok(source.split(/\r?\n/).length <= 120, 'settings/service.ts must stay at or below 120 lines');

  const required = [
    'contracts.ts',
    'public-view.ts',
    'secrets.ts',
    'model-settings.ts',
    'provider-settings.ts',
    'claude-settings.ts',
  ];
  const files = new Set(readdirSync(settingsRoot));
  for (const file of required) {
    assert.equal(files.has(file), true, `${file} must exist under src/settings`);
  }

  assertNoImportPattern(
    [facadePath],
    [
      /\bfunction\s+[A-Za-z_$]/,
      /\binterface\s+[A-Za-z_$]/,
      /\bconst\s+[A-Za-z_$][\w$]*\s*=/,
      /\bsaveConfig\b/,
      /\brun(?:Model|Embedding|Rerank)SmokeTest\b/,
    ],
    'settings/service.ts must contain compatibility exports only',
  );
  assertNoImportPattern(
    tsFilesUnder(settingsRoot).filter((path) => path !== facadePath),
    [/from\s+['"]\.\/service(?:\.js)?['"]/],
    'settings implementations must never import the compatibility facade',
  );
});

test('root CLI entrypoint stays thin and avoids business-module imports', () => {
  const source = read(join(srcRoot, 'cli.ts'));
  assert.match(source, /^#!\/usr\/bin\/env node/);
  assert.match(source, /['"]\.\/cli\/main\.js['"]/);
  assertNoImportPattern(
    [join(srcRoot, 'cli.ts')],
    [
      /from\s+['"]\.\/knowledge(?:\/|['"])/,
      /from\s+['"]\.\/retrieval(?:\/|['"])/,
      /from\s+['"]\.\/providers(?:\/|['"])/,
      /from\s+['"]\.\/embedding(?:\/|['"])/,
      /from\s+['"]\.\/runtime(?:\/|['"])/,
      /from\s+['"]\.\/gateway(?:\/|['"])/,
      /from\s+['"]\.\/onboarding(?:\/|['"])/,
      /from\s+['"]\.\/server(?:\/|['"])/,
      /from\s+['"]\.\/config(?:\/|['"])/,
    ],
    'root cli.ts must delegate to cli/main.ts and avoid direct business imports',
  );
});

test('primary CLI command adapters use command prefix', () => {
  const required = [
    'command-server.ts',
    'command-status.ts',
    'command-doctor.ts',
    'command-knowledge.ts',
    'command-retrieval.ts',
    'command-provider.ts',
    'command-config.ts',
    'command-accept.ts',
  ];
  const cliFiles = new Set(readdirSync(join(srcRoot, 'cli')));
  for (const file of required) {
    assert.equal(cliFiles.has(file), true, `${file} must exist`);
  }

  for (const file of ['server-commands.ts', 'status-command.ts', 'doctor-command.ts']) {
    const source = read(join(srcRoot, 'cli', file)).trim();
    assert.match(source, /^export /, `${file} must only re-export command-* compatibility symbols`);
    assert.doesNotMatch(source, /^import /m, `${file} must not own command implementation`);
  }
});

test('rerank provider implementation does not live under embedding directories', () => {
  const embeddingFiles = [
    ...tsFilesUnder(join(srcRoot, 'embedding')),
    ...safeTsFilesUnder(join(srcRoot, 'providers', 'embedding')),
  ];
  const offenders = embeddingFiles
    .map(relativeSource)
    .filter((path) => /(?:^|\/)rerank(?:-|\.|\/)/.test(path));

  assert.deepEqual(offenders, [], 'rerank provider files must live under src/providers/rerank, not embedding');
});

test('gateway settings route delegates settings orchestration to settings service', () => {
  assertNoImportPattern(
    [join(srcRoot, 'gateway', 'routes', 'settings-routes.ts')],
    [
      /\brunModelSmokeTest\b/,
      /\brunEmbeddingSmokeTest\b/,
      /\brunRerankSmokeTest\b/,
      /\bsaveConfig\b/,
      /\bmodelProviderFromInput\b/,
      /\bembeddingProviderFromInput\b/,
      /\brerankProviderFromInput\b/,
      /from\s+['"]\.\.\/\.\.\/(?:embedding|providers|model-smoke-test|runtime)\/?/,
    ],
    'settings route must stay at HTTP/body/status/serialization boundary and delegate orchestration',
  );
});

function safeTsFilesUnder(dir) {
  try {
    return tsFilesUnder(dir);
  } catch {
    return [];
  }
}
