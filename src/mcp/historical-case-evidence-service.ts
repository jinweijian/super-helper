import * as z from 'zod/v4';
import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRequest, Evidence } from '../domain.js';
import type { RedmineIssueCandidate, RedmineIssueCaseDetails } from '../mcp-servers/redmine/contracts.js';
import type { CoverageEvidenceEnvelope } from '../runtime/coverage-evidence-provenance.js';
import type { McpClientFactory, McpClientPort, McpServerConfig } from './contracts.js';
import { createSdkMcpClient } from './sdk-client.js';
import {
  executeMcpTool,
  materializeMcpTransportConfig,
  validateMcpExecutionPolicy,
} from './policy.js';

const SEARCH_TOOL = 'redmine_search_issues';
const DETAIL_TOOL = 'redmine_get_issue_case_details';

const CandidateSchema = z.object({
  issueId: z.number().int().positive(),
  subject: z.string(),
  descriptionExcerpt: z.string(),
  tracker: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  fixedVersion: z.string().optional(),
  updatedAt: z.string().optional(),
  sourceLocator: z.string(),
}).strict();

const BlockSchema = z.object({
  id: z.string(),
  kind: z.enum(['description', 'custom_field', 'journal', 'status_change', 'relation', 'attachment_metadata']),
  label: z.string().optional(),
  text: z.string().optional(),
  occurredAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const DetailSchema = z.object({
  issueId: z.number().int().positive(),
  subject: z.string(),
  tracker: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  fixedVersion: z.string().optional(),
  updatedAt: z.string().optional(),
  sourceLocator: z.string(),
  evidenceBlocks: z.array(BlockSchema),
}).strict();

const SearchResponseSchema = z.union([
  z.object({ status: z.literal('completed'), searchId: z.string(), candidates: z.array(CandidateSchema) }).strict(),
  z.object({ status: z.literal('no_hit'), candidates: z.tuple([]) }).strict(),
  z.object({ status: z.enum(['timeout', 'failed']), candidates: z.tuple([]), safeErrorCode: z.string() }).strict(),
]);

const DetailResponseSchema = z.union([
  z.object({
    status: z.literal('completed'),
    details: z.array(DetailSchema),
    omittedBlocks: z.number().int().nonnegative(),
    truncated: z.boolean(),
    originalCharacters: z.number().int().nonnegative(),
    outputCharacters: z.number().int().nonnegative(),
  }).strict(),
  z.object({ status: z.enum(['timeout', 'failed']), details: z.tuple([]), safeErrorCode: z.string() }).strict(),
]);

export type HistoricalCaseSourceStatus = 'completed' | 'no_hit' | 'timeout' | 'failed';

export interface HistoricalCaseEvidenceOutcome {
  status: HistoricalCaseSourceStatus;
  candidates: RedmineIssueCandidate[];
  details: RedmineIssueCaseDetails[];
  evidence: Evidence[];
  coverageEvidenceEnvelopes: CoverageEvidenceEnvelope[];
  safeErrorCode?: string;
}

export class HistoricalCaseEvidenceService {
  private readonly createClient: McpClientFactory;

  constructor(
    private readonly config: SuperHelperConfig,
    private readonly options: {
      createClient?: McpClientFactory;
      resolveSecret?: Parameters<typeof executeMcpTool>[0]['resolveSecret'];
    } = {},
  ) {
    this.createClient = options.createClient ?? createSdkMcpClient;
  }

  async investigate(input: {
    request: DiagnosticRequest;
    query: string;
    signals: string[];
    selectIssueIds: (candidates: RedmineIssueCandidate[]) => Promise<number[]>;
  }): Promise<HistoricalCaseEvidenceOutcome> {
    const resolved = this.resolveSource(input.request);
    if (!resolved) return emptyOutcome('failed', 'source_configuration_invalid');
    const { workspace, server } = resolved;
    for (const toolName of [SEARCH_TOOL, DETAIL_TOOL]) {
      const rejection = validateMcpExecutionPolicy({
        server,
        workspace,
        toolName,
        stdioCommandWhitelist: this.config.claude.commandWhitelist,
      });
      if (rejection) return emptyOutcome('failed', rejection);
    }

    let client: McpClientPort | undefined;
    try {
      const transport = materializeMcpTransportConfig(
        server,
        this.options.resolveSecret ?? defaultSecretResolver,
      );
      client = await this.createClient({ server, transport });
      const searchExecution = await executeMcpTool({
        server,
        workspace,
        toolName: SEARCH_TOOL,
        arguments: { query: input.query, signals: input.signals },
        stdioCommandWhitelist: this.config.claude.commandWhitelist,
        createClient: this.createClient,
        resolveSecret: this.options.resolveSecret,
        existingClient: client,
      });
      if (searchExecution.status !== 'completed') {
        return emptyOutcome(searchExecution.reason === 'timeout' ? 'timeout' : 'failed', searchExecution.reason);
      }
      const searchResponse = parseStructured(SearchResponseSchema, searchExecution.result);
      if (!searchResponse) return emptyOutcome('failed', 'invalid_response');
      if (searchResponse.status !== 'completed') {
        return emptyOutcome(searchResponse.status, 'safeErrorCode' in searchResponse
          ? searchResponse.safeErrorCode
          : undefined);
      }

      const selected = await input.selectIssueIds(searchResponse.candidates);
      if (!validSelection(selected, searchResponse.candidates)) {
        return {
          ...emptyOutcome(selected.length === 0 ? 'no_hit' : 'failed', selected.length === 0 ? undefined : 'candidate_selection_invalid'),
          candidates: searchResponse.candidates,
        };
      }
      const detailExecution = await executeMcpTool({
        server,
        workspace,
        toolName: DETAIL_TOOL,
        arguments: { searchId: searchResponse.searchId, issueIds: selected },
        stdioCommandWhitelist: this.config.claude.commandWhitelist,
        createClient: this.createClient,
        resolveSecret: this.options.resolveSecret,
        existingClient: client,
      });
      if (detailExecution.status !== 'completed') {
        return {
          ...emptyOutcome(detailExecution.reason === 'timeout' ? 'timeout' : 'failed', detailExecution.reason),
          candidates: searchResponse.candidates,
        };
      }
      const detailResponse = parseStructured(DetailResponseSchema, detailExecution.result);
      if (!detailResponse) return emptyOutcome('failed', 'invalid_response');
      if (detailResponse.status !== 'completed') {
        return {
          ...emptyOutcome(detailResponse.status, detailResponse.safeErrorCode),
          candidates: searchResponse.candidates,
        };
      }
      const evidence = detailResponse.details.map((detail, index) => evidenceFromDetail(detail, index));
      return {
        status: evidence.length > 0 ? 'completed' : 'no_hit',
        candidates: searchResponse.candidates,
        details: detailResponse.details,
        evidence,
        coverageEvidenceEnvelopes: evidence.map((item) => ({
          evidenceId: item.id,
          kind: 'mcp',
          safeText: item.summary,
          freshness: 'current_mcp_call',
          validated: true,
          runId: input.request.runId,
          readOnly: true,
          allowlisted: true,
          completed: true,
        })),
      };
    } catch {
      return emptyOutcome('failed', 'transport_failure');
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  private resolveSource(request: DiagnosticRequest): {
    workspace: SuperHelperConfig['workspaces'][number];
    server: McpServerConfig;
  } | undefined {
    const workspace = this.config.workspaces.find((item) => item.id === request.workspaceId);
    const source = workspace?.historicalCaseSources?.length === 1
      ? workspace.historicalCaseSources[0]
      : undefined;
    const server = source ? this.config.mcpTools.find((item) => item.id === source.serverId) : undefined;
    if (
      !workspace ||
      !server ||
      !request.allowedMcpToolIds.includes(server.id) ||
      server.capability?.type !== 'historical_case' ||
      server.capability.provider !== 'redmine'
    ) return undefined;
    return { workspace, server };
  }
}

function parseStructured<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const structured = value && typeof value === 'object'
    ? (value as { structuredContent?: unknown }).structuredContent
    : undefined;
  if (typeof structured !== 'string') return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(structured));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function validSelection(selected: number[], candidates: RedmineIssueCandidate[]): boolean {
  if (selected.length < 1 || selected.length > 3 || new Set(selected).size !== selected.length) return false;
  const candidateIds = new Set(candidates.map((item) => item.issueId));
  return selected.every((id) => candidateIds.has(id));
}

function evidenceFromDetail(detail: RedmineIssueCaseDetails, index: number): Evidence {
  const text = [
    detail.subject,
    ...detail.evidenceBlocks.flatMap((block) => block.text ? [block.text] : []),
  ].join('；').slice(0, 1_600);
  return {
    id: `redmine_ev_${String(index + 1).padStart(2, '0')}`,
    kind: 'mcp',
    source: `mcp:redmine/${detail.sourceLocator}`,
    summary: text,
    confidence: 'medium',
  };
}

function emptyOutcome(
  status: Exclude<HistoricalCaseSourceStatus, 'completed'>,
  safeErrorCode?: string,
): HistoricalCaseEvidenceOutcome {
  return {
    status,
    candidates: [],
    details: [],
    evidence: [],
    coverageEvidenceEnvelopes: [],
    ...(safeErrorCode ? { safeErrorCode } : {}),
  };
}

function defaultSecretResolver(ref: { source: 'file'; key: string } | { source: 'env'; name: string }): string | undefined {
  return ref.source === 'env' ? process.env[ref.name] : undefined;
}
