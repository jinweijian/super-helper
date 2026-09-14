import { join } from 'node:path';
import { ensureExperienceStore } from './store-files.js';
import { recoverDeadExperienceLock } from './store-lock.js';
import type { ExperienceImportOptions } from './csv/import-contracts.js';

export function recoverStoreLock(rootInput: string, scope: ExperienceImportOptions, kind: 'writer' | 'runner') {
  if (kind !== 'writer' && kind !== 'runner') throw new Error('EXPERIENCE_ARGUMENTS_INVALID');
  const root = ensureExperienceStore(rootInput, scope.scope.trim(), scope.sourceInstance.trim(), false);
  recoverDeadExperienceLock(kind === 'writer' ? join(root, 'private', 'writer.lock') : join(root, 'private', 'refinement', 'runner.lock'));
  return { recovered: true, lock: kind, evidenceRetained: true };
}
