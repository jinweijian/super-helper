import * as z from 'zod/v4';
import type { AgentModelClient } from '../../providers/model/adapter.js';
import { parseAgentModelJson } from '../agent-model-review.js';
import type {
  HistoricalVerificationInput,
  HistoricalVerificationResult,
} from './contracts.js';

const VerificationSchema = z.object({
  verifications: z.array(z.object({
    leadId: z.string().trim().min(1).max(120),
    classification: z.enum([
      'same_root_cause_likely',
      'same_symptom_different_cause',
      'diagnostic_lead_only',
      'irrelevant',
    ]),
    historicalEvidenceIds: z.array(z.string().min(1).max(160)).max(20),
    currentEvidenceIds: z.array(z.string().min(1).max(160)).max(20),
    supportingEvidenceIds: z.array(z.string().min(1).max(160)).max(30),
    conflictingEvidenceIds: z.array(z.string().min(1).max(160)).max(30),
  }).strict()).max(3),
}).strict();

export class HistoricalCaseVerifierService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
  ) {}

  async verify(input: HistoricalVerificationInput): Promise<HistoricalVerificationResult> {
    try {
      const response = await this.model.complete([
        { role: 'system', content: `${this.agentSpec}\n\nReturn JSON only.` },
        { role: 'user', content: JSON.stringify(input) },
      ], { json: true, thinking: 'disabled' });
      const parsed = VerificationSchema.parse(parseAgentModelJson<unknown>(response));
      if (!validVerification(parsed, input)) return conservative(input);
      return { verifications: parsed.verifications, degraded: false };
    } catch {
      return conservative(input);
    }
  }
}

function validVerification(
  parsed: z.infer<typeof VerificationSchema>,
  input: HistoricalVerificationInput,
): boolean {
  const leadIds = new Set(input.leads.map((item) => item.id));
  if (parsed.verifications.length !== leadIds.size) return false;
  const returnedLeadIds = new Set<string>();
  const historicalIds = new Set(input.historicalEvidence.map((item) => item.id));
  const currentIds = new Set(input.currentEvidence.map((item) => item.id));
  const allIds = new Set([...historicalIds, ...currentIds]);
  for (const verification of parsed.verifications) {
    if (!leadIds.has(verification.leadId) || returnedLeadIds.has(verification.leadId)) return false;
    returnedLeadIds.add(verification.leadId);
    if (verification.historicalEvidenceIds.some((id) => !historicalIds.has(id))) return false;
    if (verification.currentEvidenceIds.some((id) => !currentIds.has(id))) return false;
    if (verification.supportingEvidenceIds.some((id) => !allIds.has(id))) return false;
    if (verification.conflictingEvidenceIds.some((id) => !allIds.has(id))) return false;
  }
  return true;
}

function conservative(input: HistoricalVerificationInput): HistoricalVerificationResult {
  return {
    verifications: input.leads.map((lead) => ({
      leadId: lead.id,
      classification: 'diagnostic_lead_only',
      historicalEvidenceIds: lead.evidenceIds.filter((id) => input.historicalEvidence.some((item) => item.id === id)),
      currentEvidenceIds: [],
      supportingEvidenceIds: lead.evidenceIds.filter((id) => input.historicalEvidence.some((item) => item.id === id)),
      conflictingEvidenceIds: [],
    })),
    degraded: true,
  };
}
