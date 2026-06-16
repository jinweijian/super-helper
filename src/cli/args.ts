export interface ParsedArgs {
  argv: string[];
}

export function hasFlag(input: ParsedArgs | string[], name: string): boolean {
  return argvOf(input).includes(name);
}

export function readOption(input: ParsedArgs | string[], name: string): string | undefined {
  const argv = argvOf(input);
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

export function readNumberOption(input: ParsedArgs | string[], name: string): number | undefined {
  const value = readOption(input, name);
  if (!value) {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function argvOf(input: ParsedArgs | string[]): string[] {
  return Array.isArray(input) ? input : input.argv;
}
