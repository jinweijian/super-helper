import type { Evidence } from '../../domain.js';
import type { HistoricalCaseSourceStatus } from '../../mcp/historical-case-evidence-service.js';
import type { CoverageEvidenceEnvelope } from '../coverage-evidence-provenance.js';
import type {
  HistoricalClassification,
  HistoricalLead,
  HistoricalVerification,
} from './contracts.js';

export interface HistoricalGateDecision {
  leadId: string;
  hypothesis: string;
  classification: HistoricalClassification;
  evidenceIds: string[];
}

export interface HistoricalGateResult {
  decisions: HistoricalGateDecision[];
  blockers: string[];
}

export function gateHistoricalCases(input: {
  currentRunId: string;
  redmineStatus: HistoricalCaseSourceStatus;
  workerStatus: 'completed' | 'rejected' | 'failed' | 'skipped';
  knowledgeConflicts: boolean;
  leads: HistoricalLead[];
  verifications: HistoricalVerification[];
  evidence: Evidence[];
  coverageEvidenceEnvelopes: CoverageEvidenceEnvelope[];
}): HistoricalGateResult {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const envelopeById = new Map(input.coverageEvidenceEnvelopes.map((item) => [item.evidenceId, item]));
  const blockers = new Set<string>();
  const verificationByLead = new Map(input.verifications.map((item) => [item.leadId, item]));
  const decisions = input.leads.map((lead): HistoricalGateDecision => {
    const verification = verificationByLead.get(lead.id);
    if (!verification) {
      blockers.add('verification_missing');
      return directionOnly(lead, lead.evidenceIds);
    }
    const referencedIds = unique([
      ...verification.historicalEvidenceIds,
      ...verification.currentEvidenceIds,
      ...verification.supportingEvidenceIds,
      ...verification.conflictingEvidenceIds,
    ]);
    if (referencedIds.some((id) => !evidenceById.has(id))) {
      blockers.add('evidence_reference_invalid');
      if (verification.currentEvidenceIds.every((id) => !evidenceById.has(id))) {
        blockers.add('current_evidence_missing');
      }
      return directionOnly(lead, lead.evidenceIds);
    }
    if (verification.classification !== 'same_root_cause_likely') {
      return {
        leadId: lead.id,
        hypothesis: lead.hypothesis,
        classification: verification.classification,
        evidenceIds: unique([...lead.evidenceIds, ...referencedIds]),
      };
    }
    if (input.redmineStatus !== 'completed') blockers.add('historical_source_incomplete');
    const historicalEvidenceIds = verification.historicalEvidenceIds.filter((id) => (
      evidenceById.get(id)?.kind === 'mcp' && validHistoricalEnvelope(envelopeById.get(id), input.currentRunId)
    ));
    const currentCandidates = verification.currentEvidenceIds.filter((id) => {
      const kind = evidenceById.get(id)?.kind;
      return kind === 'workspace' || kind === 'log';
    });
    const currentEvidenceIds = currentCandidates.filter((id) => (
      validCurrentEnvelope(envelopeById.get(id), input.currentRunId)
    ));
    if (historicalEvidenceIds.length === 0) blockers.add('current_run_provenance_missing');
    if (currentCandidates.length === 0) blockers.add('current_evidence_missing');
    else if (currentEvidenceIds.length === 0) blockers.add('current_run_provenance_missing');
    if (input.workerStatus !== 'completed') blockers.add('worker_verification_incomplete');
    if (verification.conflictingEvidenceIds.length > 0) blockers.add('current_evidence_conflict');
    if (input.knowledgeConflicts) blockers.add('knowledge_conflict');

    const canConfirm = input.redmineStatus === 'completed'
      && input.workerStatus === 'completed'
      && historicalEvidenceIds.length > 0
      && currentEvidenceIds.length > 0
      && verification.conflictingEvidenceIds.length === 0
      && !input.knowledgeConflicts;
    return canConfirm
      ? {
          leadId: lead.id,
          hypothesis: lead.hypothesis,
          classification: 'same_root_cause_likely',
          evidenceIds: unique([...historicalEvidenceIds, ...currentEvidenceIds]),
        }
      : directionOnly(lead, unique([...lead.evidenceIds, ...currentEvidenceIds]));
  });
  return { decisions, blockers: [...blockers] };
}

function validHistoricalEnvelope(envelope: CoverageEvidenceEnvelope | undefined, runId: string): boolean {
  return Boolean(envelope && envelope.kind === 'mcp' && envelope.freshness === 'current_mcp_call'
    && envelope.runId === runId && envelope.validated && envelope.readOnly && envelope.allowlisted && envelope.completed);
}

function validCurrentEnvelope(envelope: CoverageEvidenceEnvelope | undefined, runId: string): boolean {
  return Boolean(envelope && envelope.runId === runId && envelope.validated && (
    (envelope.kind === 'workspace' && envelope.freshness === 'current_worker_run') ||
    (envelope.kind === 'log' && envelope.freshness === 'current_log_excerpt')
  ));
}

function directionOnly(lead: HistoricalLead, evidenceIds: string[]): HistoricalGateDecision {
  return {
    leadId: lead.id,
    hypothesis: lead.hypothesis,
    classification: 'diagnostic_lead_only',
    evidenceIds: unique(evidenceIds),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
