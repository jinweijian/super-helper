import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  evaluateRealScenario,
  validateRealAcceptanceManifest,
} from '../scripts/redmine-real-acceptance-contract.mjs';

test('real acceptance manifest requires exactly three fixed scenario IDs and non-empty prompts', () => {
  const valid = {
    version: 1,
    workspaceId: 'current',
    scenarios: [
      { id: 'resolved_by_ticket', prompt: '真实场景一' },
      { id: 'not_resolved_by_ticket', prompt: '真实场景二' },
      { id: 'direction_helpful', prompt: '真实场景三' },
    ],
  };
  assert.deepEqual(validateRealAcceptanceManifest(valid), valid);
  assert.throws(() => validateRealAcceptanceManifest({ ...valid, scenarios: valid.scenarios.slice(0, 2) }), /manifest_scenarios_invalid/);
  assert.throws(() => validateRealAcceptanceManifest({ ...valid, scenarios: valid.scenarios.map((item) => ({ ...item, id: 'resolved_by_ticket' })) }), /manifest_scenarios_invalid/);
  assert.throws(() => validateRealAcceptanceManifest({ ...valid, scenarios: valid.scenarios.map((item, index) => index ? item : { ...item, prompt: '' }) }), /manifest_prompt_invalid/);
});

test('real acceptance evaluator enforces resolved, not-resolved, and direction structural gates', () => {
  const resolved = sessionFixture({ status: 'concluded', action: 'final_answer', historical: true, mcp: true, current: true });
  const notResolved = sessionFixture({ status: 'concluded', action: 'final_answer', historical: false, mcp: false, current: true });
  const direction = sessionFixture({ status: 'partial', action: 'continue_diagnosis', historical: true, mcp: true, current: true });

  assert.equal(evaluateRealScenario('resolved_by_ticket', resolved.session, resolved.logs).status, 'PASS');
  assert.equal(evaluateRealScenario('not_resolved_by_ticket', notResolved.session, notResolved.logs).status, 'PASS');
  assert.equal(evaluateRealScenario('direction_helpful', direction.session, direction.logs).status, 'PASS');
  assert.equal(evaluateRealScenario('resolved_by_ticket', direction.session, direction.logs).status, 'FAIL');
  assert.equal(evaluateRealScenario('not_resolved_by_ticket', resolved.session, resolved.logs).status, 'FAIL');
  assert.equal(evaluateRealScenario('direction_helpful', resolved.session, resolved.logs).status, 'FAIL');

  for (const evaluation of [
    evaluateRealScenario('resolved_by_ticket', resolved.session, resolved.logs),
    evaluateRealScenario('not_resolved_by_ticket', notResolved.session, notResolved.logs),
    evaluateRealScenario('direction_helpful', direction.session, direction.logs),
  ]) {
    assert.doesNotMatch(JSON.stringify(evaluation), /ticket body|https:\/\/private|Bearer|secret query/i);
    assert.deepEqual(evaluation.classificationCounts, {
      sameRootCauseLikely: 0,
      sameSymptomDifferentCause: 0,
      diagnosticLeadOnly: 0,
      irrelevant: 0,
    });
  }
});

function sessionFixture(input) {
  const evidence = [
    ...(input.mcp ? [{ id: 'redmine_ev_01', kind: 'mcp' }] : []),
    ...(input.current ? [{ id: 'worker_ev_01', kind: 'workspace' }] : []),
  ];
  const claims = input.historical ? [{
    id: 'historical_claim_1', role: 'primary_answer', type: 'inference',
    evidenceIds: evidence.map((item) => item.id), answers: ['原因'], text: 'ticket body',
  }] : [{
    id: 'worker_claim_1', role: 'primary_answer', type: 'inference',
    evidenceIds: evidence.map((item) => item.id), answers: ['原因'], text: 'current only',
  }];
  return {
    session: {
      status: input.status === 'concluded' ? 'concluded' : 'partial',
      runs: [{ status: input.status, result: { status: input.status, recommendedNextAction: input.action, evidence, claims } }],
    },
    logs: { blocks: [
      { phase: 'historical_case_search_completed', detail: { status: input.mcp ? 'completed' : 'no_hit' } },
      { phase: 'current_project_verification_completed', detail: { status: 'completed', workerInvoked: true } },
      { phase: 'historical_cross_review_completed', detail: { verificationCount: input.historical ? 1 : 0 } },
      { phase: 'evidence_validation_result', detail: { outcomeReasonCode: input.action === 'final_answer' ? 'coverage_complete' : 'upstream_partial' } },
    ] },
  };
}

test('real acceptance runner fails closed on missing prerequisites and contains no fake injection', () => {
  const script = join(process.cwd(), 'scripts', 'verify-redmine-case-investigation-real.mjs');
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /fake(?:Client|Worker|Model|Evidence)|workerFactory\s*:|createClient\s*:/i);
  assert.match(source, /startServer\(\{ config: serverConfig \}\)/);
  assert.match(source, /real_model_health/);
  assert.match(source, /createModelClient/);
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.overall, 'FAIL');
  assert.equal(report.audits.some((item) => item.detail === 'bounded_acceptance_failure'), true);
  assert.doesNotMatch(result.stdout + result.stderr, /Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}/i);
});
