import { setTimeout } from 'node:timers/promises';
import type { AgentModelClient, AgentModelMessage } from '../../providers/model/adapter.js';
import { ModelRequestError } from '../../providers/model/errors.js';

/** 瞬态传输重试不等于内容修订；调用预算在每次实际请求之前扣除。 */
export async function requestRefinementModel(input: {
  model: AgentModelClient; messages: AgentModelMessage[]; budget: { remainingCalls: number };
  signal?: AbortSignal; onCall: () => void;
}): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (input.signal?.aborted) throw new Error('cancelled');
    if (input.budget.remainingCalls <= 0) throw new Error('budget_exhausted');
    input.budget.remainingCalls--;
    input.onCall();
    try {
      const output = await input.model.complete(input.messages, { json: true, signal: input.signal });
      if (input.signal?.aborted) throw new Error('cancelled');
      return output;
    } catch (error) {
      if (input.signal?.aborted) throw new Error('cancelled');
      if (!(error instanceof ModelRequestError) || !error.retryable || attempt === 2) throw error;
      if (input.budget.remainingCalls <= 0) throw new Error('budget_exhausted');
      try { await setTimeout(250 * (2 ** attempt), undefined, { signal: input.signal }); }
      catch { throw new Error('cancelled'); }
    }
  }
  throw new Error('model_failed');
}
