export const READ_ONLY_CLAUDE_TOOLS = ['Read', 'Glob', 'Grep'];

export const DEFAULT_DISALLOWED_CLAUDE_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
];

export function readOnlyTools(configuredTools?: string[]): string[] {
  const configured = new Set(configuredTools ?? []);
  const narrowed = READ_ONLY_CLAUDE_TOOLS.filter((tool) => configured.size === 0 || configured.has(tool));
  return narrowed.length > 0 ? narrowed : READ_ONLY_CLAUDE_TOOLS;
}

export function assertHostCommandAllowed(command: string, whitelist?: string[]): string | undefined {
  const allowed = whitelist?.length ? whitelist : ['claude'];
  if (allowed.includes(command)) {
    return undefined;
  }

  return `Host command "${command}" is not in super helper command whitelist: ${allowed.join(', ')}`;
}
