import { ProviderError } from '../../errors.js';
import { isProviderObject } from '../../http.js';
import type {
  ExperienceIndexBuildStatus,
  ExperienceIndexCandidate,
  ExperienceIndexDataset,
  ExperienceIndexQuery,
  ExperienceIndexQueryResult,
  ExperienceIndexRun,
  ExperienceIndexSourceRecord,
} from '../../../contracts/experience-index.js';

export function buildCogneeQueryRequest(input: ExperienceIndexQuery): Record<string, unknown> {
  return {
    query: input.query,
    search_type: 'CHUNKS',
    dataset_ids: [input.datasetId],
    top_k: input.topK ?? 5,
    only_context: true,
    context_format: 'context',
    verbose: true,
    include_references: true,
  };
}

function malformed(message: string): never {
  throw new ProviderError({
    provider: 'cognee',
    code: 'malformed_response',
    retryable: false,
    safeMessage: message,
  });
}

export function mapCogneeQueryResponse(value: unknown, expectedDatasetId: string): ExperienceIndexQueryResult {
  if (!Array.isArray(value)) {
    return malformed('Cognee search response was not an array.');
  }
  const candidates: ExperienceIndexCandidate[] = [];
  for (const result of value) {
    if (!isProviderObject(result)) {
      return malformed('Cognee search result was malformed.');
    }
    const datasetId = result.dataset_id;
    if (datasetId !== expectedDatasetId) {
      return malformed('Cognee search result referenced an unexpected dataset.');
    }
    const contexts = typeof result.context_result === 'string'
      ? [result.context_result]
      : Array.isArray(result.context_result) && result.context_result.every((item) => typeof item === 'string')
        ? result.context_result
        : [];
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    if (contexts.length > 0 && evidence.length === 0) {
      return malformed('Cognee search result contained context without source references.');
    }
    for (let index = 0; index < evidence.length; index += 1) {
      const reference = evidence[index];
      if (!isProviderObject(reference) ||
          typeof reference.artifact_id !== 'string' ||
          typeof reference.dataset_id !== 'string' ||
          typeof reference.data_id !== 'string' ||
          reference.dataset_id !== expectedDatasetId) {
        return malformed('Cognee evidence did not include a valid dataset and data reference.');
      }
      const text = contexts[index] ?? contexts[0];
      if (!text?.trim()) {
        return malformed('Cognee evidence did not include source context.');
      }
      candidates.push({
        text,
        source: {
          datasetId: reference.dataset_id,
          dataId: reference.data_id,
          artifactId: reference.artifact_id,
          ...(typeof reference.chunk_id === 'string' ? { chunkId: reference.chunk_id } : {}),
          ...(typeof reference.rank === 'number' ? { rank: reference.rank } : {}),
          ...(typeof reference.score === 'number' ? { score: reference.score } : {}),
        },
      });
    }
  }
  return candidates.length === 0 ? { status: 'no_hit', candidates: [] } : { status: 'completed', candidates };
}

export function mapCogneeDataset(value: unknown): ExperienceIndexDataset {
  if (!isProviderObject(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return malformed('Cognee dataset response was malformed.');
  }
  return { id: value.id, name: value.name };
}

export function mapCogneeRun(value: unknown, datasetId: string): ExperienceIndexRun {
  let run = value;
  if (isProviderObject(value) && isProviderObject(value[datasetId])) run = value[datasetId];
  if (!isProviderObject(run) || typeof run.pipeline_run_id !== 'string' || typeof run.status !== 'string') {
    return malformed('Cognee pipeline response was malformed.');
  }
  return { datasetId, runId: run.pipeline_run_id, status: run.status };
}

export function mapCogneeBuildStatus(value: unknown, datasetId: string): ExperienceIndexBuildStatus {
  if (!isProviderObject(value)) return malformed('Cognee status response was malformed.');
  const status = value[datasetId];
  if (status === undefined) return 'missing';
  if (status === 'pending' || status === 'running' || status === 'completed' || status === 'failed') return status;
  return malformed('Cognee build status was unknown.');
}

export function mapCogneeSources(value: unknown, datasetId: string): ExperienceIndexSourceRecord[] {
  if (!Array.isArray(value)) return malformed('Cognee source list response was malformed.');
  return value.map((item) => {
    if (!isProviderObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' ||
        item.datasetId !== datasetId || !isProviderObject(item.externalMetadata)) {
      return malformed('Cognee source record did not include governed metadata.');
    }
    return { datasetId, dataId: item.id, name: item.name, metadata: item.externalMetadata };
  });
}
