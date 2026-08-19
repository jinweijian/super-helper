import type {
  RedmineEvidenceBlock,
  RedmineIssueCandidate,
  RedmineIssueCaseDetails,
} from '../contracts.js';
import type { RedmineRawIssue } from './protocol.js';

const ALLOWED_CUSTOM_FIELDS = new Set([
  '产品',
  '版本',
  '环境',
  '根因',
  '解决方案',
  '排查过程',
  '复现步骤',
]);

export function normalizeIssueCandidate(issue: RedmineRawIssue): RedmineIssueCandidate {
  const identities = collectIdentityTokens(issue);
  return compact({
    issueId: issue.id,
    subject: limitText(sanitizeText(issue.subject, identities), 300),
    descriptionExcerpt: limitText(sanitizeText(issue.description ?? '', identities), 1_000),
    tracker: safeLabel(issue.tracker?.name),
    status: safeLabel(issue.status?.name),
    priority: safeLabel(issue.priority?.name),
    fixedVersion: safeLabel(issue.fixed_version?.name),
    updatedAt: safeTimestamp(issue.updated_on),
    sourceLocator: `redmine:issue:${issue.id}`,
  });
}

export function normalizeIssueDetails(issue: RedmineRawIssue): RedmineIssueCaseDetails {
  const identities = collectIdentityTokens(issue);
  const evidenceBlocks: RedmineEvidenceBlock[] = [];
  const description = limitText(sanitizeText(issue.description ?? '', identities), 8_000);
  if (description) {
    evidenceBlocks.push({
      id: `redmine:${issue.id}:description`,
      kind: 'description',
      text: description,
    });
  }

  for (const field of issue.custom_fields) {
    if (!ALLOWED_CUSTOM_FIELDS.has(field.name)) continue;
    const value = Array.isArray(field.value) ? field.value.join('；') : field.value ?? '';
    const text = limitText(sanitizeText(value, identities), 2_000);
    if (!text) continue;
    evidenceBlocks.push({
      id: `redmine:${issue.id}:custom:${field.id}`,
      kind: 'custom_field',
      label: field.name,
      text,
    });
  }

  for (const journal of issue.journals) {
    if (journal.private_notes) continue;
    const text = limitText(sanitizeText(journal.notes, identities), 4_000);
    if (text) {
      evidenceBlocks.push(compact({
        id: `redmine:${issue.id}:journal:${journal.id}`,
        kind: 'journal' as const,
        text,
        occurredAt: safeTimestamp(journal.created_on),
      }));
    }
    for (let index = 0; index < journal.details.length; index += 1) {
      const change = journal.details[index];
      if (change.property !== 'attr' || change.name !== 'status_id') continue;
      evidenceBlocks.push(compact({
        id: `redmine:${issue.id}:status:${journal.id}:${index}`,
        kind: 'status_change' as const,
        occurredAt: safeTimestamp(journal.created_on),
        metadata: {
          from: change.old_value ?? null,
          to: change.new_value ?? null,
        },
      }));
    }
  }

  if (issue.relations.length > 0) {
    const relatedIssueIds = [...new Set(issue.relations.flatMap((relation) => [
      relation.issue_id,
      relation.issue_to_id,
    ]).filter((id): id is number => Boolean(id) && id !== issue.id))];
    if (relatedIssueIds.length > 0) {
      evidenceBlocks.push({
        id: `redmine:${issue.id}:relations`,
        kind: 'relation',
        metadata: { relatedIssueIds },
      });
    }
  }

  if (issue.attachments.length > 0) {
    evidenceBlocks.push({
      id: `redmine:${issue.id}:attachments`,
      kind: 'attachment_metadata',
      metadata: {
        count: issue.attachments.length,
        items: issue.attachments.map((attachment) => compact({
          mimeType: safeMimeType(attachment.content_type),
          size: attachment.filesize,
        })),
      },
    });
  }

  return compact({
    issueId: issue.id,
    subject: limitText(sanitizeText(issue.subject, identities), 300),
    tracker: safeLabel(issue.tracker?.name),
    status: safeLabel(issue.status?.name),
    priority: safeLabel(issue.priority?.name),
    fixedVersion: safeLabel(issue.fixed_version?.name),
    updatedAt: safeTimestamp(issue.updated_on),
    sourceLocator: `redmine:issue:${issue.id}`,
    evidenceBlocks,
  });
}

function collectIdentityTokens(issue: RedmineRawIssue): string[] {
  const references = [
    issue.author,
    issue.assigned_to,
    ...issue.watchers,
    ...issue.journals.map((journal) => journal.user),
    ...issue.attachments.map((attachment) => attachment.author),
  ];
  const values = new Set<string>();
  for (const reference of references) {
    if (!reference) continue;
    for (const value of [reference.name, reference.login, reference.mail]) {
      const normalized = value?.trim();
      if (!normalized) continue;
      values.add(normalized);
      for (const token of normalized.split(/[\s()（）<>]+/u)) {
        if (token.length >= 2) values.add(token);
      }
    }
  }
  return [...values].sort((left, right) => right.length - left.length);
}

function sanitizeText(input: string, identities: readonly string[]): string {
  let text = input.normalize('NFKC');
  for (const identity of identities) {
    text = text.replaceAll(new RegExp(escapeRegExp(identity), 'giu'), '[已删除身份]');
  }
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[已删除邮箱]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[已删除IP]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[已删除手机号]')
    .replace(/\bhttps?:\/\/[^\s]+/giu, '[已删除链接]')
    .replace(/(?:用户|人员|user|author|assignee)\s*(?:id|ID|编号)?\s*[:：=#]?\s*\d+/giu, '[已删除人员标识]')
    .replace(/(?:token|cookie|session|authorization)\s*[:=]\s*[^\s,，;；]+/giu, '[已删除凭证]')
    .replace(/\s+/gu, ' ')
    .trim();
}

function safeLabel(value?: string): string | undefined {
  if (!value) return undefined;
  return limitText(value.replace(/[\r\n\t]/gu, ' ').trim(), 120) || undefined;
}

function safeMimeType(value?: string): string | undefined {
  if (!value || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu.test(value)) return undefined;
  return value.toLocaleLowerCase();
}

function safeTimestamp(value?: string): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function limitText(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length <= limit ? value : characters.slice(0, limit).join('');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
