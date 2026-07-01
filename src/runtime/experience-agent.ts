import type { AnswerContract, DiagnosticResult, DiagnosticRun, Evidence, UserPersona } from '../domain.js';
import type { FileMemoryStore, StoredCase } from '../sessions/file-memory-store.js';
import { validateDiagnosticResult } from './result-validator.js';

export interface ExperienceMatch {
  sourceCaseId: string;
  sourceMessageId: string;
  sourceReplyId: string;
  sourceRunId: string;
  question: string;
  reply: string;
  score: number;
  result: DiagnosticResult;
}

export interface RejectedExperienceCandidate {
  sourceCaseId: string;
  sourceMessageId: string;
  sourceReplyId?: string;
  sourceRunId?: string;
  score: number;
  rejectionReason: string;
}

export function findExperienceMatch(input: {
  store: FileMemoryStore;
  currentCase: StoredCase;
  userMessage: string;
  answerContract?: AnswerContract;
}): ExperienceMatch | undefined {
  const normalized = normalizeQuestion(input.userMessage);
  if (normalized.length < 6) return undefined;

  return input.store
    .listCases(200)
    .filter((caseSession) => caseSession.id !== input.currentCase.id)
    .filter((caseSession) => caseSession.tenantId === input.currentCase.tenantId)
    .filter((caseSession) => caseSession.userId === input.currentCase.userId)
    .filter((caseSession) => caseSession.workspaceId === input.currentCase.workspaceId)
    .flatMap((caseSession) => pairsFromCase(caseSession, input.currentCase.userPersona, normalized, input.answerContract))
    .sort((left, right) => right.score - left.score)[0];
}

