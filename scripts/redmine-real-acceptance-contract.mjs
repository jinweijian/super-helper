const REQUIRED_SCENARIO_IDS = [
  'resolved_by_ticket',
  'not_resolved_by_ticket',
  'direction_helpful',
];

export function validateRealAcceptanceManifest(value) {
  if (!isRecord(value) || value.version !== 1 || value.workspaceId !== 'current' || !Array.isArray(value.scenarios)) {
    throw new Error('manifest_shape_invalid');
  }
  const ids = value.scenarios.map((item) => isRecord(item) ? item.id : undefined);
  if (
    value.scenarios.length !== REQUIRED_SCENARIO_IDS.length ||
    new Set(ids).size !== REQUIRED_SCENARIO_IDS.length ||
    REQUIRED_SCENARIO_IDS.some((id) => !ids.includes(id))
  ) throw new Error('manifest_scenarios_invalid');
  for (const item of value.scenarios) {
    if (!isRecord(item) || typeof item.prompt !== 'string' || !item.prompt.trim() || Array.from(item.prompt).length > 2_000) {
      throw new Error('manifest_prompt_invalid');
    }
    if (Object.keys(item).some((key) => !['id', 'prompt'].includes(key))) {
      throw new Error('manifest_scenario_fields_invalid');
    }
  }
  return value;
}

export function evaluateRealScenario(id, session, logs) {
  const run = Array.isArray(session?.runs) ? session.runs.at(-1) : undefined;
  const result = isRecord(run?.result) ? run.result : {};
  const evidence = Array.isArray(result.evidence) ? result.evidence.filter(isRecord) : [];
  const claims = Array.isArray(result.claims) ? result.claims.filter(isRecord) : [];
  const evidenceKindById = new Map(evidence.map((item) => [item.id, item.kind]));
  const historicalPrimary = claims.find((claim) => (
    typeof claim.id === 'string' && claim.id.startsWith('historical_claim_') && claim.role === 'primary_answer'
  ));
  const historicalKinds = new Set(
    Array.isArray(historicalPrimary?.evidenceIds)
      ? historicalPrimary.evidenceIds.map((evidenceId) => evidenceKindById.get(evidenceId)).filter(Boolean)
      : [],
  );
  const evidenceKinds = [...new Set(evidence.map((item) => String(item.kind)))].sort();
  const search = phaseDetail(logs, 'historical_case_search_completed');
  const worker = phaseDetail(logs, 'current_project_verification_completed');
  const cross = phaseDetail(logs, 'historical_cross_review_completed');
  const review = phaseDetail(logs, 'evidence_validation_result');
  const final = result.status === 'concluded' && result.recommendedNextAction === 'final_answer';
  let passed = false;
  const requirements = [];

  if (id === 'resolved_by_ticket') {
    passed = final && Boolean(historicalPrimary) && historicalKinds.has('mcp') &&
      (historicalKinds.has('workspace') || historicalKinds.has('log')) &&
      search?.status === 'completed' && worker?.status === 'completed';
    if (!final) requirements.push('reviewed_final_missing');
    if (!historicalPrimary) requirements.push('historical_primary_missing');
    if (!historicalKinds.has('mcp')) requirements.push('current_redmine_evidence_missing');
    if (!historicalKinds.has('workspace') && !historicalKinds.has('log')) requirements.push('current_project_evidence_missing');
  } else if (id === 'not_resolved_by_ticket') {
    passed = !historicalPrimary && worker?.workerInvoked === true && !finalByHistoricalClaim(result, claims);
    if (historicalPrimary) requirements.push('historical_evidence_promoted');
    if (worker?.workerInvoked !== true) requirements.push('fallback_worker_missing');
  } else if (id === 'direction_helpful') {
    passed = !final && result.status === 'partial' && Boolean(historicalPrimary) &&
      historicalKinds.has('mcp') && search?.status === 'completed';
    if (final || result.status !== 'partial') requirements.push('direction_was_promoted');
    if (!historicalPrimary) requirements.push('historical_direction_missing');
    if (!historicalKinds.has('mcp')) requirements.push('historical_evidence_missing');
  } else {
    throw new Error('scenario_id_invalid');
  }

  return {
    id,
    status: passed ? 'PASS' : 'FAIL',
    actual: `${String(result.status ?? 'missing')}/${String(result.recommendedNextAction ?? 'missing')}`,
    redmineStatus: safeEnum(search?.status),
    workerStatus: safeEnum(worker?.status),
    workerInvoked: worker?.workerInvoked === true,
    verificationCount: safeCount(cross?.verificationCount),
    evidenceKinds,
    reviewDecision: safeEnum(review?.outcomeReasonCode),
    unmetRequirements: requirements,
    readOnlyAudit: worker?.workerInvoked === true ? 'worker_invoked' : 'worker_not_invoked',
  };
}

function finalByHistoricalClaim(result, claims) {
  return result.status === 'concluded' && result.recommendedNextAction === 'final_answer' &&
    claims.some((claim) => typeof claim.id === 'string' && claim.id.startsWith('historical_claim_'));
}

function phaseDetail(logs, phase) {
  const blocks = Array.isArray(logs?.blocks) ? logs.blocks : [];
  const block = blocks.find((item) => isRecord(item) && item.phase === phase);
  return isRecord(block?.detail) ? block.detail : undefined;
}

function safeEnum(value) {
  return typeof value === 'string' && /^[a-z_]+$/u.test(value) ? value : 'unavailable';
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 10_000) : 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
