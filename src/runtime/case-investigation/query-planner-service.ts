import * as z from 'zod/v4';
import type { AgentModelClient } from '../../providers/model/adapter.js';
import { parseAgentModelJson } from '../agent-model-review.js';
import type { HistoricalSearchPlan, QueryPlannerInput } from './contracts.js';
import { queryPreservesOpaqueIdentifiers } from './search-identifiers.js';

const PlanSchema = z.object({
  query: z.string().trim().min(1).max(500),
  signals: z.array(z.string().trim().min(1).max(120)).max(20),
  status: z.literal('all'),
  candidateLimit: z.literal(10),
  detailLimit: z.literal(3),
}).strict();

export class QueryPlannerService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
  ) {}

  async plan(input: QueryPlannerInput): Promise<HistoricalSearchPlan> {
    try {
      const response = await this.model.complete([
        { role: 'system', content: `${this.agentSpec}\n\nReturn JSON only.` },
        { role: 'user', content: JSON.stringify({ answerGoal: input.answerGoal }) },
      ], { json: true, thinking: 'disabled' });
      const parsed = PlanSchema.parse(parseAgentModelJson<unknown>(response));
      if (!queryPreservesOpaqueIdentifiers(parsed.query, input.answerGoal.resolvedQuestion)) {
        return fallbackPlan(input);
      }
      return { ...parsed, signals: [...new Set(parsed.signals)], degraded: false };
    } catch {
      return fallbackPlan(input);
    }
  }
}

function fallbackPlan(input: QueryPlannerInput): HistoricalSearchPlan {
  return {
    query: input.answerGoal.resolvedQuestion,
    signals: [],
    status: 'all',
    candidateLimit: 10,
    detailLimit: 3,
    degraded: true,
  };
}