export function findRejectedExperienceCandidates(input: {
  store: FileMemoryStore;
  currentCase: StoredCase;
  userMessage: string;
  answerContract?: AnswerContract;
}): RejectedExperienceCandidate[] {
  const normalized = normalizeQuestion(input.userMessage);
  if (normalized.length < 6) return [];
  const candidates: RejectedExperienceCandidate[] = [];
  for (const caseSession of input.store.listCases(200)) {
    if (
      caseSession.id === input.currentCase.id ||
      caseSession.tenantId !== input.currentCase.tenantId ||
      caseSession.userId !== input.currentCase.userId ||
      caseSession.workspaceId !== input.currentCase.workspaceId
    ) continue;
    for (const message of caseSession.messages) {
      if (message.role !== 'user') continue;
      const score = similarity(normalized, normalizeQuestion(message.body));
      if (score < 0.92) continue;
      const reply = caseSession.messages.find((item) => item.role === 'helper' && item.replyToMessageId === message.id);
      if (!reply) {
        candidates.push({
          sourceCaseId: caseSession.id,
          sourceMessageId: message.id,
          score,
          rejectionReason: 'reply_not_attributable',
        });
        continue;
      }
      const sourceRun = findSourceRun(caseSession.runs, message.id, message.body);
      const rejectionReason = sourceRun
        ? reusabilityIssue(sourceRun, input.currentCase.userPersona, input.answerContract)
        : 'run_not_attributable';
      if (rejectionReason) {
        candidates.push({
          sourceCaseId: caseSession.id,
          sourceMessageId: message.id,
          sourceReplyId: reply.id,
          sourceRunId: sourceRun?.id,
          score,
          rejectionReason,
        });
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score).slice(0, 5);
}

function pairsFromCase(
  caseSession: StoredCase,
  persona: UserPersona,
  normalizedQuestion: string,
  answerContract?: AnswerContract,
): ExperienceMatch[] {
  const matches: ExperienceMatch[] = [];
  for (const message of caseSession.messages) {
    if (message.role !== 'user') continue;
    const score = similarity(normalizedQuestion, normalizeQuestion(message.body));
    if (score < 0.92) continue;
    const reply = caseSession.messages.find((item) => (
      item.role === 'helper' && item.replyToMessageId === message.id
    ));
    if (!reply) continue;
    const sourceRun = findSourceRun(caseSession.runs, message.id, message.body);
    if (!sourceRun?.result || !isReusableRun(sourceRun, persona, answerContract)) continue;
    const evidence = sourceRun.result.evidence.slice(0, 6);
    matches.push({
      sourceCaseId: caseSession.id,
      sourceMessageId: message.id,
      sourceReplyId: reply.id,
      sourceRunId: sourceRun.id,
      question: message.body,
      reply: reply.body,
      score,
      result: {
        status: 'concluded',
        summary: `历史经验命中：${reply.body.slice(0, 240)}`,
        missingInfo: [],
        evidence: [
          {
            id: 'ev_history_match',
            kind: 'history',
            source: `${caseSession.id}/${message.id}/${sourceRun.id}`,
            summary: `历史会话中存在已验证的同问题回复，匹配分 ${score.toFixed(2)}。`,
            confidence: score >= 0.98 ? 'high' : 'medium',
            validation: {
              status: 'active',
              visibility: 'customer_safe',
              lastVerifiedAt: new Date().toISOString(),
              quality: 'ok',
            },
          },
          ...evidence.filter((item) => item.id !== 'ev_history_match'),
        ],
        claims: [
          {
            id: 'claim_history_reply',
            type: 'inference',
            text: reply.body,
            evidenceIds: evidence.map((item) => item.id),
          },
          {
            id: 'claim_history_match',
            type: 'fact',
            text: `历史会话 ${caseSession.id} 的 run ${sourceRun.id} 已回答高度相同的问题。`,
            evidenceIds: ['ev_history_match'],
          },
        ],
        recommendedNextAction: 'final_answer',
      },
    });
  }
  return matches;
}

function findSourceRun(runs: DiagnosticRun[], sourceMessageId: string, question: string): DiagnosticRun | undefined {
  const normalized = normalizeQuestion(question);
  const attributed = runs.filter((run) => (
    run.result && run.request?.context?.resolvedTurn?.sourceMessageIds.includes(sourceMessageId)
  ));
  if (attributed.length === 1) return attributed[0];
  if (attributed.length > 1) return undefined;
  const legacyMatches = runs.filter((run) => (
    run.result && run.request && similarity(normalized, normalizeQuestion(run.request.userGoal)) >= 0.92
  ));
  return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
}

function isReusableRun(run: DiagnosticRun, persona: UserPersona, answerContract?: AnswerContract): boolean {
  return reusabilityIssue(run, persona, answerContract) === undefined;
}

function reusabilityIssue(run: DiagnosticRun, persona: UserPersona, answerContract?: AnswerContract): string | undefined {
  const result = run.result;
  if (!result || run.status !== 'concluded' || result.status !== 'concluded' || result.recommendedNextAction !== 'final_answer') {
    return 'run_not_final';
  }
  if (result.evidence.length === 0) return 'evidence_missing';
  if (result.evidence.some((evidence) => !isReusableEvidence(evidence, persona))) {
    return 'evidence_not_current_or_visible';
  }
  const validation = validateDiagnosticResult(result);
  if (validation.issues.length > 0 || validation.result.status !== 'concluded' || validation.result.recommendedNextAction !== 'final_answer') {
    return 'strict_review_failed';
  }
  if (answerContract && !resultCoversAnswerContract(validation.result, answerContract)) {
    return 'answer_contract_not_covered';
  }
  return undefined;
}

function isReusableEvidence(evidence: Evidence, persona: UserPersona): boolean {
  if (evidence.confidence === 'low') return false;
  const validation = evidence.validation;
  if (!validation || validation.status !== 'active' || !validation.lastVerifiedAt || !validation.quality) return false;
  if (validation.quality && validation.quality !== 'ok' && validation.quality !== 'info') return false;
  if (validation.lastVerifiedAt) {
    const verifiedAt = Date.parse(validation.lastVerifiedAt);
    if (!Number.isFinite(verifiedAt) || (Date.now() - verifiedAt) / 86_400_000 > 180) return false;
  }
  const allowed = visibilityForPersona(persona);
  return !validation.visibility || allowed.includes(validation.visibility);
}

function visibilityForPersona(persona: UserPersona): Array<NonNullable<Evidence['validation']>['visibility']> {
  if (persona === 'customer') return ['customer_safe'];
  if (persona === 'operations') return ['customer_safe', 'internal'];
  return ['customer_safe', 'internal', 'support'];
}

function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aSet = bigrams(a);
  const bSet = bigrams(b);
  const intersection = [...aSet].filter((item) => bSet.has(item)).length;
  return intersection / (new Set([...aSet, ...bSet]).size || 1);
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

function resultCoversAnswerContract(result: DiagnosticResult, answerContract: AnswerContract): boolean {
  if (answerContract.questionType === 'unknown' || answerContract.mustAnswer.length === 0) {
    return true;
  }
  const evidenceById = new Map(result.evidence.map((evidence) => [evidence.id, evidence]));
  const text = [
    result.summary,
    ...result.claims.map((claim) => claim.text),
    ...result.claims.flatMap((claim) => claim.evidenceIds.map((id) => evidenceById.get(id)?.summary ?? '')),
  ].join('\n');
  return answerContract.mustAnswer.every((requirement) => requirementCovered(requirement.id, text));
}

function requirementCovered(requirementId: string, text: string): boolean {
  const normalized = text.toLowerCase();
  const patterns: Record<string, RegExp> = {
    definition: /(是|用于|定义|指的是|属于).{0,40}(课程|功能|能力|模块|服务|场景)/,
    capabilities: /(功能|能力|支持|包括|包含|可以|可用于|管理|查看|巡检|配置)/,
    entry_path: /(入口|路径|后台|菜单|页面|路由|在哪|位置|设置|配置)/i,
    permission_or_role: /(权限|角色|permission|role|admin|manage|管理员|可进入)/i,
    configurable_items: /(可配置|配置项|基本信息|价格|封面|服务|班主任|教师|助教|课程管理|学员管理|参数)/,
    operation_method: /(通过|执行|运行|触发|步骤|处理方式|可以|可通过|任务|脚本|命令|入口)/,
    command_or_entry: /(命令|命令行|console|command|cli|app\/console|bin\/console|入口|路径|任务|脚本)/i,
    scope_or_parameters: /(参数|范围|月份|时间|指定|对象|--[a-z0-9-]+|yyyy|month|scope)/i,
    verification_or_caveat: /(验证|校验|确认|检查|注意|风险|前置|执行后|适用条件)/,
    observed_symptom: /(现象|失败|异常|报错|无法|不生效|缺少|没有数据|500|错误)/i,
    cause_or_likely_cause: /(原因|因为|导致|触发|根因|可能是|推断|配置|代码|数据)/,
    next_action: /(下一步|处理|建议|验证|检查|补充|升级|修复|确认)/,
    classification: /(bug|设计|配置|使用|操作|不能确认|归类|属于)/i,
    basis: /(依据|证据|因为|规则|代码|日志|来源|支撑)/,
    rule_summary: /(规则|机制|标准|限制|政策|条件).{0,40}(是|为|指|说明|要求)/,
    applicability: /(适用|用于|面向|当|如果|场景|对象|条件)/,
    edge_cases: /(边界|例外|限制|注意|不支持|不能|除非|未知)/,
    direct_answer: /./,
  };
  return (patterns[requirementId] ?? /./).test(normalized);
}
