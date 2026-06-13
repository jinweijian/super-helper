import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  initKnowledgeWorkspace,
  parseMarkdownDocument,
  searchKnowledge,
  updateKnowledgeIndex,
} from '../dist/knowledge/index.js';
import { listPublicAgentConfigs, loadAgentRegistry } from '../dist/runtime/agent-configs.js';

function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), 'super-helper-knowledge-'));
}

function cleanup(path) {
  rmSync(path, { recursive: true, force: true });
}

test('knowledge init creates the enterprise knowledge workspace skeleton', () => {
  const workspace = tempWorkspace();
  try {
    const result = initKnowledgeWorkspace({ workspaceRoot: workspace });
    const knowledgeRoot = join(workspace, 'knowledge');

    assert.equal(result.knowledgeRoot, knowledgeRoot);
    assert.equal(result.created, true);
    assert.equal(existsSync(join(knowledgeRoot, '_sources', 'whitepapers')), true);
    assert.equal(existsSync(join(knowledgeRoot, '_taxonomy', 'modules.yaml')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'faq', 'README.md')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'whitepapers', 'README.md')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'manifest.json')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'chunks.jsonl')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'dirty.flag')), true);
    assert.match(readFileSync(join(knowledgeRoot, 'faq', 'README.md'), 'utf8'), /type: faq/);
    assert.match(readFileSync(join(knowledgeRoot, 'whitepapers', 'README.md'), 'utf8'), /source_pages/);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge update indexes markdown slices and search expands chunk hits to the parent slice', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const knowledgeRoot = join(workspace, 'knowledge');
    const sourceDir = join(knowledgeRoot, '_sources', 'whitepapers');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'course-whitepaper.meta.json'),
      `${JSON.stringify({
        id: 'src_course_whitepaper',
        source_type: 'whitepaper_pdf',
        path: 'knowledge/_sources/whitepapers/course-whitepaper.pdf',
        sha256: 'test-hash',
        title: 'Course Whitepaper',
        downloaded_at: '2026-06-13T00:00:00.000Z',
        product_versions: ['>=2025.10'],
        page_count: 42,
        owner: 'product-course',
        ingest_tool_version: 'pdf-ingest-v1',
      }, null, 2)}\n`,
      'utf8',
    );

    const whitepaperDir = join(knowledgeRoot, 'whitepapers', 'course');
    mkdirSync(whitepaperDir, { recursive: true });
    writeFileSync(
      join(whitepaperDir, 'visibility.md'),
      `---
id: kb_whitepaper_course_visibility
title: 课程可见性规则
type: whitepaper_slice
module: course
intent: product_rule
source_type: whitepaper
confidence: medium
status: active
visibility: internal
product_versions:
  - ">=2025.10"
related_terms:
  - 课程发布
  - 学员端
related_repos:
  - course-service
last_verified_at: 2026-06-13
owner: product-course
source_document: knowledge/_sources/whitepapers/course-whitepaper.pdf
source_document_id: src_course_whitepaper
source_pages:
  - 12
  - 13
section_path:
  - 课程管理
  - 发布与可见性
chunking_strategy: semantic-section-v1
---

# 课程可见性规则

## 核心规则

课程必须同时满足发布状态、可见范围、学员权限和上架时间条件，才会在学员端展示。

## 例外情况

如果课程被下线，学员端不会展示。
`,
      'utf8',
    );

    const update = updateKnowledgeIndex({ workspaceRoot: workspace });
    assert.equal(update.documentCount, 1);
    assert.equal(update.chunkCount, 1);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'dirty.flag')), false);

    const chunks = readFileSync(join(knowledgeRoot, 'indexes', 'chunks.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(chunks[0].parent_id, 'kb_whitepaper_course_visibility');
    assert.deepEqual(chunks[0].source_pages, [12, 13]);

    const result = searchKnowledge({
      workspaceRoot: workspace,
      query: '课程发布后为什么学员端看不到',
      limit: 5,
    });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].document_id, 'kb_whitepaper_course_visibility');
    assert.equal(result.results[0].parent_id, 'kb_whitepaper_course_visibility');
    assert.equal(result.results[0].source_document, 'knowledge/_sources/whitepapers/course-whitepaper.pdf');
    assert.deepEqual(result.results[0].source_pages, [12, 13]);
    assert.match(result.results[0].excerpt, /课程必须同时满足发布状态/);

    writeFileSync(join(knowledgeRoot, 'indexes', 'dirty.flag'), 'rebuild required\n', 'utf8');
    const dirtyResult = searchKnowledge({
      workspaceRoot: workspace,
      query: '课程发布后为什么学员端看不到',
      limit: 5,
    });
    assert.equal(dirtyResult.results[0].document_id, 'kb_whitepaper_course_visibility');
  } finally {
    cleanup(workspace);
  }
});

