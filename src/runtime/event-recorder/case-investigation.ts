import type { DiagnosticLogEvent } from '../../domain.js';
import type { StoredCase } from '../../sessions/case-repository.js';
import { agentIdentities, type EventRecorderSink } from './base.js';

type SourceStatus = 'completed' | 'no_hit' | 'timeout' | 'failed';
type WorkerStatus = 'completed' | 'skipped' | 'rejected' | 'failed';

export interface HistoricalSearchEventDetail {
  runId: string;
  status: SourceStatus;
  candidateCount: number;
  detailCount: number;
  evidenceIds: string[];
  durationMs: number;
  degraded: boolean;
}

export interface HistoricalAnalysisEventDetail {
  runId: string;
  status: SourceStatus;
  leadCount: number;
  leadIds: string[];
  evidenceIds: string[];
  durationMs: number;
  degraded: boolean;
}

export interface CurrentVerificationEventDetail {
  runId: string;
  status: WorkerStatus;
  workerInvoked: boolean;
  evidenceCount: number;
  evidenceIds: string[];
  durationMs: number;
}

export interface HistoricalCrossReviewEventDetail {
  runId: string;
  verificationCount: number;
  classificationCounts: {
    sameRootCauseLikely: number;
    sameSymptomDifferentCause: number;
    diagnosticLeadOnly: number;
    irrelevant: number;
  };
  evidenceIds: string[];
  durationMs: number;
  degraded: boolean;
}

