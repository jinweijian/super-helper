import type { SuperHelperConfig } from '../config.js';
import type { HelperAgentConfig } from '../domain.js';
import { preflight, type PreflightDecision } from './preflight-decision.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import { attachCaseContext, personaDiagnosticConstraints } from './request-builder.js';

export function buildLocalPreflightDecision(input: {
  config: SuperHelperConfig;
  caseSession: StoredCase;
  userMessage: string;
}): PreflightDecision {
  const { config, caseSession, userMessage } = input;
  const localDecision = preflight({
    caseSession,
    userMessage,
    agentConfig: helperAgentConfig(config),
    allowedMcpToolIds: config.workspaces.find((workspace) => workspace.id === caseSession.workspaceId)?.mcpToolIds ?? [],
  });
  if (localDecision.action === 'dispatch') {
    localDecision.request.userPersona = caseSession.userPersona;
    localDecision.request.constraints = Array.from(
      new Set([
        ...localDecision.request.constraints,
        ...personaDiagnosticConstraints(caseSession.userPersona),
      ]),
    );
    attachCaseContext(caseSession, localDecision.request);
  }
  return localDecision;
}

export function helperAgentConfig(config: SuperHelperConfig): HelperAgentConfig {
  return {
    id: 'default-helper-agent',
    name: config.agent.name,
    language: config.agent.language,
    tone: config.agent.tone,
    defaultPermission: 'read_only',
    rules: {
      noGuessing: true,
      requireEvidenceForConclusion: true,
      askWhenMissingRequiredInfo: true,
      allowUnknownAnswer: true,
      distinguishFactInferenceAssumption: true,
    },
  };
}

export function summarizePreflightDecision(decision: PreflightDecision): Record<string, unknown> {
  if (decision.action === 'ask_user') {
    return {
      action: 'ask_user',
      missingInfo: decision.missingInfo,
      question: decision.question,
    };
  }

  return {
    action: 'dispatch',
    answerGoal: decision.request.answerGoal,
    knownFacts: decision.request.knownFacts,
    unknowns: decision.request.unknowns,
    allowedMcpToolIds: decision.request.allowedMcpToolIds,
    reason: '当前 workspace 已选中，且用户输入包含可只读检索的业务或技术信号。',
  };
}

export function isGenericWorkspaceFollowUp(question: string, missingInfo: string[]): boolean {
  const text = `${question}\n${missingInfo.join('\n')}`.toLowerCase();
  const asksGenericWorkspaceContext =
    /产品|系统|项目|工作区|当前工作区|代码库|文档|wiki|目录|功能归属|后台|workspace|codebase|repository|repo/.test(text);
  const asksBlockingRuntimeSelector =
    /客户\s*id|客户编号|租户|tenant|trace\s*id|traceid|request\s*id|请求\s*id|订单|账号|用户\s*id|时间范围|具体时间|日志|服务器|环境|报错|错误信息|截图/.test(text);

  return asksGenericWorkspaceContext && !asksBlockingRuntimeSelector;
}
