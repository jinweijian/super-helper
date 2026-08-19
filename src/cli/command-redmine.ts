import { DEFAULT_HOME } from '../config/defaults.js';
import { FileSecretsRepository } from '../onboarding/secrets.js';
import { readHiddenLine } from './hidden-input.js';

export const REDMINE_API_KEY_SECRET = 'integrations.redmine.apiKey';

export interface RunRedmineCommandInput {
  argv: string[];
  rootDir?: string;
  readSecret?: (prompt: string) => Promise<string>;
  write?: (line: string) => void;
}

export async function runRedmineCommand(input: RunRedmineCommandInput): Promise<boolean> {
  const write = input.write ?? ((line: string) => console.log(line));
  if (input.argv[0] !== 'secret' || input.argv[1] !== 'set' || input.argv.length !== 2) {
    write('用法: super-helper redmine secret set');
    return false;
  }

  const readSecret = input.readSecret ?? readHiddenLine;
  let first: string;
  let second: string;
  try {
    first = (await readSecret('Redmine API 访问键: ')).trim();
    if (!first) {
      write('redmine secret: failed (empty_secret)');
      return false;
    }
    second = (await readSecret('再次输入 Redmine API 访问键: ')).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = message === 'interactive_tty_required' || message === 'input_cancelled'
      ? message
      : 'secret_input_failed';
    write(`redmine secret: failed (${code})`);
    return false;
  }

  if (first !== second) {
    write('redmine secret: failed (confirmation_mismatch)');
    return false;
  }

  new FileSecretsRepository(input.rootDir ?? DEFAULT_HOME).set(REDMINE_API_KEY_SECRET, first);
  write('redmine secret: configured');
  return true;
}