export function createCaseInvestigationEvents(sink: EventRecorderSink) {
  return {
    historicalCaseSearchStarted(caseSession: StoredCase, detail: { runId: string }): DiagnosticLogEvent {
      return sink.record(caseSession, {
        actor: 'mcp', phase: 'historical_case_search_started', label: '查询工单', severity: 'info',
        summary: 'Redmine 工单源开始执行只读历史案例查询', detail: { runId: safeId(detail.runId) },
      });
    },

    historicalCaseSearchCompleted(caseSession: StoredCase, detail: HistoricalSearchEventDetail): DiagnosticLogEvent {
      const safe = {
        runId: safeId(detail.runId), status: detail.status,
        candidateCount: safeCount(detail.candidateCount), detailCount: safeCount(detail.detailCount),
        evidenceIds: safeIds(detail.evidenceIds), durationMs: safeDuration(detail.durationMs), degraded: Boolean(detail.degraded),
      };
      return sink.record(caseSession, {
        actor: 'mcp', phase: 'historical_case_search_completed', label: '查询工单',
        severity: detail.status === 'completed' ? 'ok' : detail.status === 'no_hit' ? 'warn' : 'error',
        summary: `只读工单查询完成，候选 ${safe.candidateCount} 条，详情 ${safe.detailCount} 条`, detail: safe,
      });
    },

    historicalCaseAnalysisStarted(caseSession: StoredCase, detail: { runId: string; detailCount: number }): DiagnosticLogEvent {
      return sink.recordAgent(caseSession, agentIdentities.historicalAnalyzer, {
        actor: 'agent', phase: 'historical_case_analysis_started', label: '分析案例', severity: 'info',
        summary: '历史案例分析 Agent 开始提取可验证排查线索',
        detail: { runId: safeId(detail.runId), detailCount: safeCount(detail.detailCount) },
      });
    },

    historicalCaseAnalysisCompleted(caseSession: StoredCase, detail: HistoricalAnalysisEventDetail): DiagnosticLogEvent {
      const safe = {
        runId: safeId(detail.runId), status: detail.status, leadCount: safeCount(detail.leadCount),
        leadIds: safeIds(detail.leadIds), evidenceIds: safeIds(detail.evidenceIds),
        durationMs: safeDuration(detail.durationMs), degraded: Boolean(detail.degraded),
      };
      return sink.recordAgent(caseSession, agentIdentities.historicalAnalyzer, {
        actor: 'agent', phase: 'historical_case_analysis_completed', label: '分析案例',
        severity: detail.status === 'completed' && !detail.degraded ? 'ok' : 'warn',
        summary: `历史案例分析完成，形成 ${safe.leadCount} 条只读核验线索`, detail: safe,
      });
    },

    currentProjectVerificationStarted(
      caseSession: StoredCase,
      detail: { runId: string; workerInvoked: boolean; leadCount: number },
    ): DiagnosticLogEvent {
      return sink.record(caseSession, {
        actor: 'claude', phase: 'current_project_verification_started', label: '验证当前项目', severity: 'info',
        summary: detail.workerInvoked ? 'Claude Code Worker 开始只读验证当前项目' : '当前项目验证无需调用 Worker',
        detail: {
          runId: safeId(detail.runId), workerInvoked: Boolean(detail.workerInvoked), leadCount: safeCount(detail.leadCount),
        },
      });
    },

    currentProjectVerificationCompleted(caseSession: StoredCase, detail: CurrentVerificationEventDetail): DiagnosticLogEvent {
      const safe = {
        runId: safeId(detail.runId), status: detail.status, workerInvoked: Boolean(detail.workerInvoked),
        evidenceCount: safeCount(detail.evidenceCount), evidenceIds: safeIds(detail.evidenceIds), durationMs: safeDuration(detail.durationMs),
      };
      return sink.record(caseSession, {
        actor: 'claude', phase: 'current_project_verification_completed', label: '验证当前项目',
        severity: detail.status === 'completed' || detail.status === 'skipped' ? 'ok' : 'warn',
        summary: `当前项目只读验证完成，获得 ${safe.evidenceCount} 条当前证据`, detail: safe,
      });
    },

    historicalCrossReviewStarted(caseSession: StoredCase, detail: { runId: string; leadCount: number }): DiagnosticLogEvent {
      return sink.recordAgent(caseSession, agentIdentities.historicalVerifier, {
        actor: 'agent', phase: 'historical_cross_review_started', label: '交叉审核', severity: 'info',
        summary: '历史案例验证 Agent 开始交叉审核历史与当前证据',
        detail: { runId: safeId(detail.runId), leadCount: safeCount(detail.leadCount) },
      });
    },

    historicalCrossReviewCompleted(caseSession: StoredCase, detail: HistoricalCrossReviewEventDetail): DiagnosticLogEvent {
      const safe = {
        runId: safeId(detail.runId), verificationCount: safeCount(detail.verificationCount),
        classificationCounts: {
          sameRootCauseLikely: safeCount(detail.classificationCounts.sameRootCauseLikely),
          sameSymptomDifferentCause: safeCount(detail.classificationCounts.sameSymptomDifferentCause),
          diagnosticLeadOnly: safeCount(detail.classificationCounts.diagnosticLeadOnly),
          irrelevant: safeCount(detail.classificationCounts.irrelevant),
        },
        evidenceIds: safeIds(detail.evidenceIds), durationMs: safeDuration(detail.durationMs), degraded: Boolean(detail.degraded),
      };
      return sink.recordAgent(caseSession, agentIdentities.historicalVerifier, {
        actor: 'agent', phase: 'historical_cross_review_completed', label: '交叉审核',
        severity: detail.degraded ? 'warn' : 'ok', summary: `历史与当前证据交叉审核完成，共 ${safe.verificationCount} 条判断`, detail: safe,
      });
    },
  };
}

function safeId(value: string): string {
  return Array.from(value).slice(0, 128).join('').replace(/[^A-Za-z0-9:_-]/g, '_');
}

function safeIds(values: string[]): string[] {
  return [...new Set(values.slice(0, 20).map(safeId).filter(Boolean))];
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.trunc(value))) : 0;
}

function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(3_600_000, Math.trunc(value))) : 0;
}

export type CaseInvestigationEvents = ReturnType<typeof createCaseInvestigationEvents>;
