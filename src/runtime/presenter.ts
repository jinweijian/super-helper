import type { DiagnosticClaim, DiagnosticResult, UserPersona, WorkerTrace } from '../domain.js';
import { validateDiagnosticResult } from './result-validator.js';

export function formatPreflightQuestion(question: string, missingInfo: string[]): string {
  return `我现在还不能判断原因，缺少关键信息：${missingInfo.join('、')}。\n\n${question}`;
}

export function ruleBasedReviewAndFormat(result: DiagnosticResult, persona: UserPersona, userGoal?: string): string {
  result = validateDiagnosticResult(result).result;
  const unsupportedFacts = result.claims.filter((claim) => claim.type === 'fact' && claim.evidenceIds.length === 0);
  const supportedClaims = result.claims.filter((claim) => claim.type !== 'fact' || claim.evidenceIds.length > 0);
  const primaryClaim = supportedClaims.find((claim) => claim.type === 'fact' || claim.type === 'inference')?.text;
  if (unsupportedFacts.length > 0 && supportedClaims.length === 0) {
    return '目前证据不足，暂不能形成结论。\n\n**仍需确认：** 缺少可验证的 medium/high confidence 证据。\n\n**下一步：** 请补充更多可验证信息，或查看诊断日志让技术支持复核。';
  }

  if (result.recommendedNextAction === 'ask_user' || result.status === 'need_input') {
    const missing = result.missingInfo.length > 0 ? result.missingInfo.join('、') : '可验证证据';
    if (result.status !== 'need_input' && (result.evidence.length > 0 || supportedClaims.length > 0)) {
      return formatPersonaReply({
        persona,
        conclusion: primaryClaim ?? '现有证据仍不足以形成事实结论',
        result,
        mode: 'partial',
        missing,
      });
    }
    return formatPersonaReply({
      persona,
      conclusion: '目前证据不足，还不能最终定位',
      result,
      mode: 'need_input',
      missing,
    });
  }

  if (/Q2|event_v2|finished_prompt|CourseTaskEventV2/i.test(userGoal ?? result.summary)) {
    return formatQ2Result(result, unsupportedFacts);
  }

  const groundedConclusion = primaryClaim ?? '当前没有通过审核的事实结论';
  return formatPersonaReply({
    persona,
    conclusion: groundedConclusion,
    result,
    mode: result.status === 'concluded' || result.recommendedNextAction === 'final_answer' ? 'final' : 'partial',
    missing: result.missingInfo.join('、'),
    unsupportedFacts,
  });
}

