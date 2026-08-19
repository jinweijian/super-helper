import { DEFAULT_HOME } from '../config/defaults.js';
import { runRedmineReadonlyProbe } from '../mcp-servers/redmine/probe.js';
import { FileSecretsRepository } from '../onboarding/secrets.js';
import { readHiddenLine } from './hidden-input.js';

export const REDMINE_API_KEY_SECRET = 'integrations.redmine.apiKey';

export interface RunRedmineCommandInput {
  argv: string[];
  rootDir?: string;
  readSecret?: (prompt: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  probe?: typeof runRedmineReadonlyProbe;
  write?: (line: string) => void;
}

export async function runRedmineCommand(input: RunRedmineCommandInput): Promise<boolean> {
  const write = input.write ?? ((line: string) => console.log(line));
  if (input.argv.length === 1 && input.argv[0] === 'probe') {
    return runProbe(input, write);
  }
  if (input.argv.length === 2 && input.argv[0] === 'secret' && input.argv[1] === 'set') {
    return setSecret(input, write);
  }
  write('用法: super-helper redmine <secret set|probe>');
  return false;
}

async function setSecret(
  input: RunRedmineCommandInput,
  write: (line: string) => void,
): Promise<boolean> {
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

async function runProbe(
  input: RunRedmineCommandInput,
  write: (line: string) => void,
): Promise<boolean> {
  const secrets = new FileSecretsRepository(input.rootDir ?? DEFAULT_HOME);
  const apiKey = secrets.resolve({ source: 'file', key: REDMINE_API_KEY_SECRET });
  if (!apiKey) {
    write('redmine readonly probe: failed (missing_credentials)');
    write('请先执行: super-helper redmine secret set');
    return false;
  }

  const result = await (input.probe ?? runRedmineReadonlyProbe)({
    apiKey,
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) {
    write(`redmine readonly probe: failed (${result.code})`);
    return false;
  }

  write('redmine authentication: ok');
  write(`redmine project: ok (identifier=${result.project.identifier}, numericId=${result.project.numericId})`);
  write(`redmine issue list: ok (sampleCount=${result.issueList.sampleCount}, includesAllStatuses=true)`);
  if (result.issueDetail.status === 'ok') {
    write(`redmine issue detail: ok (journals=${result.issueDetail.journalCount}, relations=${result.issueDetail.relationCount}, attachments=${result.issueDetail.attachmentCount})`);
  } else {
    write('redmine issue detail: skipped (no_issue)');
  }
  write('redmine readonly probe: passed');
  return true;
}
