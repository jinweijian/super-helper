import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { SuperHelperConfig } from '../config.js';
import { chunksPath, dirtyFlagPath, knowledgeRoot, manifestPath } from './paths.js';
import { resolveKnowledgeWorkspaceRoot, workspaceKnowledgeKey } from './storage-scope.js';
import { discoverKnowledgeDocuments } from './documents/discovery.js';
import { checkKnowledgeVectorCompatibility } from './vector-index.js';
import type { KnowledgeEvidencePack, KnowledgeIndexManifest, KnowledgeSearchQuery } from './types.js';

export type KnowledgeHealthStatus = 'ok' | 'warn' | 'error' | 'off';

export interface KnowledgeHealthSummary {
  serviceBinding: {
    status: KnowledgeHealthStatus;
    workspaceId: string;
    workspaceRoot: string;
    workspaceKey: string;
    knowledgeWorkspaceRoot: string;
    knowledgeRoot: string;
    message: string;
  };
  index: {
    status: KnowledgeHealthStatus;
    manifestExists: boolean;
    chunksExists: boolean;
    dirty: boolean;
    documentCount: number;
    chunkCount: number;
    sourceDocumentCount: number;
    updatedAt?: string;
    message: string;
  };
  search: {
    status: KnowledgeHealthStatus;
    query: string;
    searchedFiles: number;
    matchedFiles: number;
    filteredOut: Array<{ reason: string; count: number }>;
    reason: string;
  };
  embedding: {
    status: KnowledgeHealthStatus;
    message: string;
  };
  similarWorkspaces: KnowledgeSimilarWorkspace[];
  actions: string[];
}

export interface KnowledgeSimilarWorkspace {
  key: string;
  path: string;
  documentCount: number;
  chunkCount: number;
  sourceDocumentCount: number;
  updatedAt?: string;
}

export type KnowledgeHealthRetriever = (query: KnowledgeSearchQuery) => Promise<KnowledgeEvidencePack>;

export async function buildKnowledgeHealthSummary(input: {
  config: SuperHelperConfig;
  workspaceId: string;
  query?: string;
  retrieveEvidence?: KnowledgeHealthRetriever;
}): Promise<KnowledgeHealthSummary> {
  const workspace = input.config.workspaces.find((item) => item.id === input.workspaceId) ?? input.config.workspaces[0];
  const workspaceRoot = workspace?.rootPath ? resolve(workspace.rootPath) : '';
  const workspaceKey = workspace ? workspaceKnowledgeKey(workspace) : 'unknown-workspace';
  const knowledgeWorkspaceRoot = resolveKnowledgeWorkspaceRoot(input.config, workspace?.id ?? input.workspaceId);
  const resolvedKnowledgeRoot = knowledgeRoot(knowledgeWorkspaceRoot);
  const knowledgeRootExists = existsSync(resolvedKnowledgeRoot);
  const manifest = readManifestSafe(manifestPath(knowledgeWorkspaceRoot));
  const chunksExists = existsSync(chunksPath(knowledgeWorkspaceRoot));
  const dirty = existsSync(dirtyFlagPath(knowledgeWorkspaceRoot));
  const docs = knowledgeRootExists ? discoverKnowledgeDocuments(knowledgeWorkspaceRoot) : [];
  const embedding = embeddingHealth(input.config, knowledgeWorkspaceRoot);
  const query = input.query?.trim() || '';
  const search = await searchHealth({
    workspaceRoot: knowledgeWorkspaceRoot,
    query,
    rootExists: knowledgeRootExists,
    docsCount: docs.length,
    retrieveEvidence: input.retrieveEvidence,
  });

  return {
    serviceBinding: {
      status: knowledgeRootExists ? 'ok' : 'error',
      workspaceId: workspace?.id ?? input.workspaceId,
      workspaceRoot,
      workspaceKey,
      knowledgeWorkspaceRoot,
      knowledgeRoot: resolvedKnowledgeRoot,
      message: knowledgeRootExists
        ? '当前服务已绑定知识库工作区'
        : '当前服务没有对应知识库目录',
    },
    index: {
      status: indexStatus({ rootExists: knowledgeRootExists, manifestExists: Boolean(manifest), chunksExists, dirty }),
      manifestExists: Boolean(manifest),
      chunksExists,
      dirty,
      documentCount: manifest?.document_count ?? docs.length,
      chunkCount: manifest?.chunk_count ?? 0,
      sourceDocumentCount: manifest?.source_document_count ?? 0,
      updatedAt: manifest?.updated_at,
      message: indexMessage({ rootExists: knowledgeRootExists, manifestExists: Boolean(manifest), chunksExists, dirty }),
    },
    search,
    embedding,
    similarWorkspaces: findSimilarKnowledgeWorkspaces(input.config, knowledgeWorkspaceRoot),
    actions: ['绑定知识库', '重建索引', '运行健康检查'],
  };
}

