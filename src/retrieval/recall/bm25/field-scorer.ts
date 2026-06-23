export type Bm25KnowledgeField = 'title' | 'headings' | 'relatedTerms' | 'moduleIntent' | 'body';

export interface FieldWeightedBm25Document {
  id: string;
  fields: Record<Bm25KnowledgeField, string[]>;
}

export interface FieldWeightedBm25Result {
  id: string;
  score: number;
  matchedTerms: string[];
  fieldContributions: Record<Bm25KnowledgeField, number>;
}

export const KNOWLEDGE_FIELD_WEIGHTS: Record<Bm25KnowledgeField, number> = {
  title: 4,
  headings: 3,
  relatedTerms: 3,
  moduleIntent: 2,
  body: 1,
};

export function scoreFieldWeightedBm25(input: {
  queryTokens: string[];
  documents: FieldWeightedBm25Document[];
  k1?: number;
  b?: number;
}): FieldWeightedBm25Result[] {
  if (input.queryTokens.length === 0 || input.documents.length === 0) return [];
  const k1 = input.k1 ?? 1.2;
  const b = input.b ?? 0.75;
  const queryTerms = Array.from(new Set(input.queryTokens));
  const lengths = new Map(input.documents.map((document) => [document.id, weightedLength(document)]));
  const averageLength = Array.from(lengths.values()).reduce((sum, value) => sum + value, 0) / input.documents.length;
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, input.documents.filter((document) => fieldNames().some((field) => document.fields[field].includes(term))).length);
  }

  return input.documents
    .map((document): FieldWeightedBm25Result => {
      const contributions = emptyContributions();
      const matchedTerms: string[] = [];
      const documentLength = lengths.get(document.id) ?? 0;
      for (const term of queryTerms) {
        const frequencies = fieldNames().map((field) => ({
          field,
          frequency: document.fields[field].filter((token) => token === term).length,
        }));
        const weightedFrequency = frequencies.reduce((sum, item) => sum + item.frequency * KNOWLEDGE_FIELD_WEIGHTS[item.field], 0);
        if (weightedFrequency <= 0) continue;
        matchedTerms.push(term);
        const docsWithTerm = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (input.documents.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
        const normalization = k1 * (1 - b + b * (documentLength / Math.max(1, averageLength)));
        for (const item of frequencies) {
          if (item.frequency === 0) continue;
          const weightedFieldFrequency = item.frequency * KNOWLEDGE_FIELD_WEIGHTS[item.field];
          contributions[item.field] += idf * ((weightedFieldFrequency * (k1 + 1)) / (weightedFrequency + normalization));
        }
      }
      const score = fieldNames().reduce((sum, field) => sum + contributions[field], 0);
      return {
        id: document.id,
        score: Number(score.toFixed(8)),
        matchedTerms: matchedTerms.filter((term) => term.length >= 2),
        fieldContributions: Object.fromEntries(fieldNames().map((field) => [field, Number(contributions[field].toFixed(8))])) as Record<Bm25KnowledgeField, number>,
      };
    })
    .filter((result) => result.score > 0 && result.matchedTerms.length > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function weightedLength(document: FieldWeightedBm25Document): number {
  return fieldNames().reduce((sum, field) => sum + document.fields[field].length * KNOWLEDGE_FIELD_WEIGHTS[field], 0);
}

function fieldNames(): Bm25KnowledgeField[] {
  return ['title', 'headings', 'relatedTerms', 'moduleIntent', 'body'];
}

function emptyContributions(): Record<Bm25KnowledgeField, number> {
  return { title: 0, headings: 0, relatedTerms: 0, moduleIntent: 0, body: 0 };
}
