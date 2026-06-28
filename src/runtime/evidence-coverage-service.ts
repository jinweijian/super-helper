import type { KnowledgeEvidenceResult } from '../knowledge/index.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import { parseAgentModelJson } from './agent-model-review.js';

export type EvidenceCoverage = 'covered' | 'partial' | 'not_covered' | 'unknown';

export interface CoverageResult {
  coverage: EvidenceCoverage;
  missingElements: string[];
  reason: string;
}

interface ParsedCoverageResponse {
  coverage?: string;
  missing_elements?: string[];
  reason?: string;
}

export class EvidenceCoverageService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
    private readonly topN: number = 3,
  ) {}

  async evaluate(input: {
    question: string;
    evidence: KnowledgeEvidenceResult[];
  }): Promise<CoverageResult> {
    const topEvidence = input.evidence.slice(0, this.topN);
    const evidencePayload = topEvidence.map((item) => ({
      title: item.title,
      summary: item.summary,
      answer_span: item.answer_span,
      excerpt: item.excerpt,
    }));

    const systemPrompt = `${this.agentSpec}

Return JSON only. Use this shape:
{"coverage":"covered"|"partial"|"not_covered","missing_elements":["..."],"reason":"..."}

Do not include <think>, markdown, comments, explanations, or text outside the JSON object.`;

    const userPrompt = JSON.stringify(
      {
        question: input.question,
        evidence: evidencePayload,
      },
      null,
      2,
    );

    try {
      const response = await this.model.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], { json: true });

      const parsed = parseAgentModelJson<ParsedCoverageResponse>(response);
      const coverage = normalizeCoverage(parsed.coverage);
      return {
        coverage,
        missingElements: Array.isArray(parsed.missing_elements)
          ? parsed.missing_elements.map((item) => String(item))
          : [],
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        coverage: 'unknown',
        missingElements: [],
        reason: `coverage evaluation failed: ${message}`,
      };
    }
  }
}

function normalizeCoverage(value: unknown): EvidenceCoverage {
  if (value === 'covered' || value === 'partial' || value === 'not_covered') {
    return value;
  }
  return 'unknown';
}
