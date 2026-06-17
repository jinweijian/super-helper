import { readKnowledgeChunks } from '../../../knowledge/indexes/chunks.js';
import { readKnowledgeVectorRecords } from '../../../knowledge/indexes/vector-index.js';
import type { KnowledgeVectorRecord } from '../../../knowledge/types.js';
import type { RetrievalCandidate } from '../../types.js';

export function searchVectorArtifacts(input: {
  workspaceRoot: string;
  queryVector: number[];
  limit: number;
}): RetrievalCandidate[] {
  const loadedVectors = readKnowledgeVectorRecords(input.workspaceRoot);
  const loadedChunks = readKnowledgeChunks(input.workspaceRoot);
  const chunkById = new Map(loadedChunks.chunks.map((chunk) => [chunk.chunk_id, chunk]));

  return loadedVectors.records
    .map((record): RetrievalCandidate | undefined => {
      const chunk = chunkById.get(record.chunk_id);
      if (!chunk || chunk.status !== 'active') {
        return undefined;
      }
      const score = vectorSimilarity(input.queryVector, record);
      if (score <= 0) {
        return undefined;
      }
      return {
        id: chunk.chunk_id,
        chunkId: chunk.chunk_id,
        documentId: chunk.parent_id,
        parentId: chunk.parent_id,
        source: chunk.source,
        title: chunk.headings[0],
        module: chunk.module,
        intent: chunk.intent,
        sourceType: chunk.source_type,
        confidence: chunk.confidence,
        status: chunk.status,
        visibility: chunk.visibility ?? 'internal',
        matchedTerms: [],
        summary: chunk.headings[0] ?? chunk.source,
        excerpt: chunk.text.slice(0, 500),
        text: chunk.text,
        score: Number(score.toFixed(8)),
      };
    })
    .filter((item): item is RetrievalCandidate => item !== undefined)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit);
}

function vectorSimilarity(queryVector: number[], record: KnowledgeVectorRecord): number {
  if (queryVector.length === 0 || queryVector.length !== record.vector.length) {
    return 0;
  }
  if (record.distance === 'dot') {
    return dotProduct(queryVector, record.vector);
  }
  if (record.distance === 'euclidean') {
    let squared = 0;
    for (let index = 0; index < queryVector.length; index += 1) {
      const delta = queryVector[index]! - record.vector[index]!;
      squared += delta * delta;
    }
    return 1 / (1 + Math.sqrt(squared));
  }
  const queryNorm = vectorNorm(queryVector);
  const recordNorm = vectorNorm(record.vector);
  if (queryNorm === 0 || recordNorm === 0) {
    return 0;
  }
  return dotProduct(queryVector, record.vector) / (queryNorm * recordNorm);
}

function dotProduct(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index]! * right[index]!;
  }
  return total;
}

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}
