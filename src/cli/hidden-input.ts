import process from 'node:process';

type TtyInput = NodeJS.ReadStream & {
  isRaw?: boolean;
  setRawMode(mode: boolean): NodeJS.ReadStream;
};

export async function readHiddenLine(
  prompt: string,
  input: TtyInput = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('interactive_tty_required');
  }

  output.write(prompt);
  const wasRaw = Boolean(input.isRaw);
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';
    let settled = false;

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
    };
    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      output.write('\n');
      cleanup();
      resolve(result);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      output.write('\n');
      cleanup();
      reject(new Error('input_cancelled'));
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          cancel();
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ') {
          value += character;
        }
      }
    };

    input.on('data', onData);
  });
}
