import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  KnowledgeAcceptanceCheck,
  KnowledgeAcceptanceReport,
  KnowledgeAcceptanceScenario,
  KnowledgeAcceptanceSeverity,
} from './types.js';

const REDACT_FIELDS = ['apiKey', 'api_key', 'authorization', 'token', 'password', 'cookie', 'secret', 'apikey', 'bearer', 'set-cookie', 'x-api-key'];

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (/Bearer\s+[A-Za-z0-9._-]{8,}/.test(value)) {
      return '[REDACTED:bearer]';
    }
    if (/sk-[A-Za-z0-9]{20,}/.test(value)) {
      return '[REDACTED:openai-key]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_FIELDS.some((field) => k.toLowerCase().includes(field))) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSecrets(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export interface BuildAcceptanceReportInput {
  workspaceRoot: string;
  configSummary: Record<string, string>;
  environmentSummary: Record<string, string>;
  scenarios: KnowledgeAcceptanceScenario[];
  failures: Array<{ scenarioId: string; reason: string }>;
}

export function buildAcceptanceReport(input: BuildAcceptanceReportInput): KnowledgeAcceptanceReport {
  const overallPassed = input.scenarios.every((s) => s.passed);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    configSummary: redactSecrets(input.configSummary) as Record<string, string>,
    environmentSummary: redactSecrets(input.environmentSummary) as Record<string, string>,
    redactionSummary: { fieldsRedacted: REDACT_FIELDS, secretsStripped: true },
    scenarios: input.scenarios.map((s) => ({
      ...s,
      checks: s.checks.map((c) => ({ ...c, redactedDetails: redactSecrets(c.redactedDetails) as Record<string, unknown> | undefined })),
    })),
    failures: input.failures,
    overallPassed,
  };
}

export function writeAcceptanceReport(input: { reportDir: string; report: KnowledgeAcceptanceReport }): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(input.reportDir, { recursive: true });
  const path = join(input.reportDir, `knowledge-acceptance-${ts}.json`);
  writeFileSync(path, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8');
  return path;
}

export function summarizeCheck(name: string, severity: KnowledgeAcceptanceSeverity, passed: boolean, message: string, details?: Record<string, unknown>): KnowledgeAcceptanceCheck {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    severity,
    passed,
    message,
    redactedDetails: details,
  };
}

export const __testing = { redactSecrets, REDACT_FIELDS };
