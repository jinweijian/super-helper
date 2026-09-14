import { z } from 'zod';
import { resolveAgentConfig } from '../../runtime/agent-configs.js';
import { experienceDraftSchema, experienceReviewSchema, experienceSourceSchema } from '../../knowledge/experience/schema.js';
import { hashExperienceDraft, validateExperienceArtifact } from '../../knowledge/experience/artifact-validation.js';
import { sourceRevision } from '../../knowledge/experience/provenance.js';
import { hasSensitiveExperienceText } from '../../knowledge/experience/privacy.js';
import { ModelRequestError } from '../../providers/model/errors.js';
import type { AgentModelClient } from '../../providers/model/adapter.js';
import type { RefinementOptions, RefinementResult } from './contracts.js';
import { requestRefinementModel } from './model-request.js';
import { refinementProgressSchema, type RefinementProgress } from '../../knowledge/experience/refinement-progress.js';

/** 只复用 registry 配置读取，不启动在线 runtime；独立审核不继承生成消息。 */
export async function refineExperienceRecord(sourceInput: unknown, options: RefinementOptions): Promise<RefinementResult> {
  let calls = 0;
  const rejected = (reason: string): RefinementResult => ({ status: 'quarantined', calls, reason });
  if (!Number.isSafeInteger(options.budget.remainingCalls) || options.budget.remainingCalls < 0) return rejected('invalid_budget');
  const parsed = experienceSourceSchema.safeParse(sourceInput);
  if (!parsed.success) return rejected('invalid_source');
  const source = parsed.data;
  const revision = sourceRevision(source);
  // 身份、原列名、附件地址、人员信息与原始哈希均不是模型输入。
  const fields = Object.fromEntries(Object.entries(source.fields)
    .filter(([key]) => !['ticketId', 'sourceProject', 'attachments', 'relatedIssues'].includes(key))
    .map(([key, cell]) => [key, { value: cell.value, completeness: cell.completeness }]));
  const serialized = JSON.stringify(fields);
  if (Buffer.byteLength(serialized, 'utf8') > 120_000) return rejected('input_too_large');
  if (hasSensitiveExperienceText(serialized)) return rejected('source_privacy_failed');
  const call = async (stage: 'experience_refiner' | 'experience_reviewer', input: object, model: AgentModelClient) => {
    if (options.signal?.aborted) throw new Error('cancelled');
    if (!options.budget.remainingCalls) throw new Error('budget_exhausted');
    const config = resolveAgentConfig(stage);
    const output = await requestRefinementModel({ model, budget: options.budget, signal: options.signal,
      onCall: () => { options.beforeCall?.(); calls++; }, messages: [
      { role: 'system', content: config.content },
      { role: 'user', content: JSON.stringify(input) },
    ] });
    if (options.signal?.aborted) throw new Error('cancelled');
    if (Buffer.byteLength(output, 'utf8') > 160_000) return undefined;
    try { return JSON.parse(output) as unknown; } catch { return undefined; }
  };
  try {
    const saved = options.checkpoint?.load();
    const parsedProgress = refinementProgressSchema.safeParse(saved ?? { sourceRevision: revision, attempt: 0 });
    if (!parsedProgress.success || parsedProgress.data.sourceRevision !== revision) return rejected('checkpoint_invalid');
    let progress: RefinementProgress = parsedProgress.data;
    const save = () => { options.checkpoint?.save(structuredClone(progress)); };
    const advance = (feedback: NonNullable<RefinementProgress['feedback']>) => {
      progress = { sourceRevision: revision, attempt: progress.attempt + 1, feedback };
      save();
    };
    while (progress.attempt < 2) {
      if (options.signal?.aborted) throw new Error('cancelled');
      if (!progress.draft) {
        const draftResult = experienceDraftSchema.safeParse(await call('experience_refiner', {
          source: fields, sourceRevision: revision, outputSchema: z.toJSONSchema(experienceDraftSchema), revisionFeedback: progress.feedback,
        }, options.model));
        if (!draftResult.success) { advance({ reason: 'draft_invalid' }); continue; }
        if (hasSensitiveExperienceText(JSON.stringify(draftResult.data))) return rejected('draft_privacy_failed');
        progress.draft = draftResult.data;
        save();
      }
      const draft = progress.draft;
      if (hasSensitiveExperienceText(JSON.stringify(draft))) return rejected('draft_privacy_failed');
      if (!progress.review) {
        const reviewResult = experienceReviewSchema.safeParse(await call('experience_reviewer', {
          source: fields, sourceRevision: revision, draft, draftHash: hashExperienceDraft(draft), outputSchema: z.toJSONSchema(experienceReviewSchema),
        }, options.reviewer ?? options.model));
        if (!reviewResult.success) { advance({ reason: 'review_invalid', draft }); continue; }
        progress.review = reviewResult.data;
        save();
      }
      if (options.signal?.aborted) throw new Error('cancelled');
      try {
        const validated = validateExperienceArtifact(source, draft, progress.review);
        return { status: 'accepted', calls, ...validated };
      } catch { advance({ reason: 'evidence_review_failed', draft, review: progress.review }); }
    }
    return rejected(progress.feedback?.reason ?? 'review_failed');
  } catch (error) {
    const reason = options.signal?.aborted ? 'cancelled'
      : error instanceof ModelRequestError ? error.code
        : error instanceof Error && ['cancelled', 'budget_exhausted'].includes(error.message) ? error.message : 'model_failed';
    return { status: reason === 'cancelled' || reason === 'budget_exhausted' ? 'paused' : 'failed', calls, reason };
  }
}
