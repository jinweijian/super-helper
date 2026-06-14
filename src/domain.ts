export type CaseStatus =
  | 'collecting_input'
  | 'ready_for_diagnosis'
  | 'diagnosing'
  | 'need_input'
  | 'partial'
  | 'concluded';

export type DiagnosticRunStatus =
  | 'queued'
  | 'running'
  | 'need_input'
  | 'partial'
  | 'concluded'
  | 'failed'
  | 'cancelled';

export type EvidenceKind =
  | 'workspace'
  | 'mcp'
  | 'manual'
  | 'knowledge'
  | 'history'
  | 'log'
  | 'unknown';

export type ClaimType = 'fact' | 'inference' | 'assumption' | 'unknown';

export type UserPersona = 'operations' | 'support' | 'customer' | 'developer';

export type LogSeverity = 'ok' | 'warn' | 'error' | 'info';

export interface ContextUsage {
  estimatedTokens: number;
  limitTokens: number;
  percent: number;
  level: 'ok' | 'warn' | 'error';
  available: boolean;
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  rootPath: string;
  claudeInstructionsPath?: string;
  mcpToolIds: string[];
}

export interface McpToolConfig {
  id: string;
  name: string;
  protocol: 'stdio' | 'http' | 'sse';
  permission: 'read_only' | 'read_write';
  enabled: boolean;
}

export interface HelperAgentConfig {
  id: string;
  name: string;
  language: 'zh-CN' | 'en-US';
  tone: 'calm_professional' | 'concise' | 'technical';
  defaultPermission: 'read_only';
  rules: {
    noGuessing: boolean;
    requireEvidenceForConclusion: boolean;
    askWhenMissingRequiredInfo: boolean;
    allowUnknownAnswer: boolean;
    distinguishFactInferenceAssumption: boolean;
  };
}

export interface CaseSession {
  id: string;
  claudeSessionId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  status: CaseStatus;
  userPersona: UserPersona;
  messages: CaseMessage[];
  runs: DiagnosticRun[];
  logs: DiagnosticLogEvent[];
  pinnedAt?: string;
  archivedAt?: string;
}

export interface CaseMessage {
  id: string;
  role: 'user' | 'helper' | 'system';
  body: string;
  createdAt: string;
  replyToMessageId?: string;
}

export interface DiagnosticRequest {
  caseId: string;
  runId: string;
  workspaceId: string;
  claudeSessionId: string;
  userGoal: string;
  knownFacts: string[];
  unknowns: string[];
  constraints: string[];
  allowedMcpToolIds: string[];
  userPersona?: UserPersona;
  context?: DiagnosticRequestContext;
}

export interface DiagnosticRequestContext {
  isFollowUp: boolean;
  currentUserMessage: string;
  recentMessages: Array<{
    role: CaseMessage['role'];
    body: string;
    createdAt: string;
  }>;
  previousRuns: Array<{
    runId: string;
    status: DiagnosticRunStatus;
    userGoal?: string;
    summary?: string;
    missingInfo: string[];
    evidence: Evidence[];
    claims: DiagnosticClaim[];
  }>;
  knowledge?: {
    route?: {
      normalizedQuestion: string;
      moduleCandidates: string[];
      intentCandidates: string[];
      keywords: string[];
      sourceTypes: string[];
      codeEscalationSignals: string[];
      risks: string[];
    };
    evidence: Array<{
      id: string;
      source: string;
      title: string;
      summary: string;
      confidence: 'low' | 'medium' | 'high';
      status: string;
      matchedTerms: string[];
    }>;
    judge: {
      answerable: boolean;
      confidence: 'low' | 'medium' | 'high';
      need_code_escalation: boolean;
      reason: string;
      evidence: string[];
      risks: string[];
      missing_info: string[];
      conflicts: string[];
      recommended_next_action: string;
      answer_score: number;
    };
  };
  deepQuery?: {
    permission: 'read_only';
    artifactTargets: string[];
    anchorTerms: string[];
    likelyPaths: string[];
    avoidAssumptions: string[];
    correctionActions: string[];
    attempt?: number;
    maxAttempts?: number;
    triedQueries?: string[];
    failedReasons?: string[];
    nextPivot?: string;
    stopReason?: 'max_attempts' | 'sufficient_evidence' | 'needs_user' | 'human_escalation';
    previousArtifactTargets?: string[];
  };
}

export interface DiagnosticRun {
  id: string;
  caseId: string;
  status: DiagnosticRunStatus;
  request?: DiagnosticRequest;
  result?: DiagnosticResult;
  workerTrace?: WorkerTrace;
}

export interface DiagnosticLogEvent {
  id: string;
  createdAt: string;
  actor: 'agent' | 'claude' | 'mcp' | 'system';
  phase: string;
  summary: string;
  severity?: LogSeverity;
  label?: string;
  detail?: unknown;
  agentId?: string;
  agentRole?: string;
  agentName?: string;
}

export interface WorkerTrace {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  signal?: string;
  error?: string;
  startedAt: string;
  finishedAt: string;
}

export interface ClaudeWorkerResponse {
  result: DiagnosticResult;
  trace: WorkerTrace;
}

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  source: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface DiagnosticClaim {
  type: ClaimType;
  text: string;
  evidenceIds: string[];
}

export interface DiagnosticResult {
  status: 'need_input' | 'partial' | 'concluded';
  summary: string;
  missingInfo: string[];
  evidence: Evidence[];
  claims: DiagnosticClaim[];
  recommendedNextAction:
    | 'ask_user'
    | 'continue_diagnosis'
    | 'final_answer'
    | 'escalate_to_human';
}
