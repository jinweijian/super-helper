import type { SuperHelperConfig } from '../config.js';
import { getModelProvider } from '../config.js';
import { HistoricalCaseEvidenceService } from '../mcp/historical-case-evidence-service.js';
import { McpEvidenceService, type McpEvidenceServiceOptions } from '../mcp/evidence-service.js';
import { createModelClient, type AgentModelClient } from '../providers/model/adapter.js';
import type { CaseRepository } from '../sessions/case-repository.js';
import type { AuthorityDiagnosticAdapter } from '../contracts/authority-diagnostic.js';
import { resolveAgentConfig } from './agent-configs.js';
import { CandidateRerankerService } from './case-investigation/candidate-reranker-service.js';
import { CaseInvestigationTurnService } from './case-investigation/case-investigation-turn-service.js';
import { HistoricalCaseAnalyzerService } from './case-investigation/historical-case-analyzer-service.js';
import { HistoricalCaseVerifierService } from './case-investigation/historical-case-verifier-service.js';
import { ParallelSourceCollector } from './case-investigation/parallel-source-collector.js';
import { QueryPlannerService } from './case-investigation/query-planner-service.js';
import { RedmineBranch } from './case-investigation/redmine-branch.js';
import { WorkerVerification } from './case-investigation/worker-verification.js';
import { CaseCurationService } from './case-curation-service.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { ExperienceTurnService } from './experience-turn.js';
import { KnowledgeExperienceEvidenceResolver } from './knowledge-experience-resolver.js';
import { KnowledgeTurnService } from './knowledge-turn.js';
import { PreflightService } from './preflight-service.js';
import { RagAnswerabilityService } from './rag-answerability-service.js';
import { ReviewPresentationService } from './review-presentation.js';
import { SessionLifecycle } from './session-lifecycle.js';
import { WorkerDiagnosisService } from './worker-diagnosis.js';
import type { InvestigationControl } from './investigation-control.js';

export interface RuntimeCompositionOptions {
  mcp?: McpEvidenceServiceOptions;
  model?: AgentModelClient;
}

export function createRuntimeServices(input: {
  config: SuperHelperConfig;
  store: CaseRepository;
  worker: AuthorityDiagnosticAdapter;
  options?: RuntimeCompositionOptions;
  investigationControl?: InvestigationControl;
}) {
  const { config, store, worker } = input;
  const options = input.options ?? {};
  const model = options.model ?? createModelClient(getModelProvider(config));
  const spec = (stage: Parameters<typeof resolveAgentConfig>[0]) => resolveAgentConfig(stage).content;
  const events = new CaseRuntimeEventRecorder(store);
  const reviewer = new ReviewPresentationService(
    config, model, events, spec('main'), spec('output_review'), spec('presentation'),
    spec('evidence_coverage'), spec('visible_prompt_safety'),
  );
  const sessions = new SessionLifecycle(config, store, events);
  const preflight = new PreflightService(
    config, store, model, events, spec('main'), spec('preflight'), spec('experience'),
    spec('answer_goal_completeness'),
  );
  const experienceTurn = new ExperienceTurnService(
    store, events, reviewer, new KnowledgeExperienceEvidenceResolver(config),
  );
  const knowledgeTurn = new KnowledgeTurnService(
    config,
    store,
    events,
    reviewer,
    new RagAnswerabilityService(
      model,
      spec('rag_answerability'),
      config.agent.ragAnswerabilityTopN ?? config.agent.evidenceCoverageTopN ?? 3,
    ),
  );
  const workerDiagnosis = new WorkerDiagnosisService(store, worker, events, reviewer, { config, control: input.investigationControl });
  const redmineBranch = new RedmineBranch({
    planner: new QueryPlannerService(model, spec('historical_search_query_planner')),
    evidence: new HistoricalCaseEvidenceService(config, options.mcp),
    reranker: new CandidateRerankerService(model, spec('historical_case_reranker')),
    analyzer: new HistoricalCaseAnalyzerService(model, spec('historical_case_analyzer')),
  });
  const caseInvestigation = new CaseInvestigationTurnService({
    store,
    events,
    reviewer,
    collector: new ParallelSourceCollector({
      knowledge: config.knowledge.onlineDiagnosisEnabled === false ? undefined : knowledgeTurn,
      experience: experienceTurn,
      redmine: redmineBranch,
      events,
    }),
    workerVerification: new WorkerVerification(workerDiagnosis),
    verifier: new HistoricalCaseVerifierService(model, spec('historical_case_verifier')),
  });
  return {
    events,
    sessions,
    preflight,
    experienceTurn,
    knowledgeTurn,
    workerDiagnosis,
    reviewer,
    caseCuration: new CaseCurationService(config, store, events),
    mcpEvidence: new McpEvidenceService(config, options.mcp),
    caseInvestigation,
  };
}
