import type { CaseSession, DiagnosticRequest, HelperAgentConfig } from './domain.js';

export interface PreflightInput {
  caseSession: CaseSession;
  userMessage: string;
  agentConfig: HelperAgentConfig;
  allowedMcpToolIds?: string[];
}

export type PreflightDecision =
  | {
      action: 'ask_user';
      question: string;
      missingInfo: string[];
    }
  | {
      action: 'dispatch';
      request: DiagnosticRequest;
    };

const REQUIRED_SIGNALS = [
  {
    key: 'problem',
    label: '具体问题现象',
    test: (text: string) => text.trim().length >= 8,
  },
  {
    key: 'workspace',
    label: '目标 workspace',
    test: (_text: string, input: PreflightInput) => Boolean(input.caseSession.workspaceId),
  },
  {
    key: 'diagnostic_signal',
    label: '具体报错、受影响功能、复现步骤、项目文件或关键对象',
    test: (text: string) => hasActionableSignal(text),
  },
];

function hasActionableSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  const patterns = [
    /\b(4\d\d|5\d\d)\b/,
    /error|exception|traceid|stack|timeout|failed|failure/,
    /package\.json|tsconfig|readme|agent\.md|claude\.md|路由|route|router|controller|service|component|组件|配置|文件|目录|函数|类|代码|项目|workspace/,
    /哪里|在哪|如何|怎么|什么|解释|说明|查找|定位|找一下|看一下/,
    /报错|失败|异常|无法|打不开|保存|接口|日志|复现|截图|页面|服务器|数据库|慢|卡|崩/,
    /id\s*[:：=]?\s*\d+/i,
    /\/[a-z0-9_\-/?=&]+/i,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

export function preflight(input: PreflightInput): PreflightDecision {
  const contextText = input.caseSession.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.body)
    .join('\n');
  const isUnknownAnswer = /^(不清楚|不知道|没有|暂时不清楚|unknown|not sure)$/i.test(input.userMessage.trim());
  const hasPendingHelperQuestion = input.caseSession.messages.some(
    (message) => message.role === 'helper' && /缺少|请补充|不能判断/.test(message.body),
  );
  const textForSignals = isUnknownAnswer ? contextText : `${contextText}\n${input.userMessage}`;
  const missingInfo = REQUIRED_SIGNALS
    .filter((signal) => !signal.test(textForSignals, input))
    .map((signal) => signal.label);

  const shouldContinueWithUnknown =
    input.agentConfig.rules.allowUnknownAnswer &&
    isUnknownAnswer &&
    hasPendingHelperQuestion &&
    contextText.trim().length > 0;

  if (input.agentConfig.rules.askWhenMissingRequiredInfo && missingInfo.length > 0 && !shouldContinueWithUnknown) {
    return {
      action: 'ask_user',
      missingInfo,
      question: `为了避免无证据猜测，请先补充：${missingInfo.join('、')}。如果不清楚，可以直接回答“不清楚”。`,
    };
  }

  const latestRunNumber = input.caseSession.runs.length + 1;
  const knownFacts = Array.from(
    new Set(
      input.caseSession.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.body.trim())
        .filter(Boolean),
    ),
  );
  const userGoal = isUnknownAnswer
    ? knownFacts.find((fact) => !/^(不清楚|不知道|没有|暂时不清楚|unknown|not sure)$/i.test(fact)) ?? input.userMessage
    : input.userMessage;

  return {
    action: 'dispatch',
    request: {
      caseId: input.caseSession.id,
      runId: `run_${String(latestRunNumber).padStart(2, '0')}`,
      workspaceId: input.caseSession.workspaceId,
      claudeSessionId: input.caseSession.claudeSessionId,
      userGoal,
      knownFacts,
      unknowns: shouldContinueWithUnknown ? missingInfo : [],
      constraints: [
        'Claude Code is an inspection tool and must not respond directly to the user.',
        'Handle both troubleshooting requests and general project questions.',
        'Return structured evidence, assumptions, missing information, and recommended next action.',
        'Do not make final claims without evidence.',
      ],
      allowedMcpToolIds: input.allowedMcpToolIds ?? [],
    },
  };
}
