import type { AnswerContract } from '../domain.js';
import type { KnowledgeEvidenceResult } from '../knowledge/index.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import { parseAgentModelJson } from './agent-model-review.js';

export type RagAnswerability = 'full' | 'partial' | 'none' | 'unknown';

export interface RagCoveredClaim {
  id: string;
  text: string;
  evidenceIds: string[];
  coveredRequirementIds: string[];
  usefulness: string;
}

export interface RagAnswerabilityResult {
  answerability: RagAnswerability;
  selectedEvidenceIds: string[];
  coveredClaims: RagCoveredClaim[];
  missingElements: string[];
  shouldEscalate: boolean;
  escalationFocus: string;
  reason: string;
}

interface ParsedRagAnswerability {
  answerability?: string;
  selectedEvidenceIds?: string[];
  coveredClaims?: RagCoveredClaim[];
  missingElements?: string[];
  shouldEscalate?: boolean;
  escalationFocus?: string;
  reason?: string;
}

export class RagAnswerabilityService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
    private readonly topN: number = 3,
  ) {}

  async evaluate(input: {
    contract: AnswerContract;
    evidence: KnowledgeEvidenceResult[];
  }): Promise<RagAnswerabilityResult> {
    const topEvidence = input.evidence.slice(0, this.topN);
    const evidencePayload = topEvidence.map((item) => ({
      id: item.evidence_id,
      title: item.title,
      summary: item.summary,
      answer_span: item.answer_span,
      excerpt: item.excerpt,
    }));

    const systemPrompt = `${this.agentSpec}

Return JSON only. Do not include markdown, comments, explanations, or text outside the JSON object.`;

    try {
      const response = await this.model.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ answerContract: input.contract, evidence: evidencePayload }, null, 2) },
      ], { json: true });
      const parsed = parseAgentModelJson<ParsedRagAnswerability>(response);
      return validateRagAnswerability(parsed, new Set(topEvidence.map((item) => item.evidence_id)), input.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return conservativeUnknown(input.contract, `rag answerability evaluation failed: ${message}`);
    }
  }
}

function validateRagAnswerability(
  parsed: ParsedRagAnswerability,
  validEvidenceIds: Set<string>,
  contract: AnswerContract,
): RagAnswerabilityResult {
  const answerability = normalizeAnswerability(parsed.answerability);
  if (answerability === 'unknown') {
    return conservativeUnknown(contract, 'unknown or missing answerability');
  }

  const selectedEvidenceIds = safeStringArray(parsed.selectedEvidenceIds);
  const missingElements = safeStringArray(parsed.missingElements);
  const coveredClaims = safeClaims(parsed.coveredClaims);
  const allEvidenceIds = new Set([
    ...selectedEvidenceIds,
    ...coveredClaims.flatMap((claim) => claim.evidenceIds),
  ]);
  for (const evidenceId of allEvidenceIds) {
    if (!validEvidenceIds.has(evidenceId)) {
      return conservativeUnknown(contract, `invalid evidence id: ${evidenceId}`);
    }
  }
  if (answerability === 'full' && coveredClaims.length === 0) {
    return conservativeUnknown(contract, 'full answerability requires covered claims');
  }
  if ((answerability === 'full' || answerability === 'partial') && selectedEvidenceIds.length === 0) {
    return conservativeUnknown(contract, `${answerability} answerability requires selected evidence`);
  }
  if (answerability === 'partial' && coveredClaims.length === 0) {
    return conservativeUnknown(contract, 'partial answerability requires covered claims');
  }
  if (answerability === 'full' && missingElements.length > 0) {
    return conservativeUnknown(contract, 'full answerability cannot include missing elements');
  }
  if (answerability === 'full' && parsed.shouldEscalate === true) {
    return conservativeUnknown(contract, 'full answerability cannot request escalation');
  }
  if (answerability === 'full') {
    const coveredRequirementIds = new Set(coveredClaims.flatMap((claim) => claim.coveredRequirementIds));
    const missingRequirementIds = contract.mustAnswer
      .map((requirement) => requirement.id)
      .filter((id) => !coveredRequirementIds.has(id));
    if (missingRequirementIds.length > 0) {
      return conservativeUnknown(contract, `full answerability missing mustAnswer requirements: ${missingRequirementIds.join(', ')}`);
    }
  }
  if ((answerability === 'partial' || answerability === 'none') && parsed.shouldEscalate === false) {
    return conservativeUnknown(contract, 'partial/none answerability must escalate');
  }

  return {
    answerability,
    selectedEvidenceIds,
    coveredClaims: answerability === 'none' ? [] : coveredClaims,
    missingElements,
    shouldEscalate: answerability !== 'full' || parsed.shouldEscalate === true,
    escalationFocus: typeof parsed.escalationFocus === 'string' ? parsed.escalationFocus : defaultEscalationFocus(contract),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

function conservativeUnknown(contract: AnswerContract, reason: string): RagAnswerabilityResult {
  return {
    answerability: 'unknown',
    selectedEvidenceIds: [],
    coveredClaims: [],
    missingElements: contract.mustAnswer.map((item) => item.label),
    shouldEscalate: contract.missingTolerance === 'partial_allowed_with_escalation' || contract.questionType !== 'definition',
    escalationFocus: defaultEscalationFocus(contract),
    reason,
  };
}

function normalizeAnswerability(value: unknown): RagAnswerability {
  if (value === 'full' || value === 'partial' || value === 'none') return value;
  return 'unknown';
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function safeClaims(value: unknown): RagCoveredClaim[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<RagCoveredClaim>;
    if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') return [];
    return [{
      id: candidate.id,
      text: candidate.text,
      evidenceIds: safeStringArray(candidate.evidenceIds),
      coveredRequirementIds: safeStringArray(candidate.coveredRequirementIds),
      usefulness: typeof candidate.usefulness === 'string' ? candidate.usefulness : '',
    }];
  });
}

function defaultEscalationFocus(contract: AnswerContract): string {
  return `补齐这些答案要素：${contract.mustAnswer.map((item) => item.label).join('、')}`;
}
