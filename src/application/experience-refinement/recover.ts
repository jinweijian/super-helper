import { recoverStoreLock } from '../../knowledge/experience/recover-lock.js';
import type { ExperienceImportOptions } from '../../knowledge/experience/csv/import-contracts.js';

export function recoverRefinementLock(root: string, scope: ExperienceImportOptions, kind: 'writer' | 'runner', confirmed: boolean) {
  if (!confirmed) throw new Error('EXPERIENCE_RECOVERY_CONFIRM_REQUIRED');
  return recoverStoreLock(root, scope, kind);
}
