export interface Bm25TokenizerOptions {
  businessTerms?: string[];
  registeredSingleCharacterTerms?: string[];
  removeGenericTerms?: boolean;
}

const GENERIC_TERMS = new Set(['怎么', '什么', '如何', '是否', '可以', '支持', '功能', '使用', '这个', '那个', '一个']);

export function tokenizeForBm25(input: string, options: Bm25TokenizerOptions = {}): string[] {
  const normalized = input.toLowerCase();
  const registeredSingles = new Set((options.registeredSingleCharacterTerms ?? []).map((term) => term.toLowerCase()));
  const tokens: string[] = [];

  for (const term of options.businessTerms ?? []) {
    const normalizedTerm = term.trim().toLowerCase();
    if (!normalizedTerm || (normalizedTerm.length === 1 && !registeredSingles.has(normalizedTerm))) continue;
    for (const _occurrence of occurrences(normalized, normalizedTerm)) {
      tokens.push(normalizedTerm);
    }
  }

  for (const latin of normalized.match(/[a-z0-9]+(?:[._/-][a-z0-9]+)*/g) ?? []) {
    if (latin.length >= 2 || registeredSingles.has(latin)) {
      tokens.push(latin);
    }
  }

  for (const sequence of normalized.match(/[\u3400-\u9fff]+/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const bigram = sequence.slice(index, index + 2);
      if (options.removeGenericTerms !== false && GENERIC_TERMS.has(bigram)) continue;
      tokens.push(bigram);
    }
    if (sequence.length === 1 && registeredSingles.has(sequence)) {
      tokens.push(sequence);
    }
  }

  return tokens;
}

function occurrences(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    indexes.push(index);
    cursor = index + Math.max(1, needle.length);
  }
  return indexes;
}
