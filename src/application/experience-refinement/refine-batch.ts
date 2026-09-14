import { ExperienceBatchRepository } from '../../knowledge/experience/batch-repository.js';
import { ExperiencePublicationRepository } from '../../knowledge/experience/publication-repository.js';
import { RefinementJob } from '../../knowledge/experience/refinement-job.js';
import { sha256 } from '../../knowledge/experience/provenance.js';
import { resolveAgentConfig } from '../../runtime/agent-configs.js';
import type { ExperienceImportOptions } from '../../knowledge/experience/csv/import-contracts.js';
import type { AgentModelClient } from '../../providers/model/adapter.js';
import { refineExperienceRecord } from './refine-record.js';

export async function refineExperienceBatch(input: {
  root: string; scope: ExperienceImportOptions; jobId: string; modelFingerprint: string; maxCalls: number;
  model: AgentModelClient; reviewer?: AgentModelClient; signal?: AbortSignal;
}) {
  if (!input.modelFingerprint.trim()) throw new Error('EXPERIENCE_JOB_ARGUMENTS');
  const sources = new ExperienceBatchRepository(input.root, input.scope).listPending().sort((a, b) => a.sourceRevision.localeCompare(b.sourceRevision));
  const fingerprint = sha256(JSON.stringify(['experience/v1', input.modelFingerprint,
    resolveAgentConfig('experience_refiner').content, resolveAgentConfig('experience_reviewer').content,
    sources.map(s => s.sourceRevision)]));
  return RefinementJob.use(input.root, input.scope, input.jobId, fingerprint, input.maxCalls, async job => {
    const publications = new ExperiencePublicationRepository(input.root, input.scope);
    const publishedSources = new Set(publications.list().map(item => item.sourceRevision));
    const budget = { remainingCalls: input.maxCalls - job.state.callsUsed };
    for (const item of sources) {
      if (input.signal?.aborted) break;
      const status = job.state.records[item.sourceRevision];
      if (status === 'published' || status === 'quarantined' || status === 'failed') continue;
      if (publishedSources.has(item.sourceRevision)) { job.mark(item.sourceRevision, 'published'); continue; }
      if (status !== 'accepted') {
        const result = await refineExperienceRecord(item.source, { model: input.model, reviewer: input.reviewer, budget,
          signal: input.signal, beforeCall: () => job.reserveCall(), checkpoint: job.checkpoint(item.sourceRevision) });
        if (result.status === 'paused') break;
        if (result.status !== 'accepted') { job.mark(item.sourceRevision, result.status); continue; }
        job.accept(item.sourceRevision, result);
      }
      if (input.signal?.aborted) break;
      const accepted = job.accepted(item.sourceRevision);
      publications.publish(accepted.source, accepted.draft, accepted.review);
      job.mark(item.sourceRevision, 'published');
    }
    const counts = Object.values(job.state.records);
    const published = counts.filter(s => s === 'published').length;
    const quarantined = counts.filter(s => s === 'quarantined').length;
    const failed = counts.filter(s => s === 'failed').length;
    return { status: published + quarantined + failed === sources.length ? 'complete' : 'paused',
      total: sources.length, published, quarantined, failed, callsUsed: job.state.callsUsed, maxCalls: input.maxCalls };
  });
}
