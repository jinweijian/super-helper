export interface AgentIdentity {
  agentId: string;
  agentRole: string;
  agentName: string;
}

export const agentIdentities = {
  main: { agentId: 'main', agentRole: 'main-coordinator', agentName: '主 Agent' },
  inputReview: { agentId: 'input-review', agentRole: 'input-review-and-preflight', agentName: '输入审核 Agent' },
  experience: { agentId: 'experience', agentRole: 'prior-session-experience-review', agentName: '经验 Agent' },
  knowledgeRouter: { agentId: 'knowledge-router', agentRole: 'knowledge-router', agentName: '知识路由 Agent' },
  evidenceJudge: { agentId: 'evidence-judge', agentRole: 'evidence-sufficiency-judge', agentName: '证据充分性 Agent' },
  caseCurator: { agentId: 'case-curator', agentRole: 'solved-case-curator', agentName: 'Case 沉淀 Agent' },
  outputReview: { agentId: 'output-review', agentRole: 'evidence-and-output-review', agentName: '输出审核 Agent' },
  presentation: { agentId: 'presentation', agentRole: 'persona-aware-presentation', agentName: '美化输出 Agent' },
} satisfies Record<string, AgentIdentity>;
