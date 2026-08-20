import * as z from 'zod/v4';
import type { AgentModelClient } from '../../providers/model/adapter.js';
import { parseAgentModelJson } from '../agent-model-review.js';
import type { HistoricalAnalysis, HistoricalAnalysisInput } from './contracts.js';

const ActionSchema = z.enum([
  'read_file',
  'search_workspace',
  'inspect_config',
  'inspect_log',
  'run_read_only_command',
]);

const AnalysisSchema = z.object({
  leads: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    issueId: z.number().int().positive(),
    hypothesis: z.string().trim().min(1).max(1_000),
    evidenceIds: z.array(z.string().min(1).max(160)).min(1).max(10),
    conflicts: z.array(z.string().max(500)).max(10),
    checks: z.array(z.object({
      id: z.string().trim().min(1).max(120),
      action: ActionSchema,
      target: z.string().trim().min(1).max(500),
      expectedMatch: z.string().trim().min(1).max(500),
      expectedMismatch: z.string().trim().min(1).max(500),
      evidenceIds: z.array(z.string().min(1).max(160)).min(1).max(10),
    }).strict()).min(1).max(10),
  }).strict()).max(3),
}).strict();

export class HistoricalCaseAnalyzerService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
  ) {}

  async analyze(input: HistoricalAnalysisInput): Promise<HistoricalAnalysis> {
    try {
      const response = await this.model.complete([
        { role: 'system', content: `${this.agentSpec}\n\nReturn JSON only.` },
        { role: 'user', content: JSON.stringify(modelInput(input)) },
      ], { json: true, thinking: 'disabled' });
      const parsed = AnalysisSchema.parse(parseAgentModelJson<unknown>(response));
      if (!validAnalysis(parsed, input)) return { leads: [], degraded: true };
      return { leads: parsed.leads, degraded: false };
    } catch {
      return { leads: [], degraded: true };
    }
  }
}

function modelInput(input: HistoricalAnalysisInput) {
  return {
    details: input.details.map((detail) => ({
      ...detail,
      evidenceBlocks: detail.evidenceBlocks.map((block) => ({
        kind: block.kind,
        label: block.label,
        text: block.text,
        occurredAt: block.occurredAt,
        metadata: block.metadata,
      })),
    })),
    evidence: input.evidence,
    allowedEvidenceIds: input.evidence.map((item) => item.id),
  };
}

function validAnalysis(
  parsed: z.infer<typeof AnalysisSchema>,
  input: HistoricalAnalysisInput,
): boolean {
  const detailIds = new Set(input.details.map((item) => item.issueId));
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const leadIds = new Set<string>();
  const checkIds = new Set<string>();
  for (const lead of parsed.leads) {
    if (leadIds.has(lead.id) || !detailIds.has(lead.issueId)) return false;
    leadIds.add(lead.id);
    const locator = `redmine:issue:${lead.issueId}`;
    if (lead.evidenceIds.some((id) => !evidenceById.get(id)?.source.includes(locator))) return false;
    for (const check of lead.checks) {
      if (checkIds.has(check.id) || check.evidenceIds.some((id) => !lead.evidenceIds.includes(id))) return false;
      checkIds.add(check.id);
    }
  }
  return true;
}
