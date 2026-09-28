import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadConfig, saveConfig } from '../dist/config.js';

const repositoryRoot = resolve(import.meta.dirname, '..');

function runScript(name, args) {
  const result = spawnSync('bash', [join(repositoryRoot, 'scripts', name), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('初始化站点使用同一个可写目录读取和保存配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-deployment-'));
  try {
    const siteDir = join(root, 'site');
    runScript('init-site.sh', [
      '--site-dir', siteDir,
      '--project-root', root,
      '--port', '4417',
      '--name', 'site',
      '--image', 'example.invalid/super-helper:test',
    ]);

    const configPath = join(siteDir, 'data', 'config.json');
    assert.equal(existsSync(configPath), true);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.storage.rootDir, '/data/super-helper');
    assert.equal(config.workspaces[0].rootPath, '/workspace/project');

    const compose = readFileSync(join(siteDir, 'compose.yml'), 'utf8');
    const dockerfile = readFileSync(join(repositoryRoot, 'docker', 'Dockerfile'), 'utf8');
    assert.match(compose, /\.\/data:\/data\/super-helper(?:\s|$)/m);
    assert.doesNotMatch(compose, /\.\/config\.json:/);
    assert.match(dockerfile, /"--home", "\/data\/super-helper"/);

    const loaded = loadConfig(configPath);
    loaded.storage.rootDir = join(siteDir, 'data'); // 模拟容器内挂载到宿主目录后的持久化路径
    loaded.server.port = 5555;
    saveConfig(loaded);
    assert.equal(loadConfig(configPath).server.port, 5555); // 模拟重启后重新读取
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('部署检查拒绝旧版或不一致的配置目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-deployment-check-'));
  try {
    const siteDir = join(root, 'site');
    runScript('init-site.sh', ['--site-dir', siteDir, '--project-root', root, '--port', '4417']);
    const secretPath = join(root, 'anthropic-key');
    writeFileSync(secretPath, 'test-only');
    const envPath = join(siteDir, '.env');
    writeFileSync(envPath, readFileSync(envPath, 'utf8').replace(
      /^ANTHROPIC_API_KEY_FILE=.*$/m,
      `ANTHROPIC_API_KEY_FILE=${secretPath}`,
    ));
    const check = () => spawnSync('bash', [join(repositoryRoot, 'scripts', 'check-deployment.sh'), siteDir], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.equal(check().status, 0);

    const configPath = join(siteDir, 'data', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.storage.rootDir = '/data/super-helper/data';
    writeFileSync(configPath, `${JSON.stringify(config)}\n`);
    const oldConfig = check();
    assert.notEqual(oldConfig.status, 0);
    assert.match(oldConfig.stderr, /旧版|rootDir/);

    config.knowledge.rootDir = '/data/super-helper';
    writeFileSync(configPath, `${JSON.stringify(config)}\n`);
    const wrongStorageWithMatchingKnowledge = check();
    assert.notEqual(wrongStorageWithMatchingKnowledge.status, 0);
    assert.match(wrongStorageWithMatchingKnowledge.stderr, /旧版|rootDir/);

    config.storage.rootDir = '/data/super-helper';
    writeFileSync(configPath, `${JSON.stringify(config)}\n`);
    const composePath = join(siteDir, 'compose.yml');
    writeFileSync(composePath, readFileSync(composePath, 'utf8').replace(
      './data:/data/super-helper',
      './data:/data/super-helper/data',
    ));
    const oldMount = check();
    assert.notEqual(oldMount.status, 0);
    assert.match(oldMount.stderr, /旧版|compose/);

    const originalEnv = readFileSync(envPath, 'utf8');
    const upgrade = spawnSync('bash', [join(repositoryRoot, 'scripts', 'upgrade-site.sh'),
      '--site-dir', siteDir, '--version', 'example.invalid/super-helper:new'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.notEqual(upgrade.status, 0);
    assert.equal(readFileSync(envPath, 'utf8'), originalEnv);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('复制站点只沿用镜像，不复制源站点配置或数据', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-deployment-copy-'));
  try {
    const source = join(root, 'source');
    const target = join(root, 'target');
    runScript('init-site.sh', ['--site-dir', source, '--project-root', root, '--port', '4417', '--name', 'source']);
    writeFileSync(join(source, 'data', 'case-private.json'), '{}');
    const sourceConfigPath = join(source, 'data', 'config.json');
    const sourceConfig = JSON.parse(readFileSync(sourceConfigPath, 'utf8'));
    sourceConfig.sourceOnlySecretRef = 'source-private-reference';
    writeFileSync(sourceConfigPath, `${JSON.stringify(sourceConfig)}\n`);
    runScript('copy-site.sh', [
      '--source', source,
      '--target', target,
      '--project-root', root,
      '--port', '4418',
      '--name', 'target',
    ]);
    assert.equal(existsSync(join(target, 'data', 'case-private.json')), false);
    const config = JSON.parse(readFileSync(join(target, 'data', 'config.json'), 'utf8'));
    assert.equal(config.workspaces[0].id, 'target');
    assert.equal(config.sourceOnlySecretRef, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('镜像构建仅带入构建输入，且先安装构建依赖再设置生产模式', () => {
  const dockerfile = readFileSync(join(repositoryRoot, 'docker', 'Dockerfile'), 'utf8');
  const ignore = readFileSync(join(repositoryRoot, '.dockerignore'), 'utf8');
  assert.ok(dockerfile.indexOf('RUN pnpm build') < dockerfile.indexOf('ENV NODE_ENV=production'));
  assert.match(dockerfile, /RUN pnpm prune --prod/);
  assert.match(ignore, /^\*\*$/m);
  for (const path of ['package.json', 'pnpm-lock.yaml', 'src/', 'web/', 'docker/entrypoint.sh']) {
    assert.ok(ignore.includes(`!${path}`), `${path} must be included in build context`);
  }
  for (const path of ['**/.env', '**/.env.*', '**/*.key', '**/*.pem', '**/node_modules']) {
    assert.ok(ignore.includes(path), `${path} must remain excluded from build context`);
  }
  assert.doesNotMatch(ignore, /!\.env|!\.git|!node_modules/);
});
