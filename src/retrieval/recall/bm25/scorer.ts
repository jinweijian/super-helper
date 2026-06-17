export interface Bm25Document {
  id: string;
  tokens: string[];
}

export interface Bm25ScoredDocument {
  id: string;
  score: number;
  matchedTerms: string[];
}

export function scoreBm25(input: {
  queryTokens: string[];
  documents: Bm25Document[];
  k1?: number;
  b?: number;
}): Bm25ScoredDocument[] {
  const k1 = input.k1 ?? 1.2;
  const b = input.b ?? 0.75;
  const documentCount = input.documents.length;
  if (documentCount === 0 || input.queryTokens.length === 0) {
    return [];
  }

  const averageLength = input.documents.reduce((sum, doc) => sum + doc.tokens.length, 0) / documentCount;
  const documentFrequency = new Map<string, number>();
  for (const document of input.documents) {
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return input.documents
    .map((document) => {
      const termFrequency = new Map<string, number>();
      for (const token of document.tokens) {
        termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
      }
      let score = 0;
      const matchedTerms: string[] = [];
      for (const token of input.queryTokens) {
        const frequency = termFrequency.get(token) ?? 0;
        if (frequency === 0) {
          continue;
        }
        matchedTerms.push(token);
        const docsWithTerm = documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (documentCount - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
        const denominator = frequency + k1 * (1 - b + b * (document.tokens.length / averageLength));
        score += idf * ((frequency * (k1 + 1)) / denominator);
      }
      return {
        id: document.id,
        score: Number(score.toFixed(8)),
        matchedTerms,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}