test('knowledge CLI initializes and updates a workspace', () => {
  const workspace = tempWorkspace();
  try {
    const initOutput = execFileSync(process.execPath, ['dist/cli.js', 'knowledge', 'init', '--workspace', workspace], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.match(initOutput, /knowledge workspace ready/);

    const updateOutput = execFileSync(process.execPath, ['dist/cli.js', 'knowledge', 'update', '--workspace', workspace], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.match(updateOutput, /knowledge index updated/);
    assert.match(updateOutput, /chunks:/);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge search finds FAQ and runbook documents while filtering deprecated documents', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const knowledgeRoot = join(workspace, 'knowledge');
    const faqDir = join(knowledgeRoot, 'faq', 'general');
    const runbookDir = join(knowledgeRoot, 'runbooks', 'general');
    const glossaryDir = join(knowledgeRoot, 'glossary', 'terms');
    mkdirSync(faqDir, { recursive: true });
    mkdirSync(runbookDir, { recursive: true });
    mkdirSync(glossaryDir, { recursive: true });
    writeFileSync(
      join(faqDir, 'password.md'),
      `---
id: kb_faq_general_password
title: 如何重置密码
type: faq
module: general
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 重置密码
  - 账号
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 如何重置密码

## 答案

管理员可以在账号管理页面重置密码。
`,
      'utf8',
    );
    writeFileSync(
      join(runbookDir, 'login.md'),
      `---
id: kb_runbook_general_login
title: 登录失败排查
type: runbook
module: general
intent: troubleshooting
source_type: runbook
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 登录失败
  - 账号
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 登录失败排查

## 快速判断

先确认账号状态和密码是否过期。
`,
      'utf8',
    );
    writeFileSync(
      join(faqDir, 'deprecated.md'),
      `---
id: kb_faq_general_deprecated
title: 废弃功能说明
type: faq
module: general
intent: how_to
source_type: faq
confidence: high
status: deprecated
visibility: internal
product_versions: []
related_terms:
  - 废弃功能
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 废弃功能说明

这个文档不能作为可回答证据。
`,
      'utf8',
    );
    writeFileSync(
      join(glossaryDir, 'account.md'),
      `---
id: kb_glossary_account
title: 账号
type: glossary_term
module: general
intent: term_explanation
source_type: glossary
confidence: low
status: active
visibility: internal
product_versions: []
related_terms:
  - 账号
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 账号

## 定义

账号是用户登录和权限识别的主体。
`,
      'utf8',
    );

    updateKnowledgeIndex({ workspaceRoot: workspace });

    assert.equal(searchKnowledge({ workspaceRoot: workspace, query: '怎么重置密码' }).results[0].source_type, 'faq');
    assert.equal(searchKnowledge({ workspaceRoot: workspace, query: '登录失败怎么排查' }).results[0].source_type, 'runbook');
    assert.equal(searchKnowledge({ workspaceRoot: workspace, query: '废弃功能怎么用' }).results.length, 0);
    assert.equal(searchKnowledge({ workspaceRoot: workspace, query: '账号是什么意思', sourceTypes: ['glossary'] }).results[0].confidence, 'low');
    assert.equal(searchKnowledge({ workspaceRoot: workspace, query: '账号', limit: 1 }).results.length, 1);
    assert.equal(searchKnowledge({ workspaceRoot: workspace, query: '完全不存在的问题' }).results.length, 0);
  } finally {
    cleanup(workspace);
  }
});

test('frontmatter validation reports missing required fields', () => {
  assert.throws(
    () => parseMarkdownDocument('---\nid: kb_invalid\n---\n# Invalid\n', 'invalid.md'),
    /missing required frontmatter fields/,
  );
});

test('knowledge agent configs are registered for future runtime wiring', () => {
  const stages = loadAgentRegistry().agents.map((agent) => agent.stage);

  assert.equal(stages.includes('knowledge_router'), true);
  assert.equal(stages.includes('evidence_judge'), true);
  assert.equal(stages.includes('case_curator'), true);
  assert.equal(listPublicAgentConfigs().some((agent) => agent.stage === 'evidence_judge' && !agent.mayProduceUserFacingText), true);
});
