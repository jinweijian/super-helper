export function tokenizeForBm25(input: string): string[] {
  const normalized = input.toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = words.flatMap((word) => {
    if (/[\u4e00-\u9fff]/u.test(word)) {
      return Array.from(new Set([word, ...Array.from(word)]));
    }
    return [word];
  });
  return Array.from(new Set(tokens.filter(Boolean)));
}
