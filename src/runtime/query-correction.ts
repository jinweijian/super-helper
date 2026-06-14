export function correctionActionsFor(input: {
  noHits: boolean;
  ambiguous: boolean;
  artifactTargets: string[];
}): string[] {
  const actions: string[] = [];
  if (input.noHits) {
    actions.push('expand_aliases');
    actions.push('expand_neighbor_modules');
    actions.push('broaden_source_types');
  }
  if (input.ambiguous) {
    actions.push('increase_parent_context');
    actions.push('add_related_terms_from_glossary');
  }
  if (input.artifactTargets.includes('scheduler')) {
    actions.push('pivot_scheduler_to_queue_callback_state');
  }
  if (input.artifactTargets.includes('route')) {
    actions.push('pivot_route_to_controller_service_config');
  }
  return actions.length ? actions : ['static_readonly_investigation'];
}

export interface DeepQueryPivotInput {
  previousArtifactTargets: string[];
  workerResultSummary?: string;
  judgeResult?: {
    answerable: boolean;
    blockers: string[];
  };
  attempt: number;
  maxAttempts: number;
}

export interface DeepQueryPivotResult {
  nextArtifactTargets: string[];
  correctionActions: string[];
  stopReason?: 'max_attempts' | 'sufficient_evidence' | 'needs_user' | 'human_escalation';
}

const PIVOT_FAMILIES: Record<string, string[]> = {
  scheduler: ['queue', 'callback', 'state_machine', 'state_update', 'job_dispatch', 'cron'],
  job: ['queue', 'worker', 'state_machine', 'retry_policy', 'cron'],
  cron: ['job_dispatch', 'state_machine', 'queue', 'callback'],
  task: ['queue', 'state_machine', 'retry_policy', 'worker'],
  route: ['controller', 'service', 'repository', 'config', 'feature_flag', 'middleware'],
  router: ['controller', 'service', 'repository', 'config', 'feature_flag'],
  controller: ['service', 'repository', 'config', 'middleware'],
  service: ['repository', 'config', 'middleware', 'feature_flag'],
  payment: ['order', 'refund', 'permission', 'audit_log', 'transaction_state', 'config'],
  order: ['payment', 'refund', 'transaction_state', 'audit_log'],
  refund: ['payment', 'order', 'permission', 'audit_log'],
  permission: ['auth', 'role', 'policy', 'tenant_scope', 'middleware', 'role_mapping'],
  auth: ['role', 'policy', 'tenant_scope', 'middleware', 'role_mapping'],
  role: ['policy', 'tenant_scope', 'permission', 'role_mapping'],
  config: ['env', 'settings', 'feature_flag', 'admin_ui', 'runtime_loader', 'default_config'],
  env: ['settings', 'feature_flag', 'admin_ui', 'runtime_loader'],
  settings: ['env', 'feature_flag', 'admin_ui', 'default_config'],
};

export function nextDeepQueryPivot(input: DeepQueryPivotInput): DeepQueryPivotResult {
  if (input.judgeResult?.answerable) {
    return {
      nextArtifactTargets: input.previousArtifactTargets,
      correctionActions: ['sufficient_evidence'],
      stopReason: 'sufficient_evidence',
    };
  }
  if (input.attempt >= input.maxAttempts) {
    return {
      nextArtifactTargets: input.previousArtifactTargets,
      correctionActions: ['max_attempts_reached'],
      stopReason: 'max_attempts',
    };
  }
  if (input.judgeResult?.blockers.includes('high_risk_uncertainty')) {
    return {
      nextArtifactTargets: input.previousArtifactTargets,
      correctionActions: ['escalate_to_human'],
      stopReason: 'human_escalation',
    };
  }
  if (input.judgeResult?.blockers.includes('no_active_evidence') || input.judgeResult?.blockers.includes('stale_knowledge')) {
    return {
      nextArtifactTargets: ['static_workspace_search', 'module_aliases', 'glossary'],
      correctionActions: ['expand_aliases', 'broaden_source_types', 'static_readonly_investigation'],
    };
  }

  const next = new Set<string>();
  const actions: string[] = [];
  for (const target of input.previousArtifactTargets) {
    const family = PIVOT_FAMILIES[target.toLowerCase()];
    if (family) {
      family.forEach((t) => next.add(t));
      actions.push(`pivot_${target}_to_${family[0]}`);
    }
  }
  // Fallback: if no pivot matched, do a no-hit broadening
  if (next.size === 0) {
    next.add('module_aliases');
    next.add('static_workspace_search');
    actions.push('expand_aliases', 'broaden_source_types');
  }
  return {
    nextArtifactTargets: Array.from(next),
    correctionActions: actions,
  };
}