function embeddingHealth(config: SuperHelperConfig, workspaceRoot: string): KnowledgeHealthSummary['embedding'] {
  if (!config.embedding?.enabled) {
    return {
      status: 'off',
      message: 'Embedding 向量索引未启用，当前仅检查关键词索引健康度',
    };
  }

  const compatibility = checkKnowledgeVectorCompatibility({
    workspaceRoot,
    embeddingConfig: config.embedding,
  });
  if (compatibility.status === 'compatible') {
    return {
      status: 'ok',
      message: `Embedding 向量索引可用，vectors=${compatibility.manifest?.vector_count ?? 0}`,
    };
  }
  return {
    status: 'warn',
    message: `Embedding 已启用，但向量索引需要重建：${compatibility.status}`,
  };
}

async function searchHealth(input: {
  workspaceRoot: string;
  query: string;
  rootExists: boolean;
  docsCount: number;
  retrieveEvidence?: KnowledgeHealthRetriever;
}): Promise<KnowledgeHealthSummary['search']> {
  if (!input.rootExists) {
    return {
      status: 'error',
      query: input.query,
      searchedFiles: 0,
      matchedFiles: 0,
      filteredOut: [],
      reason: 'knowledge workspace is not initialized for the current service',
    };
  }
  if (input.docsCount === 0) {
    return {
      status: 'warn',
      query: input.query,
      searchedFiles: 0,
      matchedFiles: 0,
      filteredOut: [],
      reason: 'knowledge workspace has no active documents',
    };
  }
  if (!input.query) {
    return {
      status: 'ok',
      query: '',
      searchedFiles: input.docsCount,
      matchedFiles: 0,
      filteredOut: [],
      reason: 'waiting for a case query',
    };
  }
  if (!input.retrieveEvidence) {
    return {
      status: 'warn',
      query: input.query,
      searchedFiles: input.docsCount,
      matchedFiles: 0,
      filteredOut: [],
      reason: 'configured retrieval health check is not available at this boundary',
    };
  }

  const evidencePack = await input.retrieveEvidence({
    workspaceRoot: input.workspaceRoot,
    query: input.query,
    limit: 5,
  });
  return {
    status: evidencePack.results.length ? 'ok' : 'warn',
    query: input.query,
    searchedFiles: evidencePack.coverage.searched_files,
    matchedFiles: evidencePack.coverage.matched_files,
    filteredOut: evidencePack.coverage.filtered_out,
    reason: evidencePack.results.length
      ? 'configured retrieval returned evidence for the current query'
      : 'configured retrieval returned no evidence for the current query',
  };
}

function indexStatus(input: {
  rootExists: boolean;
  manifestExists: boolean;
  chunksExists: boolean;
  dirty: boolean;
}): KnowledgeHealthStatus {
  if (!input.rootExists || !input.manifestExists || !input.chunksExists) {
    return 'error';
  }
  if (input.dirty) {
    return 'warn';
  }
  return 'ok';
}

function indexMessage(input: {
  rootExists: boolean;
  manifestExists: boolean;
  chunksExists: boolean;
  dirty: boolean;
}): string {
  if (!input.rootExists) {
    return '知识库目录不存在';
  }
  if (!input.manifestExists) {
    return 'manifest.json 缺失';
  }
  if (!input.chunksExists) {
    return 'chunks.jsonl 缺失';
  }
  if (input.dirty) {
    return '索引已标记 dirty，需要重建';
  }
  return '关键词索引可用';
}

function findSimilarKnowledgeWorkspaces(
  config: SuperHelperConfig,
  currentKnowledgeWorkspaceRoot: string,
): KnowledgeSimilarWorkspace[] {
  const workspacesRoot = join(resolve(config.knowledge.rootDir), 'workspaces');
  if (!existsSync(workspacesRoot)) {
    return [];
  }

  return readdirSync(workspacesRoot)
    .map((name) => join(workspacesRoot, name))
    .filter((path) => path !== currentKnowledgeWorkspaceRoot)
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap((path) => {
      const manifest = readManifestSafe(manifestPath(path));
      if (!manifest) {
        return [];
      }
      return [{
        key: basename(path),
        path,
        documentCount: manifest.document_count,
        chunkCount: manifest.chunk_count,
        sourceDocumentCount: manifest.source_document_count,
        updatedAt: manifest.updated_at,
      }];
    })
    .sort((a, b) => b.documentCount - a.documentCount)
    .slice(0, 4);
}

function readManifestSafe(path: string): KnowledgeIndexManifest | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeIndexManifest;
  } catch {
    return undefined;
  }
}
