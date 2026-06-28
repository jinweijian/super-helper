import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { judgeKnowledgeEvidence } from '../dist/runtime/evidence-judge.js';
import { diagnosticResultFromKnowledge } from '../dist/runtime/knowledge-diagnosis.js';
import { retrieveKnowledgeWithConfiguredRetrieval } from '../dist/retrieval/configured-search.js';

function tempWorkspace() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-grounding-'));
  mkdirSync(join(workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'knowledge', 'faq', 'course'), { recursive: true });
  return workspaceRoot;
}

function writeGroundedParent(workspaceRoot, overrides = {}) {
  const id = overrides.id ?? 'kb_faq_course_visibility';
  const title = overrides.title ?? '课程发布可见性规则';
  const body = overrides.body ?? '课程发布后，学员需要满足可加入范围与有效期条件才能看到加入入口。';
  const path = join(workspaceRoot, 'knowledge', 'faq', 'course', `${id}.md`);
  writeFileSync(path, `---
id: ${id}
title: ${title}
type: faq
module: course
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 课程发布
  - 学员可见
related_repos: []
last_verified_at: ${overrides.lastVerifiedAt ?? '2026-06-20'}
owner: support
source_document: knowledge/_sources/manual/course-guide.md
source_document_id: src_course_guide
source_block_ids:
  - blk_course_visibility
section_path:
  - 课程管理
  - 发布与可见性
quality_status: ${overrides.qualityStatus ?? 'ok'}
---

# ${title}

## 答案

${body}
`, 'utf8');
  return { id, title, body, source: `knowledge/faq/course/${id}.md` };
}

