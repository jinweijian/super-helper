export const EXPERIENCE_INDEX_CAPABILITY_VERSION = 'experience-index/v1' as const;

export interface ExperienceIndexSourceReference {
  datasetId: string;
  dataId: string;
  artifactId: string;
  chunkId?: string;
  rank?: number;
  score?: number;
}

export interface ExperienceIndexCandidate {
  text: string;
  source: ExperienceIndexSourceReference;
}

export interface ExperienceIndexQuery {
  query: string;
  datasetId: string;
  topK?: number;
}

export type ExperienceIndexQueryResult =
  | { status: 'completed'; candidates: ExperienceIndexCandidate[] }
  | { status: 'no_hit'; candidates: [] };

export interface ExperienceIndexRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PublishedExperienceIndexInput {
  fileName: string;
  markdown: string;
  experienceId: string;
  revision: string;
  contentHash: string;
}

export interface ExperienceIndexDataset { id: string; name: string }
export interface ExperienceIndexSourceRecord {
  datasetId: string;
  dataId: string;
  name: string;
  metadata: Record<string, unknown>;
}
export interface ExperienceIndexRun { datasetId: string; runId: string; status: string }
export type ExperienceIndexBuildStatus = 'pending' | 'running' | 'completed' | 'failed' | 'missing';

export interface ExperienceIndexPort {
  readonly id: string;
  readonly capabilityVersion: typeof EXPERIENCE_INDEX_CAPABILITY_VERSION;
  createDataset(name: string, options?: ExperienceIndexRequestOptions): Promise<ExperienceIndexDataset>;
  ingest(datasetId: string, input: PublishedExperienceIndexInput, options?: ExperienceIndexRequestOptions): Promise<ExperienceIndexRun>;
  startBuild(datasetId: string, options?: ExperienceIndexRequestOptions): Promise<ExperienceIndexRun>;
  getBuildStatus(datasetId: string, options?: ExperienceIndexRequestOptions): Promise<ExperienceIndexBuildStatus>;
  listSources(datasetId: string, options?: ExperienceIndexRequestOptions): Promise<ExperienceIndexSourceRecord[]>;
  readSource(datasetId: string, dataId: string, options?: ExperienceIndexRequestOptions): Promise<Uint8Array>;
  removeSource(datasetId: string, dataId: string, options?: ExperienceIndexRequestOptions): Promise<void>;
  query(input: ExperienceIndexQuery, options?: ExperienceIndexRequestOptions): Promise<ExperienceIndexQueryResult>;
}

/**
 * Stable application boundary for the future knowledge-graph backend.
 * Cognee is one provider; it is never the source of truth for experience
 * publication, authorization, or user-facing conclusions.
 */
export interface ExperienceGraphProvider extends ExperienceIndexPort {
  readonly capabilityVersion: typeof EXPERIENCE_INDEX_CAPABILITY_VERSION;
}
