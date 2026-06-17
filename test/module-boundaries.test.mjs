import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
