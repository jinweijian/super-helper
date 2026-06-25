export function extractKnowledgeTerms(value: string): string[] {
  const normalized = normalizeKnowledgeText(value);
  const latin = normalized.match(/[a-z0-9_/-]{2,}/g) ?? [];
  const hanRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const hanTerms = hanRuns.flatMap((run) => {
    const terms = new Set<string>([run]);
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
    return Array.from(terms);
  });
  return Array.from(new Set([...latin, ...hanTerms])).filter((item) => item.length >= 2);
}

export function keywordsFromQuery(value: string): string[] {
  return extractKnowledgeTerms(value);
}

export function normalizeKnowledgeText(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}