function writeChunk(workspaceRoot, parent) {
  writeFileSync(join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl'), `${JSON.stringify({
    chunk_id: `chk_${parent.id}_001`,
    parent_id: parent.id,
    source: parent.source,
    module: 'course',
    intent: 'how_to',
    source_type: 'faq',
    status: 'active',
    confidence: 'high',
    visibility: 'internal',
    headings: [parent.title],
    keywords: ['课程发布', '学员可见'],
    text: parent.body,
    artifact_version: 2,
    chunking_strategy: 'parent-child-v2',
    legacy: false,
    child_order: 1,
    source_block_ids: ['blk_course_visibility'],
    section_path: ['课程管理', '发布与可见性'],
    quality_status: 'ok',
  })}\n`, 'utf8');
}

function route(overrides = {}) {
  return {
    normalizedQuestion: '课程发布后学员怎么看到加入入口',
    moduleCandidates: ['course'],
    intentCandidates: ['how_to'],
    keywords: ['课程发布', '学员', '加入入口'],
    sourceTypes: ['faq'],
    codeEscalationSignals: [],
    risks: [],
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    evidence_id: 'ev_course_visibility',
    document_id: 'kb_faq_course_visibility',
    parent_id: 'kb_faq_course_visibility',
    chunk_id: 'chk_course_visibility_001',
    source: 'knowledge/faq/course/visibility.md',
    source_document: 'knowledge/_sources/manual/course-guide.md',
    source_document_id: 'src_course_guide',
    source_block_ids: ['blk_course_visibility'],
    source_pages: [],
    section_path: ['课程管理', '发布与可见性'],
    title: '课程发布可见性规则',
    type: 'faq',
    module: 'course',
    intent: 'how_to',
    source_type: 'faq',
    confidence: 'high',
    status: 'active',
    visibility: 'internal',
    last_verified_at: '2026-06-20',
    matched_terms: ['课程发布', '学员可见'],
    summary: '课程发布可见性规则',
    excerpt: '课程发布后，学员需要满足可加入范围与有效期条件才能看到加入入口。',
    answer_span: '学员需要满足可加入范围与有效期条件才能看到加入入口。',
    score: 0.016,
    retrieval: { source: 'rerank', keywordScore: 9.5, rerankScore: 0.82 },
    quality: { severity: 'ok', issues: [] },
    ...overrides,
  };
}

function pack(result) {
  return {
    query: {
      normalized_question: '课程发布后学员怎么看到加入入口',
      module_candidates: ['course'],
      intent_candidates: ['how_to'],
      keywords: ['课程发布', '学员', '加入入口'],
    },
    results: [result],
    coverage: { searched_files: 1, matched_files: 1, filtered_out: [] },
  };
}

test('configured runtime retrieval returns trace and canonical parent grounding', async () => {
  const workspaceRoot = tempWorkspace();
  try {
    const parent = writeGroundedParent(workspaceRoot);
    writeChunk(workspaceRoot, parent);
    const config = defaultConfig();
    config.embedding.enabled = false;
    config.rerank.enabled = false;

    const result = await retrieveKnowledgeWithConfiguredRetrieval({
      config,
      query: {
        workspaceRoot,
        query: '课程发布可见性规则 学员加入入口',
        moduleCandidates: ['course'],
        visibility: ['internal'],
        limit: 5,
      },
    });

    assert.equal(result.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(result.trace.strategies.find((item) => item.id === 'embedding')?.status, 'skipped');
    const top = result.evidencePack.results[0];
    assert.equal(top.document_id, parent.id);
    assert.equal(top.last_verified_at, '2026-06-20');
    assert.equal(top.source_document_id, 'src_course_guide');
    assert.deepEqual(top.source_block_ids, ['blk_course_visibility']);
    assert.deepEqual(top.section_path, ['课程管理', '发布与可见性']);
    assert.equal(top.quality.severity, 'ok');
    assert.match(top.answer_span, /加入入口/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('old chunks remain readable without invented grounding defaults', async () => {
  const workspaceRoot = tempWorkspace();
  try {
    writeFileSync(join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl'), `${JSON.stringify({
      chunk_id: 'chk_legacy_001',
      parent_id: 'kb_missing_parent',
      source: 'knowledge/faq/missing.md',
      module: 'general',
      intent: 'how_to',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      headings: ['Legacy answer'],
      keywords: ['legacy'],
      text: 'Legacy answer is available.',
    })}\n`, 'utf8');
    const result = await retrieveKnowledgeWithConfiguredRetrieval({
      config: defaultConfig(),
      query: { workspaceRoot, query: 'legacy answer', limit: 3 },
    });
    const top = result.evidencePack.results[0];
    assert.equal(top.last_verified_at, undefined);
    assert.equal(top.quality, undefined);
    assert.equal(top.source_document_id, undefined);
    assert.equal(result.trace.filters.some((item) => item.reason === 'missing_parent'), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('strict judge permits only fully grounded high-confidence evidence', () => {
  const accepted = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence()),
    question: '课程发布后学员怎么看到加入入口',
  });
  assert.equal(accepted.answerable, true);

  const warning = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence({ quality: { severity: 'warn', issues: ['multi_topic_slice'] } })),
    question: '课程发布后学员怎么看到加入入口',
  });
  assert.equal(warning.answerable, false);
  assert.equal(warning.blockers.includes('low_quality_evidence'), true);

  const missingProvenance = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence({ source_document_id: undefined, source_block_ids: undefined })),
    question: '课程发布后学员怎么看到加入入口',
  });
  assert.equal(missingProvenance.answerable, false);
  assert.equal(missingProvenance.blockers.includes('missing_provenance'), true);

  const lowRerank = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence({ retrieval: { source: 'rerank', rerankScore: 0.69 } })),
    question: '学员加入入口受哪些条件影响',
  });
  assert.equal(lowRerank.answerable, false);
  assert.equal(lowRerank.blockers.includes('low_retrieval_confidence'), true);
});

test('exact-title lexical fallback stays bounded by complete grounding', () => {
  const lexical = evidence({ retrieval: { source: 'keyword', keywordScore: 12 } });
  const accepted = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(lexical),
    question: '课程发布可见性规则是什么？',
  });
  assert.equal(accepted.answerable, true);

  const weak = judgeKnowledgeEvidence({
    route: route({ keywords: ['课程'] }),
    evidencePack: pack(evidence({
      matched_terms: ['课', '程'],
      retrieval: { source: 'keyword', keywordScore: 12 },
    })),
    question: '课程怎么处理？',
  });
  assert.equal(weak.answerable, false);
  assert.equal(weak.blockers.includes('low_signal_terms'), true);
});

test('knowledge feature overview aggregates multiple feature facts', () => {
  const overview = evidence({
    evidence_id: 'ev_ai_feature_overview',
    document_id: 'kb_ai_feature_overview',
    parent_id: 'kb_ai_feature_overview',
    title: 'AI伴学助手功能清单',
    module: 'ai-companion',
    intent: 'feature_overview',
    source_type: 'faq',
    matched_terms: ['AI伴学助手', '功能清单'],
    summary: 'AI伴学助手功能清单',
    answer_span: 'AI伴学助手支持学习计划制定、督学提醒、学习问答、题目答疑和知识点诊断。',
    source: 'knowledge/faq/ai-companion/feature-overview.md',
  });
  const learningPlan = evidence({
    evidence_id: 'ev_ai_learning_plan',
    document_id: 'kb_ai_learning_plan',
    parent_id: 'kb_ai_learning_plan',
    title: '学习计划制定',
    module: 'ai-companion',
    intent: 'feature_overview',
    source_type: 'faq',
    matched_terms: ['学习计划制定', 'AI伴学助手'],
    summary: '学习计划制定',
    answer_span: '学员加入课程后，可选择学习时间段、每周学习日来制定学习计划。',
    source: 'knowledge/faq/ai-companion/learning-plan.md',
  });
  const questionAnswer = evidence({
    evidence_id: 'ev_ai_question_answer',
    document_id: 'kb_ai_question_answer',
    parent_id: 'kb_ai_question_answer',
    title: '学习问答',
    module: 'ai-companion',
    intent: 'feature_overview',
    source_type: 'faq',
    matched_terms: ['学习问答', 'AI伴学助手'],
    summary: '学习问答',
    answer_span: '学员学习时有不理解的知识，可向AI伴学助手提问获取解答回复。',
    source: 'knowledge/faq/ai-companion/question-answer.md',
  });

  const result = diagnosticResultFromKnowledge({
    evidencePack: {
      query: {
        normalized_question: 'ai伴学助手有哪些功能',
        module_candidates: ['ai-companion'],
        intent_candidates: ['feature_overview'],
        keywords: ['AI伴学助手', '功能清单'],
      },
      results: [overview, learningPlan, questionAnswer],
      coverage: { searched_files: 3, matched_files: 3, filtered_out: [] },
    },
    route: route({
      normalizedQuestion: 'ai伴学助手有哪些功能',
      moduleCandidates: ['ai-companion'],
      intentCandidates: ['feature_overview'],
      keywords: ['AI伴学助手', '功能清单'],
      sourceTypes: ['faq', 'whitepaper', 'module_doc'],
    }),
    judge: {
      answerable: true,
      confidence: 'high',
      need_code_escalation: false,
      reason: '知识库可回答功能清单。',
      rationale: '知识库可回答功能清单。',
      evidence: ['ev_ai_feature_overview', 'ev_ai_learning_plan', 'ev_ai_question_answer'],
      risks: [],
      missing_info: [],
      conflicts: [],
      blockers: [],
      ambiguity: [],
      quality_issues: [],
      recommended_next_action: 'final_answer',
      answer_score: 0.92,
      score_breakdown: {
        relevance: 1,
        coverage: 1,
        source_authority: 1,
        freshness: 1,
        version_match: 1,
        agreement: 1,
        actionability: 1,
        conflict_penalty: 0,
        ambiguity_penalty: 0,
        risk_penalty: 0,
        quality_penalty: 0,
      },
    },
  });

  const facts = result.claims.filter((claim) => claim.type === 'fact');
  assert.equal(facts.length >= 3, true, JSON.stringify(result.claims));
  assert.match(facts.map((claim) => claim.text).join('\n'), /学习计划制定/);
  assert.match(facts.map((claim) => claim.text).join('\n'), /学习问答/);
  assert.equal(result.evidence.length >= 3, true);
});
