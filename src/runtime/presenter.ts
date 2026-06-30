import type { AnswerGoal, DiagnosticClaim, DiagnosticResult, UserPersona, WorkerTrace } from '../domain.js';
import { validateDiagnosticResult } from './result-validator.js';

export function formatPreflightQuestion(question: string, missingInfo: string[]): string {
  return `我现在还不能判断原因，缺少关键信息：${missingInfo.join('、')}。\n\n${question}`;
}

export function ruleBasedReviewAndFormat(result: DiagnosticResult, persona: UserPersona, answerGoal?: AnswerGoal): string {
  return formatSafeFallbackReply(result, answerGoal, persona);
}

export function formatSafeFallbackReply(
  result: DiagnosticResult,
  answerGoal?: AnswerGoal,
  persona: UserPersona = 'operations',
  primaryAnswerClaimIds?: string[],
): string {
  const validation = validateDiagnosticResult(result, { answerGoal });
  result = validation.result;
  const supportedClaims = supportedAnswerClaims(result.claims);
  const unsupportedFacts = result.claims.filter((claim) => claim.type === 'fact' && claim.evidenceIds.length === 0);

  const frozenPrimaryIds = primaryAnswerClaimIds ?? validation.primaryAnswerClaimIds;
  const directClaim = frozenPrimaryIds
    .map((id) => supportedClaims.find((claim) => claim.id === id))
    .find(Boolean);

  if (supportedClaims.length === 0) {
    const missing = result.missingInfo.length > 0
      ? result.missingInfo.join('、')
      : '可验证的 medium/high confidence 证据';
    return [
      '目前证据不足，暂不能形成结论。',
      '',
      `**仍需确认：** ${missing}。`,
    ].join('\n');
  }

  const directAnswer = ensureChinesePeriod(sanitizeFallbackText(directClaim?.text ?? result.summary, persona));
  const lines = [`**结论：${directAnswer}**`];
  const supplements = supportedClaims
    .filter((claim) => claim !== directClaim)
    .slice(0, 4)
    .map((claim) => ensureChinesePeriod(sanitizeFallbackText(claim.text, persona)));

  if (supplements.length > 0) {
    lines.push('', '**补充说明：**', ...supplements.map((item, index) => `${index + 1}. ${item}`));
  }

  if (result.missingInfo.length > 0 || result.status === 'need_input' || result.recommendedNextAction === 'ask_user') {
    lines.push('', `**仍需确认：** ${result.missingInfo.join('、') || '可验证证据'}。`);
  }

  if (unsupportedFacts.length > 0) {
    lines.push('', `**未采纳：** ${unsupportedFacts.map((claim) => sanitizeFallbackText(claim.text, persona)).join('；')}`);
  }

  return lines.join('\n');
}

export function formatReviewFailureFallback(
  result: DiagnosticResult,
  _persona: UserPersona,
  answerGoal: AnswerGoal | undefined,
  trace: WorkerTrace | undefined,
  _reviewError: string,
  identity?: { caseId: string; runId: string },
): string {
  if (trace && workerFailedBeforeResult(trace)) {
    return formatWorkerFailureResult(result, trace, identity);
  }

  return formatSafeFallbackReply(result, answerGoal, _persona);
}

export function personaName(persona: UserPersona): string {
  const names: Record<UserPersona, string> = {
    operations: '运营人员',
    support: '技术支持',
    customer: '客户',
    developer: '开发人员',
  };
  return names[persona] ?? names.operations;
}

export function personaGuide(persona: UserPersona): Record<string, string> {
  const guides: Record<UserPersona, Record<string, string>> = {
    operations: {
      focus: '配置入口、业务影响、可执行下一步',
      avoid: '不要用影响说明替代对用户问题的直接回答',
      askFor: '页面、课程/订单/用户等业务对象、现象截图或时间范围',
    },
    support: {
      focus: '复现信息、影响范围、排查路径、需要转交给研发的证据',
      avoid: '避免无证据定责',
      askFor: '账号角色、环境、URL、报错信息、复现步骤',
    },
    customer: {
      focus: '先正面回答问题，再用更少黑话解释关键路径、配置项和限制条件',
      avoid: '不能因为是客户视角就删除用户问题所需的关键信息',
      askFor: '页面、操作步骤、看到的提示',
    },
    developer: {
      focus: '代码路径、调用链、状态变化、证据置信度',
      avoid: '避免省略关键技术证据',
      askFor: '接口、日志、文件路径、复现条件',
    },
  };
  return guides[persona] ?? guides.operations;
}

function supportedAnswerClaims(claims: DiagnosticClaim[]): DiagnosticClaim[] {
  return claims.filter((claim) => (
    (claim.type === 'fact' || claim.type === 'inference') &&
    claim.evidenceIds.length > 0 &&
    claim.role !== 'process_note' &&
    claim.role !== 'evidence_locator'
  ));
}

function extractPathTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9_.{}%-]+(?:\/[A-Za-z0-9_.{}%-]+)+\/?/g) ?? [];
}

function ensureChinesePeriod(text: string): string {
  return /[。！？!?]$/.test(text) ? text : `${text}。`;
}

function sanitizeFallbackText(text: string, persona: UserPersona): string {
  if (persona === 'developer') return text;
  return text.replace(/knowledge\/_sources\/whitepapers\/[^\s，。；)）\]]+/g, '原始白皮书资料');
}

function workerFailedBeforeResult(trace: WorkerTrace): boolean {
  return Boolean(trace.error || trace.signal || (trace.exitCode !== undefined && trace.exitCode !== 0));
}

function formatWorkerFailureResult(
  result: DiagnosticResult,
  trace: WorkerTrace,
  identity?: { caseId: string; runId: string },
): string {
  const category = trace.signal
    ? 'worker_interrupted'
    : trace.error && /timed?\s*out|timeout/i.test(trace.error)
      ? 'worker_timeout'
      : 'worker_execution_failed';
  const nextAction = result.recommendedNextAction === 'ask_user'
    ? '请补充缺失信息后重试。'
    : '请稍后重试；若持续失败，请让技术支持查看诊断日志。';
  return [
    `诊断未完成（${category}）。`,
    `当前状态：${result.status === 'need_input' ? '等待补充信息' : '未形成可验证结论'}。`,
    `下一步：${nextAction}`,
    identity ? `诊断标识：case=${identity.caseId}，run=${identity.runId}。` : '',
  ].filter(Boolean).join('\n\n');
}
