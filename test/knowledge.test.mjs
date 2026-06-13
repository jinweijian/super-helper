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
  routeKnowledgeQuestion,
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

test('knowledge init ingests two DOCX whitepapers into searchable parent slices', () => {
  const workspace = tempWorkspace();
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-source-docx-'));
  try {
    const docxPath = join(sourceDir, 'AI伴学助手用户指南.docx');
    const trainingDocxPath = join(sourceDir, 'EduSoho教培线用户指南.docx');
    writeMinimalDocx(docxPath, [
      { style: '2', text: 'AI伴学助手' },
      { style: '3', text: '制定学习计划' },
      { text: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。' },
      { text: '学习计划生成后包含任务数、学习总时长、学习起止时间、每周学习日和每日学习时长。' },
      { style: '3', text: '督学提醒' },
      { text: '学习日上午9点以对话框消息和 APP 通知的形式向学员发送学习提醒。' },
      { text: '学习日晚上8点未完成当日学习任务时，会通过 AI 伴学助手和 APP 通知发送提醒。' },
    ]);
    writeMinimalDocx(trainingDocxPath, [
      { style: '2', text: 'EduSoho教培线' },
      { style: '3', text: '课程搜索' },
      { text: '课程列表的搜索栏支持按照课程名称、课程编号和课程分类搜索课程。' },
      { text: '管理员也可以通过课程状态筛选已发布、未发布或已关闭的课程。' },
      { style: '3', text: '班级学员' },
      { text: '班级学员列表支持查看学员加入时间、学习进度和作业完成状态。' },
    ]);

    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir });
    const knowledgeRoot = join(workspace, 'knowledge');
    const report = JSON.parse(readFileSync(join(knowledgeRoot, 'indexes', 'ingest-report.json'), 'utf8'));

    assert.equal(report.sourceDocuments, 2);
    assert.equal(report.parentSlices >= 2, true);
    assert.equal(report.chunks >= 2, true);
    assert.equal(existsSync(join(knowledgeRoot, '_sources', 'whitepapers', 'AI伴学助手用户指南.docx')), true);
    assert.equal(existsSync(join(knowledgeRoot, '_sources', 'whitepapers', 'EduSoho教培线用户指南.docx')), true);

    const aiResult = searchKnowledge({
      workspaceRoot: workspace,
      query: '学习日晚上8点没有完成任务会怎么提醒',
      limit: 5,
    });

    assert.equal(aiResult.results.length > 0, true);
    assert.equal(aiResult.results[0].source_type, 'whitepaper');
    assert.match(aiResult.results[0].source_document, /AI伴学助手用户指南\.docx|ai-ban-xue-zhu-shou-yong-hu-zhi-nan\.docx/);
    assert.match(aiResult.results[0].excerpt, /晚上8点未完成当日学习任务/);

    const trainingResult = searchKnowledge({
      workspaceRoot: workspace,
      query: '课程搜索栏支持按什么搜索课程',
      limit: 5,
    });

    assert.equal(trainingResult.results.length > 0, true);
    assert.equal(trainingResult.results[0].source_type, 'whitepaper');
    assert.match(trainingResult.results[0].source_document, /EduSoho教培线用户指南\.docx|edusoho-jiao-pei-xian-yong-hu-zhi-nan\.docx/i);
    assert.match(trainingResult.results[0].excerpt, /课程名称、课程编号和课程分类/);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
  }
});

test('knowledge init does not overwrite edited parent slices unless forced', () => {
  const workspace = tempWorkspace();
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-source-docx-'));
  try {
    const docxPath = join(sourceDir, 'AI伴学助手用户指南.docx');
    writeMinimalDocx(docxPath, [
      { style: '2', text: 'AI伴学助手' },
      { style: '3', text: '制定学习计划' },
      { text: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。' },
    ]);

    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir });
    const generatedSlice = findFirstGeneratedMarkdown(join(workspace, 'knowledge', 'whitepapers'));
    const editedContent = `${readFileSync(generatedSlice, 'utf8')}\n\n人工修订保留。\n`;
    writeFileSync(generatedSlice, editedContent, 'utf8');

    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir });

    assert.equal(readFileSync(generatedSlice, 'utf8'), editedContent);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
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

test('knowledge router identifies module and intent from taxonomy aliases', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const taxonomyDir = join(workspace, 'knowledge', '_taxonomy');
    writeFileSync(
      join(taxonomyDir, 'modules.yaml'),
      `modules:
  - id: ai-study
    name: AI伴学助手
    keywords:
      - AI伴学助手
      - 学习计划
      - 督学提醒
`,
      'utf8',
    );
    writeFileSync(
      join(taxonomyDir, 'aliases.yaml'),
      `aliases:
  - term: 伴学
    module: ai-study
  - term: AI助教
    module: ai-study
`,
      'utf8',
    );
    writeFileSync(
      join(taxonomyDir, 'intents.yaml'),
      `intents:
  - id: how_to
    keywords:
      - 怎么
      - 如何
`,
      'utf8',
    );

    const route = routeKnowledgeQuestion({
      workspaceRoot: workspace,
      question: '伴学怎么制定学习计划？',
    });

    assert.deepEqual(route.moduleCandidates, ['ai-study']);
    assert.deepEqual(route.intentCandidates, ['how_to']);
    assert.equal(route.keywords.includes('伴学'), true);
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

function writeMinimalDocx(path, paragraphs) {
  const dir = mkdtempSync(join(tmpdir(), 'minimal-docx-'));
  const wordDir = join(dir, 'word');
  mkdirSync(wordDir, { recursive: true });
  writeFileSync(
    join(dir, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    'utf8',
  );
  writeFileSync(
    join(wordDir, 'styles.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="3"><w:name w:val="heading 2"/></w:style>
</w:styles>`,
    'utf8',
  );
  const body = paragraphs.map((paragraph) => {
    const style = paragraph.style ? `<w:pPr><w:pStyle w:val="${paragraph.style}"/></w:pPr>` : '';
    return `<w:p>${style}<w:r><w:t>${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
  }).join('');
  writeFileSync(
    join(wordDir, 'document.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    'utf8',
  );
  execFileSync('zip', ['-qr', path, '[Content_Types].xml', 'word'], { cwd: dir });
  cleanup(dir);
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findFirstGeneratedMarkdown(root) {
  const entries = execFileSync('find', [root, '-type', 'f', '-name', '*.md'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.endsWith('/README.md'))
    .sort();
  assert.equal(entries.length > 0, true);
  return entries[0];
}
