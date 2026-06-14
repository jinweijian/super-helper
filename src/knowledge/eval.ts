import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keywordsFromQuery, searchKnowledge } from './indexer.js';
import { knowledgeEvalReportPath } from './paths.js';
import type {
  KnowledgeEvalQuestion,
  KnowledgeEvalQuestionResult,
  KnowledgeEvalReport,
  KnowledgeSourceType,
} from './types.js';

export interface RunKnowledgeEvalInput {
  workspaceRoot: string;
  questionsPath: string;
  limit?: number;
  reportDir?: string;
}

const ANSWER_BEARING_PATTERNS = [
  /步骤[一二三四五六七八九十0-9]+/,
  /[一二三四五六七八九十0-9]+[\.、]/,
  /支持|不支持|会|不会|需要|必须|返回|提示|提醒|开通|关闭|开启/,
  /(会|不会).{0,20}(提醒|提示|开通|触发|记录|通知|发送)/,
  /学习日.{0,15}(提醒|未完成|任务)/,
  /(search|搜索).{0,20}(按|根据|通过|支持)/i,
];

export function runKnowledgeEval(input: RunKnowledgeEvalInput): KnowledgeEvalReport {
  const questions = loadQuestions(input.questionsPath);
  const limit = input.limit ?? 5;
  const results: KnowledgeEvalQuestionResult[] = [];
  const failures: KnowledgeEvalReport['failures'] = [];
  const escalationResults: KnowledgeEvalReport['escalationResults'] = [];

  for (const question of questions) {
    const pack = searchKnowledge({
      workspaceRoot: input.workspaceRoot,
      query: question.question,
      sourceTypes: question.expectedSourceType ? [question.expectedSourceType as KnowledgeSourceType] : undefined,
      limit,
    });

    const result = evaluateQuestion(question, pack.results, limit);
    results.push(result);

    if (!result.passed) {
      failures.push({
        questionId: question.id,
        reason: result.failureReason ?? 'unknown',
        attribution: result.failureAttribution,
      });
    }

    escalationResults.push({
      questionId: question.id,
      escalated: pack.results.length === 0 && question.shouldHit === false,
      reason: pack.results.length === 0
        ? 'no knowledge evidence; would escalate'
        : 'evidence present',
    });
  }

  const totalQuestions = results.length;
  const hitAt1 = results.filter((r) => r.hitAt1).length;
  const hitAt3 = results.filter((r) => r.hitAt3).length;
  const hitAt5 = results.filter((r) => r.hitAt5).length;
  const answerBearingRate = totalQuestions === 0
    ? 0
    : results.filter((r) => r.answerBearing).length / totalQuestions;
  const falsePositiveCount = results.filter((r) => r.falsePositive).length;

  const report: KnowledgeEvalReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    questionCount: totalQuestions,
    hitAt1,
    hitAt3,
    hitAt5,
    answerBearingRate,
    falsePositiveCount,
    escalationResults,
    failures,
    perQuestion: results,
  };

  const reportPath = input.reportDir
    ? join(input.reportDir, `eval-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    : knowledgeEvalReportPath(input.workspaceRoot);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function evaluateQuestion(
  question: KnowledgeEvalQuestion,
  evidence: Array<{
    evidence_id?: string;
    source: string;
    source_document?: string;
    source_type: string;
    title: string;
    summary?: string;
    excerpt: string;
    matched_terms?: string[];
    quality?: { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] };
  }>,
  limit: number,
): KnowledgeEvalQuestionResult {
  const evidenceIds = evidence.slice(0, limit).map((e, i) => e.evidence_id ?? `ev_${i + 1}`);
  const expectedKeywords = (question.expectedKeywords ?? []).map((k) => k.toLowerCase());

  const hitAt1 = evidence[0] ? matchesExpected(evidence[0], question, expectedKeywords) : false;
  const hitAt3 = evidence.slice(0, 3).some((e) => matchesExpected(e, question, expectedKeywords));
  const hitAt5 = evidence.slice(0, 5).some((e) => matchesExpected(e, question, expectedKeywords));

  const answerBearing = evidence[0] ? hasAnswerBearing(evidence[0].excerpt + ' ' + evidence[0].title) : false;

  let passed = true;
  let failureReason: string | undefined;
  let failureAttribution: KnowledgeEvalQuestionResult['failureAttribution'];

  if (question.shouldHit) {
    if (!hitAt5) {
      passed = false;
      failureReason = `expected hit within top ${limit} not found`;
      failureAttribution = 'retrieval';
    } else if (!answerBearing) {
      passed = false;
      failureReason = 'top evidence lacks answer-bearing sentence';
      failureAttribution = 'evidence_judge';
    }
  } else {
    if (hitAt1 && answerBearing) {
      passed = false;
      failureReason = 'unexpected direct hit for should-not-hit question';
      failureAttribution = 'retrieval';
    }
  }

  const falsePositive = !question.shouldHit && hitAt1;

  return {
    questionId: question.id,
    passed,
    hitAt1,
    hitAt3,
    hitAt5,
    answerBearing,
    falsePositive,
    failureReason,
    failureAttribution,
    evidenceIds,
    topEvidence: evidence[0]
      ? {
          source: evidence[0].source,
          sourceDocument: evidence[0].source_document,
          title: evidence[0].title,
          excerptPreview: evidence[0].excerpt.slice(0, 240),
          matchedTerms: evidence[0].matched_terms ?? [],
          qualityStatus: evidence[0].quality?.severity,
        }
      : undefined,
  };
}

function matchesExpected(
  evidence: { source: string; source_document?: string; title: string; summary?: string; excerpt?: string },
  question: KnowledgeEvalQuestion,
  expectedKeywords: string[],
): boolean {
  const sourceHaystack = `${evidence.source} ${evidence.source_document ?? ''}`.toLowerCase();
  if (question.expectedDocument && !sourceHaystack.includes(question.expectedDocument.toLowerCase())) {
    return false;
  }
  if (expectedKeywords.length > 0) {
    const haystack = `${evidence.title} ${evidence.source} ${evidence.source_document ?? ''} ${evidence.summary ?? ''} ${evidence.excerpt ?? ''}`.toLowerCase();
    if (!expectedKeywords.some((kw) => haystack.includes(kw))) {
      return false;
    }
  }
  return true;
}

function hasAnswerBearing(text: string): boolean {
  return ANSWER_BEARING_PATTERNS.some((p) => p.test(text));
}

export function loadQuestions(questionsPath: string): KnowledgeEvalQuestion[] {
  if (!existsSync(questionsPath)) {
    return [];
  }
  const content = readFileSync(questionsPath, 'utf8');
  if (questionsPath.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content) as KnowledgeEvalQuestion[] | { questions: KnowledgeEvalQuestion[] };
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return parsed.questions ?? [];
    } catch {
      return [];
    }
  }
  if (/\.(ya?ml)$/i.test(questionsPath)) {
    return parseYamlQuestions(content);
  }
  return [];
}

function parseYamlQuestions(content: string): KnowledgeEvalQuestion[] {
  const questions: KnowledgeEvalQuestion[] = [];
  let current: Record<string, unknown> | undefined;
  let currentArrayKey: string | undefined;
  let inQuestions = false;

  const pushCurrent = (): void => {
    if (!current) return;
    const question = normalizeQuestionRecord(current);
    if (question.id && question.question) {
      questions.push(question);
    }
    current = undefined;
    currentArrayKey = undefined;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0;
    const line = withoutComment.trim();
    if (line === 'questions:') {
      inQuestions = true;
      continue;
    }
    if (!inQuestions) continue;

    const recordStart = line.match(/^-\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (recordStart && indent <= 2) {
      pushCurrent();
      current = {};
      current[recordStart[1]!] = parseYamlScalar(recordStart[2] ?? '');
      currentArrayKey = undefined;
      continue;
    }

    if (!current) continue;

    const arrayItem = line.match(/^-\s*(.*)$/);
    if (arrayItem && currentArrayKey) {
      const existing = current[currentArrayKey];
      if (!Array.isArray(existing)) {
        current[currentArrayKey] = [];
      }
      (current[currentArrayKey] as unknown[]).push(parseYamlScalar(arrayItem[1] ?? ''));
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyValue) {
      currentArrayKey = undefined;
      continue;
    }
    const key = keyValue[1]!;
    const value = keyValue[2] ?? '';
    if (value.trim() === '') {
      current[key] = [];
      currentArrayKey = key;
    } else {
      current[key] = parseYamlScalar(value);
      currentArrayKey = undefined;
    }
  }
  pushCurrent();
  return questions;
}

function normalizeQuestionRecord(record: Record<string, unknown>): KnowledgeEvalQuestion {
  return {
    id: stringValue(record.id),
    question: stringValue(record.question),
    shouldHit: booleanValue(record.shouldHit ?? record.should_hit),
    expectedDocument: optionalStringValue(record.expectedDocument ?? record.expected_document),
    expectedSection: optionalStringValue(record.expectedSection ?? record.expected_section),
    expectedKeywords: stringArrayValue(record.expectedKeywords ?? record.expected_keywords),
    expectedSourceType: sourceTypeValue(record.expectedSourceType ?? record.expected_source_type),
    expectedEscalation: escalationValue(record.expectedEscalation ?? record.expected_escalation),
  };
}

function parseYamlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
  if (/^\[.*\]$/.test(trimmed)) {
    return trimmed.slice(1, -1).split(',').map((item) => parseYamlScalar(item)).filter((item) => item !== '');
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function sourceTypeValue(value: unknown): KnowledgeSourceType | undefined {
  const string = optionalStringValue(value);
  if (!string) return undefined;
  return ['faq', 'runbook', 'solved_case', 'unresolved_case', 'whitepaper', 'glossary', 'module_doc', 'ticket'].includes(string)
    ? string as KnowledgeSourceType
    : undefined;
}

function escalationValue(value: unknown): KnowledgeEvalQuestion['expectedEscalation'] {
  const string = optionalStringValue(value);
  if (string === 'code' || string === 'human' || string === 'none') {
    return string;
  }
  return undefined;
}

export const __testing = { hasAnswerBearing, matchesExpected, parseYamlQuestions };

// Re-export for convenience
export { keywordsFromQuery };
