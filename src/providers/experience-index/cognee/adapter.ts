import {
  EXPERIENCE_INDEX_CAPABILITY_VERSION,
  type ExperienceIndexBuildStatus,
  type ExperienceIndexDataset,
  type ExperienceIndexQuery,
  type ExperienceIndexQueryResult,
  type ExperienceIndexRequestOptions,
  type ExperienceIndexRun,
  type ExperienceIndexSourceRecord,
  type PublishedExperienceIndexInput,
} from '../../../contracts/experience-index.js';
import { ProviderError, isProviderError } from '../../errors.js';
import { isAbortError, parseJsonBody, providerStatusError, type ProviderFetch } from '../../http.js';
import type { ExperienceIndexProvider, ExperienceIndexProviderConfig } from '../contract.js';
import { resolveCogneeEndpoint } from './endpoint.js';
import {
  buildCogneeQueryRequest,
  mapCogneeBuildStatus,
  mapCogneeDataset,
  mapCogneeQueryResponse,
  mapCogneeRun,
  mapCogneeSources,
} from './protocol.js';

export class CogneeExperienceIndexProvider implements ExperienceIndexProvider {
  readonly id = 'cognee';
  readonly capabilityVersion = EXPERIENCE_INDEX_CAPABILITY_VERSION;

  constructor(private readonly config: ExperienceIndexProviderConfig, private readonly fetchImpl: ProviderFetch) {}

  private authHeaders(): Record<string, string> {
    if (!this.config.token) {
      throw new ProviderError({ provider: this.id, code: 'missing_credentials', retryable: false, safeMessage: 'Cognee access token is required.' });
    }
    return { Authorization: `Bearer ${this.config.token}` };
  }

  private async request(path: string, init: RequestInit, options: ExperienceIndexRequestOptions, binary = false): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new ProviderError({
        provider: this.id,
        code: 'cancelled',
        retryable: false,
        safeMessage: 'Cognee request was cancelled.',
      });
    }
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.fetchImpl(resolveCogneeEndpoint(this.config.baseUrl, path), {
        ...init,
        headers: { ...this.authHeaders(), ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      if (!response.ok) throw providerStatusError({ provider: this.id, status: response.status, parsed: {}, operation: path });
      if (binary) return new Uint8Array(await response.arrayBuffer());
      if (response.status === 204 || response.headers.get('content-length') === '0') return {};
      const bodyText = await response.text();
      return parseJsonBody(bodyText, { provider: this.id, safeMessage: 'Cognee response body was not valid JSON.' });
    } catch (error) {
      if (isProviderError(error)) throw error;
      if (isAbortError(error)) {
        const cancelled = options.signal?.aborted && !timedOut;
        throw new ProviderError({
          provider: this.id,
          code: cancelled ? 'cancelled' : 'timeout',
          retryable: !cancelled,
          safeMessage: cancelled ? 'Cognee request was cancelled.' : `Cognee request timed out after ${timeoutMs}ms.`,
          cause: error,
        });
      }
      throw new ProviderError({ provider: this.id, code: 'network_error', retryable: true, safeMessage: 'Cognee network request failed.', cause: error });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  async createDataset(name: string, options: ExperienceIndexRequestOptions = {}): Promise<ExperienceIndexDataset> {
    return mapCogneeDataset(await this.request('datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }, options));
  }

  async ingest(datasetId: string, input: PublishedExperienceIndexInput, options: ExperienceIndexRequestOptions = {}): Promise<ExperienceIndexRun> {
    const body = new FormData();
    body.set('datasetId', datasetId);
    body.set('run_in_background', 'false');
    body.set('external_metadata', JSON.stringify([{ experience_id: input.experienceId, revision: input.revision, content_hash: input.contentHash }]));
    body.set('data', new Blob([input.markdown], { type: 'text/markdown' }), input.fileName);
    return mapCogneeRun(await this.request('add', { method: 'POST', body }, options), datasetId);
  }

  async startBuild(datasetId: string, options: ExperienceIndexRequestOptions = {}): Promise<ExperienceIndexRun> {
    return mapCogneeRun(await this.request('cognify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset_ids: [datasetId], run_in_background: true }),
    }, options), datasetId);
  }

  async getBuildStatus(datasetId: string, options: ExperienceIndexRequestOptions = {}): Promise<ExperienceIndexBuildStatus> {
    const query = new URLSearchParams([['dataset', datasetId], ['pipeline', 'cognify_pipeline']]);
    return mapCogneeBuildStatus(await this.request(`datasets/status?${query}`, { method: 'GET' }, options), datasetId);
  }

  async listSources(datasetId: string, options: ExperienceIndexRequestOptions = {}): Promise<ExperienceIndexSourceRecord[]> {
    return mapCogneeSources(await this.request(`datasets/${encodeURIComponent(datasetId)}/data`, { method: 'GET' }, options), datasetId);
  }

  async readSource(datasetId: string, dataId: string, options: ExperienceIndexRequestOptions = {}): Promise<Uint8Array> {
    return await this.request(`datasets/${encodeURIComponent(datasetId)}/data/${encodeURIComponent(dataId)}/raw`, { method: 'GET' }, options, true) as Uint8Array;
  }

  async removeSource(datasetId: string, dataId: string, options: ExperienceIndexRequestOptions = {}): Promise<void> {
    await this.request(`datasets/${encodeURIComponent(datasetId)}/data/${encodeURIComponent(dataId)}`, { method: 'DELETE' }, options);
  }

  async query(input: ExperienceIndexQuery, options: ExperienceIndexRequestOptions = {}): Promise<ExperienceIndexQueryResult> {
    const value = await this.request('search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCogneeQueryRequest(input)),
    }, options);
    return mapCogneeQueryResponse(value, input.datasetId);
  }
}