export function formatReviewFailureFallback(
  result: DiagnosticResult,
  persona: UserPersona,
  userGoal: string | undefined,
  trace: WorkerTrace | undefined,
  _reviewError: string,
  identity?: { caseId: string; runId: string },
): string {
  if (trace && workerFailedBeforeResult(trace)) {
    return formatWorkerFailureResult(result, trace, identity);
  }

  return ruleBasedReviewAndFormat(result, persona, userGoal);
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
      avoid: '避免把代码路径作为主叙事，必要时只放在证据里',
      askFor: '页面、课程/订单/用户等业务对象、现象截图或时间范围',
    },
    support: {
      focus: '复现信息、影响范围、排查路径、需要转交给研发的证据',
      avoid: '避免无证据定责',
      askFor: '账号角色、环境、URL、报错信息、复现步骤',
    },
    customer: {
      focus: '发生了什么、能做什么、什么时候需要人工介入',
      avoid: '避免内部系统名和代码细节',
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

type ReplyMode = 'final' | 'partial' | 'need_input';

function formatPersonaReply(input: {
  persona: UserPersona;
  conclusion: string;
  result: DiagnosticResult;
  mode: ReplyMode;
  missing?: string;
  unsupportedFacts?: DiagnosticClaim[];
}): string {
  const missing = input.missing || input.result.missingInfo.join('、');
  const conclusion = input.mode === 'partial'
    ? `初步判断：${input.conclusion}`
    : input.conclusion;
  switch (input.persona) {
    case 'developer':
      return developerReply(conclusion, input.result, input.mode, missing, input.unsupportedFacts ?? []);
    case 'support':
      return supportReply(conclusion, input.result, input.mode, missing, input.unsupportedFacts ?? []);
    case 'customer':
      return customerReply(conclusion, input.result, input.mode, missing);
    case 'operations':
    default:
      return operationsReply(conclusion, input.result, input.mode, missing, input.unsupportedFacts ?? []);
  }
}

function operationsReply(
  conclusion: string,
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
  unsupportedFacts: DiagnosticClaim[],
): string {
  const safeConclusion = redactInternalKnowledgePath(conclusion);
  const category = mode === 'need_input' ? '目前不能确认' : operationsCategory(safeConclusion, result);
  const lines = [
    `**结论：${category}。${safeConclusion}**`,
    '',
    `**对业务的影响：** ${operationsImpact(category, mode)}`,
    '',
    '**你可以怎么处理：**',
    '1. 先按上面的结论回复或处理当前业务问题。',
    '2. 如果现场现象和这个判断不一致，带上页面、角色、时间范围和现象截图升级给技术支持。',
  ];
  appendMissing(lines, missing, mode);
  appendUnsupported(lines, unsupportedFacts, redactInternalKnowledgePath);
  return lines.join('\n');
}

function developerReply(
  conclusion: string,
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
  unsupportedFacts: DiagnosticClaim[],
): string {
  const evidence = result.evidence[0];
  const source = evidence?.source ? `先查 ${evidence.source}` : '先查与问题直接相关的入口、接口、日志或配置';
  const basis = evidence?.summary ?? result.summary;
  const lines = [
    `**结论：${conclusion}**`,
    '',
    `**定位依据：** ${basis || '当前还没有足够证据形成定位依据。'}`,
    '',
    '**下一步排查：**',
    `1. ${source}。`,
    '2. 用同一复现条件确认代码路径、配置值或日志是否一致。',
    `3. ${missing ? `补充 ${missing} 后再确认边界。` : '如果仍不一致，再补充 trace、请求参数、环境和版本信息。'}`,
  ];
  appendRisk(lines, missing, mode);
  appendUnsupported(lines, unsupportedFacts);
  return lines.join('\n');
}

function supportReply(
  conclusion: string,
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
  unsupportedFacts: DiagnosticClaim[],
): string {
  const lines = [
    `**结论：${conclusion}**`,
    '',
    '**建议处理：**',
    '1. 先把结论转成客户能理解的话回复，避免直接贴代码路径。',
    '2. 需要研发确认时，附上 caseId/runId、用户最后一句话和下方折叠证据。',
    '3. 如果影响范围扩大或结论与现场不一致，按升级工单处理。',
  ];
  appendMissing(lines, missing, mode, '**需要补充：**');
  appendUnsupported(lines, unsupportedFacts);
  return lines.join('\n');
}

function customerReply(
  conclusion: string,
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
): string {
  const lines = [
    `**结论：${customerSafeConclusion(conclusion)}**`,
    '',
    '**你现在可以这样做：**',
    '1. 先按上面的说明检查当前页面或操作步骤。',
    '2. 如果仍然无法完成，请把页面、操作步骤和看到的提示发给人工支持。',
  ];
  const note = mode === 'need_input'
    ? `还需要确认：${missing || '具体页面和提示'}。`
    : '证据细节已保留在诊断记录中，人工支持可以继续查看。';
  lines.push('', `**说明：** ${note}`);
  return lines.join('\n');
}

function operationsCategory(conclusion: string, result: DiagnosticResult): string {
  const text = `${conclusion}\n${result.summary}`.toLowerCase();
  if (/bug|缺陷|异常|报错|错误|失败|\b5\d\d\b|exception|error/.test(text)) {
    return '系统 bug';
  }
  if (result.evidence.some((item) => item.kind === 'knowledge')) {
    return '设计使然';
  }
  if (/设计|规则|预期|限制|不支持|使然|产品行为/.test(text)) {
    return '设计使然';
  }
  if (/配置|设置|开关|开启|启用|参数|后台|入口|权限|角色|控制/.test(text)) {
    return '配置或使用问题';
  }
  return result.status === 'concluded' || result.recommendedNextAction === 'final_answer'
    ? '目前不能确认归类'
    : '目前不能确认';
}

function operationsImpact(category: string, mode: ReplyMode): string {
  if (mode === 'need_input') {
    return '现在还不能判断影响范围，先补齐关键信息再对外给确定说法。';
  }
  if (category === '系统 bug') {
    return '可能影响用户正常操作，建议先记录影响范围并升级确认。';
  }
  if (category === '设计使然') {
    return '更适合按产品规则解释，除非现场表现和规则不一致。';
  }
  if (category === '配置或使用问题') {
    return '优先检查后台配置、角色权限或使用路径，通常不需要直接定性为缺陷。';
  }
  return '当前只能作为低置信度判断，不建议直接对外定责。';
}

function appendMissing(lines: string[], missing: string, mode: ReplyMode, label = '**仍需确认：**'): void {
  if (missing || mode !== 'final') {
    lines.push('', `${label} ${missing || '暂无阻塞项；如现场不一致，再补充页面、账号角色和时间范围。'}`);
  }
}

function appendRisk(lines: string[], missing: string, mode: ReplyMode): void {
  if (missing || mode !== 'final') {
    lines.push('', `**风险或未知：** ${missing || '暂无阻塞项；仍需用实际环境复现确认。'}`);
  }
}

function appendUnsupported(
  lines: string[],
  unsupportedFacts: DiagnosticClaim[],
  sanitize: (text: string) => string = (text) => text,
): void {
  if (unsupportedFacts.length > 0) {
    lines.push('', `**未采纳：** ${unsupportedFacts.map((claim) => sanitize(claim.text)).join('；')}`);
  }
}

function customerSafeConclusion(conclusion: string): string {
  return conclusion.replace(/\b(src|app|packages?|node_modules|vendor)\/[^\s，。；)）]+/g, '相关系统位置');
}

