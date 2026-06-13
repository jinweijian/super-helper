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
