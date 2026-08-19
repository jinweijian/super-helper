import * as z from 'zod/v4';
import type { AgentModelClient } from '../../providers/model/adapter.js';
import { parseAgentModelJson } from '../agent-model-review.js';
import type { CandidateRerankInput, CandidateSelection } from './contracts.js';

const SelectionSchema = z.object({
  issueIds: z.array(z.number().int().positive()).max(3),
}).strict();

export class CandidateRerankerService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
  ) {}

  async select(input: CandidateRerankInput): Promise<CandidateSelection> {
    const fallback = (): CandidateSelection => ({
      issueIds: input.candidates.slice(0, 3).map((item) => item.issueId),
      degraded: true,
    });
    try {
      const response = await this.model.complete([
        { role: 'system', content: `${this.agentSpec}\n\nReturn JSON only.` },
        { role: 'user', content: JSON.stringify(input) },
      ], { json: true });
      const parsed = SelectionSchema.parse(parseAgentModelJson<unknown>(response));
      const unique = [...new Set(parsed.issueIds)];
      const allowed = new Set(input.candidates.map((item) => item.issueId));
      if (unique.length !== parsed.issueIds.length || unique.some((id) => !allowed.has(id))) return fallback();
      return { issueIds: unique, degraded: false };
    } catch {
      return fallback();
    }
  }
}