function redactInternalKnowledgePath(text: string): string {
  return text.replace(/knowledge\/_sources\/whitepapers\/[^\s，。；)）\]]+/g, '原始白皮书资料');
}

function formatQ2Result(result: DiagnosticResult, unsupportedFacts: DiagnosticClaim[]): string {
  const claimTexts = result.claims.filter((claim) => claim.type !== 'fact' || claim.evidenceIds.length > 0).map((claim) => claim.text);
  const pick = (...patterns: RegExp[]): string[] =>
    claimTexts.filter((text) => patterns.some((pattern) => pattern.test(text)));
  const section = (title: string, items: string[], fallback = '当前结构化证据不足，无法确认。'): string =>
    `## ${title}\n\n${items.length ? items.map((item) => `- ${item}`).join('\n') : fallback}`;

  const entries = pick(/入口|CourseTaskEventV2|TaskController|finished_prompt/i);
  const start = pick(/^start|start事件|createLearnFlow|学习流/i);
  const doing = pick(/^doing|doing事件|watchData|duration|trigger/i);
  const finishedPrompt = pick(/finished_prompt|taskFinishedPromptAction|enableFinish|nextTask|learningProgress/i);
  const dataFlow = pick(/sign|learn_flow|record|task_result|lastLearnTime|isFinished|finishTaskResult|watching/i);
  const serviceRoles = pick(/DataCollectService|TaskService|TaskResultService|LearningDataAnalysisService|LearnControlService/i);

  const evidence = result.evidence.length
    ? result.evidence.map((item) => `- ${item.source}: ${item.summary}（${item.confidence}）`).join('\n')
    : '- 暂无可展示证据。';
  const risks = [
    ...pick(/watchData\.duration|enableFinish|finishType|live|防多开|旧版events/i),
    '如果 learnedTime/watchTime 与活动 finishType 不匹配，可能导致任务看似有学习记录但不满足完成条件。',
    '如果前端上报的 lastLearnTime、duration 或 watchData.duration 异常，可能造成学习时长偏差。',
  ];
  const gaps = [
    ...result.missingInfo,
    ...unsupportedFacts.map((claim) => `未采纳：${claim.text}`),
  ];

  return `# Q2 分析结果

## 一句话结论

${result.claims.find((claim) => claim.type === 'fact' || claim.type === 'inference')?.text ?? '当前没有通过审核的事实结论。'}

${section('接口入口', entries)}

${section('start 流程', start)}

${section('doing 流程', doing)}

${section('finished_prompt 流程', finishedPrompt)}

${section('核心状态与数据流', dataFlow)}

## 关键文件和方法

${evidence}

${section('相关服务职责', serviceRoles)}

${section('可能导致学习时长异常或任务无法完成的原因', Array.from(new Set(risks)))}

## 不确定点与证据缺口

${gaps.length ? gaps.map((item) => `- ${item}`).join('\n') : '- 暂无阻塞性缺口；无 evidenceIds 的说法已自动排除。'}`;
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
