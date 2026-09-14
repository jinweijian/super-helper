import { RefinementJob } from '../../knowledge/experience/refinement-job.js';
import type { ExperienceImportOptions } from '../../knowledge/experience/csv/import-contracts.js';

export function refinementJobStatus(root: string, scope: ExperienceImportOptions, jobId: string) {
  return RefinementJob.status(root, scope, jobId);
}
