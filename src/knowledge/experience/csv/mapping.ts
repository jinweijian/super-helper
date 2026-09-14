import type { CsvFieldMapping, SourceField } from './contracts.js';

const aliases: Record<SourceField, string[]> = {
  ticketId: ['#', 'ID', '编号'], sourceProject: ['项目', 'Project'],
  title: ['主题', '标题', 'Subject'], description: ['描述', '问题描述', 'Description'],
  cause: ['工单问题原因', '问题原因', '根因', '原因分析'],
  actionAndResult: ['问题处理方法与结果', '处理办法', '解决方案', '处理过程'],
  followUp: ['后续计划'], latestNote: ['最近批注'], status: ['状态', 'Status'],
  product: ['所属产品', '产品'], affectedVersion: ['网校版本', '受影响版本'],
  targetVersion: ['目标版本'], fixedVersion: ['发布版本', '修复版本'],
  createdAt: ['创建于', '创建时间'], updatedAt: ['更新于', '更新时间'],
  attachments: ['文件', '附件'], relatedIssues: ['相关的问题', '关联工单'],
};

export const sourceFields = Object.keys(aliases) as SourceField[];

export function resolveCsvMapping(headers: string[], overrides: CsvFieldMapping = {}): CsvFieldMapping {
  const mapping: CsvFieldMapping = {};
  for (const [field, column] of Object.entries(overrides)) {
    if (!sourceFields.includes(field as SourceField) || !headers.includes(column)) {
      throw new Error('CSV_MAPPING_INVALID');
    }
  }
  for (const field of sourceFields) {
    if (Object.hasOwn(overrides, field)) {
      mapping[field] = overrides[field];
      continue;
    }
    const candidates = headers.filter((header) => aliases[field].includes(header.trim()));
    if (candidates.length > 1) throw new Error('CSV_MAPPING_AMBIGUOUS');
    if (candidates.length === 1) mapping[field] = candidates[0];
  }
  if (!mapping.ticketId || !mapping.title) throw new Error('CSV_MAPPING_REQUIRED');
  if (new Set(Object.values(mapping)).size !== Object.values(mapping).length) {
    throw new Error('CSV_MAPPING_AMBIGUOUS');
  }
  return mapping;
}
