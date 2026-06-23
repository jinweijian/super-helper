import { discoverKnowledgeDocuments } from './discovery.js';
import { loadChunkQualityMap } from '../quality.js';
import type {
  KnowledgeDocument,
  KnowledgeQualitySeverity,
} from '../types.js';
import { loadKnowledgeTaxonomy } from '../taxonomy.js';

export interface KnowledgeParentGrounding {
  document: KnowledgeDocument;
  quality?: { severity: 'ok' | KnowledgeQualitySeverity; issues: string[] };
  taxonomyKnown: boolean;
}

export function loadKnowledgeParentGrounding(
  workspaceRoot: string,
): Map<string, KnowledgeParentGrounding> {
  const qualityByDocument = loadChunkQualityMap(workspaceRoot);
  const knownModules = new Set(loadKnowledgeTaxonomy(workspaceRoot).modules.map((module) => module.id));
  const parents = new Map<string, KnowledgeParentGrounding>();
  for (const document of discoverKnowledgeDocuments(workspaceRoot)) {
    const reportedQuality = qualityByDocument.get(document.frontmatter.id);
    const frontmatterQuality = qualityFromFrontmatter(document);
    const grounding = {
      document,
      quality: reportedQuality ?? frontmatterQuality,
      taxonomyKnown: knownModules.has(document.frontmatter.module),
    };
    parents.set(document.frontmatter.id, grounding);
    parents.set(document.relativePath, grounding);
  }
  return parents;
}

function qualityFromFrontmatter(
  document: KnowledgeDocument,
): KnowledgeParentGrounding['quality'] {
  const severity = document.frontmatter.quality_status;
  if (!severity || severity === 'unchecked') {
    return undefined;
  }
  return { severity, issues: [] };
}
