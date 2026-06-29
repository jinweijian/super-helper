import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  indexesDir,
  knowledgeReportsRoot,
  qualityReportPath,
  sourceQualityReportPath,
} from './paths.js';
import type {
  KnowledgeQualityIssue,
  KnowledgeQualityReport,
  KnowledgeQualitySeverity,
} from './types.js';

export type KnowledgeQualityGate = 'warn' | 'strict' | 'off';

export function inferStage(issue: KnowledgeQualityIssue): string {
  switch (issue.code) {
    case 'parser_empty':
    case 'too_many_unknown_blocks':
    case 'toc_not_removed':
    case 'header_footer_noise':
    case 'table_lost':
    case 'list_structure_lost':
    case 'heading_structure_broken':
    case 'duplicate_paragraphs':
    case 'source_provenance_missing':
      return 'extract';
    case 'empty_body':
    case 'heading_only':
    case 'toc_like':
    case 'too_short':
    case 'too_long':
    case 'duplicate_content':
    case 'multi_topic_slice':
    case 'broken_coreference':
    case 'not_answer_bearing':
    case 'missing_source_document':
    case 'missing_source_document_id':
    case 'missing_source_block_ids':
    case 'missing_source_blocks':
    case 'missing_section_path':
    case 'missing_parent':
    case 'orphan_chunk':
    case 'low_signal_terms':
      return 'slice';
    default:
      return 'audit';
  }
}

export function recommendActions(issueCounts: Record<string, number>): string[] {
  const actions: string[] = [];
  if (issueCounts['empty_body'] || issueCounts['heading_only'] || issueCounts['too_short']) {
    actions.push('Re-run draft slice generation with relaxed thresholds or merge adjacent short slices.');
  }
  if (issueCounts['duplicate_content']) {
    actions.push('Review duplicate draft slices and remove non-canonical duplicates.');
  }
  if (issueCounts['missing_source_block_ids'] || issueCounts['missing_source_blocks']) {
    actions.push('Repair source block provenance for legacy slices.');
  }
  if (issueCounts['multi_topic_slice']) {
    actions.push('Split multi-topic slices on heading boundaries.');
  }
  if (issueCounts['not_answer_bearing']) {
    actions.push('Mark not_answer_bearing slices as review_required.');
  }
  if (issueCounts['low_signal_terms']) {
    actions.push('Add related_terms using titles, section paths, and high-signal module aliases.');
  }
  if (issueCounts['orphan_chunk'] || issueCounts['missing_parent']) {
    actions.push('Rebuild manifest and chunks to resolve orphan_chunk issues.');
  }
  if (issueCounts['source_provenance_missing']) {
    actions.push('Re-intake source files to restore sha256 and stored_path metadata.');
  }
  return actions;
}

export function writeKnowledgeQualityReport(input: { workspaceRoot: string; report: KnowledgeQualityReport }): string {
  mkdirSync(indexesDir(input.workspaceRoot), { recursive: true });
  const path = qualityReportPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8');
  return path;
}

export function readKnowledgeQualityReport(workspaceRoot: string): KnowledgeQualityReport | undefined {
  const path = qualityReportPath(workspaceRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeQualityReport;
  } catch {
    return undefined;
  }
}

export function writeSourceQualityReport(input: { workspaceRoot: string; report: KnowledgeQualityReport }): string {
  mkdirSync(knowledgeReportsRoot(input.workspaceRoot), { recursive: true });
  const path = sourceQualityReportPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(sourceQualityReportFromQualityReport(input.report), null, 2)}\n`, 'utf8');
  return path;
}

export function sourceQualityReportFromQualityReport(report: KnowledgeQualityReport): KnowledgeQualityReport {
  const sourceCodes = new Set<string>([
    'parser_empty',
    'too_many_unknown_blocks',
    'toc_not_removed',
    'header_footer_noise',
    'table_lost',
    'list_structure_lost',
    'heading_structure_broken',
    'duplicate_paragraphs',
    'source_provenance_missing',
  ]);
  const issues = report.issues.filter((issue) => sourceCodes.has(issue.code));
  const severityCounts: Record<KnowledgeQualitySeverity, number> = { info: 0, warn: 0, error: 0 };
  const issueCounts: Record<string, number> = {};
  const stageSummaries: Record<string, { warnings: number; errors: number; info: number }> = {};
  for (const issue of issues) {
    severityCounts[issue.severity] += 1;
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    const stage = inferStage(issue);
    const bucket = stageSummaries[stage] ?? { warnings: 0, errors: 0, info: 0 };
    if (issue.severity === 'error') bucket.errors += 1;
    else if (issue.severity === 'warn') bucket.warnings += 1;
    else bucket.info += 1;
    stageSummaries[stage] = bucket;
  }
  return {
    ...report,
    inspected: {
      sourceDocuments: report.inspected.sourceDocuments,
      draftSlices: 0,
      publishedSlices: 0,
      chunks: 0,
    },
    stageSummaries,
    severityCounts,
    issueCounts,
    issues,
    recommendedActions: recommendActions(issueCounts),
  };
}

export function readSourceQualityReport(workspaceRoot: string): KnowledgeQualityReport | undefined {
  const path = sourceQualityReportPath(workspaceRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeQualityReport;
  } catch {
    return undefined;
  }
}

export function evaluateQualityGate(report: KnowledgeQualityReport, gate: KnowledgeQualityGate): {
  passed: boolean;
  exitCode: number;
  reason?: string;
} {
  if (gate === 'off') {
    return { passed: true, exitCode: 0, reason: 'quality gate disabled' };
  }
  if (gate === 'warn') {
    if (report.severityCounts.error > 0) {
      return { passed: true, exitCode: 0, reason: `${report.severityCounts.error} error issues visible` };
    }
    return { passed: true, exitCode: 0 };
  }
  if (report.severityCounts.error > 0) {
    return {
      passed: false,
      exitCode: 2,
      reason: `Strict gate failed: ${report.severityCounts.error} error issues must be fixed before publishing.`,
    };
  }
  return { passed: true, exitCode: 0 };
}

export function loadChunkQualityMap(workspaceRoot: string): Map<string, { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] }> {
  const report = readKnowledgeQualityReport(workspaceRoot);
  const map = new Map<string, { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] }>();
  if (!report) {
    return map;
  }
  for (const issue of report.issues) {
    if (!issue.documentId) continue;
    const current = map.get(issue.documentId) ?? { severity: 'ok' as const, issues: [] as string[] };
    if (issue.severity === 'error') current.severity = 'error';
    else if (issue.severity === 'warn' && current.severity !== 'error') current.severity = 'warn';
    else if (issue.severity === 'info' && current.severity === 'ok') current.severity = 'info';
    current.issues.push(issue.code);
    map.set(issue.documentId, current);
  }
  return map;
}
