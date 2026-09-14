import { profileExperienceFile } from '../application/experience-refinement/profile.js';
import { importExperienceFile, experienceBatchStatus } from '../application/experience-refinement/import.js';
import type { CsvParseOptions } from '../knowledge/experience/csv/contracts.js';
import { runConfiguredRefinement } from '../application/experience-refinement/configured-run.js';
import { refinementJobStatus } from '../application/experience-refinement/status.js';
import { recoverRefinementLock } from '../application/experience-refinement/recover.js';

export async function runExperienceCommand(argv: string[]): Promise<void> {
  const command = argv[0];
  if (!['profile', 'import', 'status', 'refine', 'recover'].includes(command)) throw new Error('Usage: experience <profile|import|refine|status|recover>');
  const allowed = command === 'profile' ? ['--file', '--encoding', '--delimiter']
    : command === 'import' ? ['--file', '--encoding', '--delimiter', '--store', '--scope', '--source-instance', '--source-project', '--mapping']
      : command === 'refine' ? ['--store', '--scope', '--source-instance', '--job', '--max-calls', '--config', '--enable-model']
        : command === 'recover' ? ['--store', '--scope', '--source-instance', '--lock', '--confirm']
          : ['--store', '--scope', '--source-instance', '--batch', '--job'];
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.includes(flag) || !value?.trim() || value.startsWith('--') || flags.has(flag)) {
      throw new Error('EXPERIENCE_ARGUMENTS_INVALID');
    }
    flags.set(flag, value);
  }
  const required = (flag: string): string => {
    const value = flags.get(flag);
    if (!value) throw new Error(flag === '--file' ? 'EXPERIENCE_FILE_REQUIRED' : 'EXPERIENCE_ARGUMENTS_INVALID');
    return value;
  };
  if (command === 'status') {
    if (flags.has('--batch') === flags.has('--job')) throw new Error('EXPERIENCE_ARGUMENTS_INVALID');
    const scope = { scope: required('--scope'), sourceInstance: required('--source-instance') };
    const result = flags.has('--job') ? refinementJobStatus(required('--store'), scope, required('--job'))
      : experienceBatchStatus(required('--store'), scope, required('--batch'));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'recover') {
    const kind = required('--lock');
    if (kind !== 'writer' && kind !== 'runner') throw new Error('EXPERIENCE_ARGUMENTS_INVALID');
    console.log(JSON.stringify(recoverRefinementLock(required('--store'), {
      scope: required('--scope'), sourceInstance: required('--source-instance'),
    }, kind, flags.get('--confirm') === 'true'), null, 2));
    return;
  }
  if (command === 'refine') {
    if (flags.get('--enable-model') !== 'true') throw new Error('EXPERIENCE_MODEL_OPT_IN_REQUIRED');
    const rawLimit = required('--max-calls');
    if (!/^[1-9]\d*$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit))) throw new Error('EXPERIENCE_ARGUMENTS_INVALID');
    const input = { configFile: required('--config'), root: required('--store'),
      scope: { scope: required('--scope'), sourceInstance: required('--source-instance') },
      jobId: required('--job'), maxCalls: Number(rawLimit), enableModel: true };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    try {
      const report = await runConfiguredRefinement({ ...input, signal: controller.signal });
      console.log(JSON.stringify(report, null, 2));
      if (report.status === 'paused' || report.failed) process.exitCode = 2;
    } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
    return;
  }
  const file = required('--file');
  const encoding = flags.get('--encoding') ?? 'utf-8';
  const delimiterName = flags.get('--delimiter') ?? 'comma';
  if (!['utf-8', 'gb18030'].includes(encoding) || !['comma', 'semicolon', 'tab'].includes(delimiterName)) {
    throw new Error('EXPERIENCE_ARGUMENTS_INVALID');
  }
  const options: CsvParseOptions = {
    encoding: encoding as CsvParseOptions['encoding'],
    delimiter: delimiterName === 'tab' ? '\t' : delimiterName === 'semicolon' ? ';' : ',',
  };
  if (command === 'profile') {
    console.log(JSON.stringify(await profileExperienceFile(file, options), null, 2));
    return;
  }
  const store = required('--store');
  const scope = { scope: required('--scope'), sourceInstance: required('--source-instance'), sourceProject: flags.get('--source-project') };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    console.log(JSON.stringify(await importExperienceFile({ file, store, scope, parse: options, signal: controller.signal, mappingFile: flags.get('--mapping') }), null, 2));
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
