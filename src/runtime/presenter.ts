import type { DiagnosticClaim, DiagnosticResult, UserPersona, WorkerTrace } from '../domain.js';

export function formatPreflightQuestion(question: string, missingInfo: string[]): string {
  return `我现在还不能判断原因，缺少关键信息：${missingInfo.join('、')}。\n\n${question}`;
}

export function ruleBasedReviewAndFormat(result: DiagnosticResult, persona: UserPersona, userGoal?: string): string {
  const unsupportedFacts = result.claims.filter((claim) => claim.type === 'fact' && claim.evidenceIds.length === 0);
  const supportedClaims = result.claims.filter((claim) => claim.type !== 'fact' || claim.evidenceIds.length > 0);
  if (unsupportedFacts.length > 0 && supportedClaims.length === 0) {
    return 'Claude Code 返回了没有证据支撑的事实判断，我不会把它作为结论展示。\n\n请补充更多可验证信息，或查看诊断日志让技术支持复核。';
  }

  if (result.recommendedNextAction === 'ask_user' || result.status === 'need_input') {
    const missing = result.missingInfo.length > 0 ? result.missingInfo.join('、') : '可验证证据';
    return `目前证据不足，还不能最终定位。\n\n请补充：${missing}。\n\n如果不清楚，可以直接回复“不清楚”，我会按现有信息继续低置信度排查。`;
  }

  if (/Q2|event_v2|finished_prompt|CourseTaskEventV2/i.test(userGoal ?? result.summary)) {
    return formatQ2Result(result, unsupportedFacts);
  }

  const evidence = result.evidence.length
    ? result.evidence.map((item, index) => `${index + 1}. ${item.summary}（来源：${item.source}，可信度：${item.confidence}）`).join('\n')
    : '暂无可展示证据。';

  const assumptions = result.claims.filter((claim) => claim.type === 'assumption' || claim.type === 'inference');
  const caution = assumptions.length
    ? `\n\n仍需注意：\n${assumptions.map((claim, index) => `${index + 1}. ${claim.text}`).join('\n')}`
    : '';

  const intro = persona === 'developer'
    ? `目前判断：${result.summary}`
    : `目前判断：${result.summary}\n\n我会先讲对业务操作有用的结论；代码路径只作为证据放在下面。`;
  const omitted = unsupportedFacts.length
    ? `\n\n未采纳的无证据说法：\n${unsupportedFacts.map((claim, index) => `${index + 1}. ${claim.text}`).join('\n')}`
    : '';
  return `${intro}\n\n支撑证据：\n${evidence}${caution}${omitted}`;
}

export function formatReviewFailureFallback(
  result: DiagnosticResult,
  persona: UserPersona,
  userGoal: string | undefined,
  trace: WorkerTrace | undefined,
  reviewError: string,
): string {
  if (trace && workerFailedBeforeResult(trace)) {
    return formatWorkerFailureResult(result, trace);
  }

  const rawResult = extractWorkerResultText(trace?.stdout) ?? trace?.stdout.trim();
  if (rawResult) {
    return [
      '美化输出 Agent 调用模型失败，先直接展示 Claude Code 返回的原始内容。',
      `失败原因：${reviewError}`,
      '<pre>',
      rawResult,
      '</pre>',
    ].join('\n\n');
  }

  return [
    `美化输出 Agent 调用模型失败：${reviewError}`,
    '没有可展示的 Claude Code 原始内容，已退回本地审核结果。',
    ruleBasedReviewAndFormat(result, persona, userGoal),
  ].join('\n\n');
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

${result.summary}

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

function formatWorkerFailureResult(result: DiagnosticResult, trace: WorkerTrace): string {
  const details = [
    trace.exitCode !== undefined ? `exitCode=${trace.exitCode}` : '',
    trace.signal ? `signal=${trace.signal}` : '',
    trace.error ? `error=${trace.error}` : '',
    trace.stderr.trim() ? `stderr:\n${trace.stderr.trim()}` : '',
    trace.stdout.trim() ? `stdout:\n${trace.stdout.trim()}` : '',
  ].filter(Boolean).join('\n\n');

  return [
    'Claude Code 在产生可展示结果前失败，直接展示错误结果。',
    `错误结果：${result.summary}`,
    details ? `错误详情：\n\n<pre>\n${details}\n</pre>` : '',
  ].filter(Boolean).join('\n\n');
}

function extractWorkerResultText(stdout?: string): string | undefined {
  const raw = stdout?.trim();
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as { result?: unknown };
    if (typeof parsed.result === 'string' && parsed.result.trim()) {
      return parsed.result.trim();
    }
  } catch {
    return undefined;
  }

  return undefined;
}
