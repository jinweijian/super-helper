## ADDED Requirements

### Requirement: Every configured diagnostic turn SHALL query historical cases
For a workspace with an enabled historical-case source, every Preflight `dispatch` turn SHALL execute exactly one bounded Redmine search; no model output may select a fast path that skips the search.

#### Scenario: Query planner returns valid output
- **WHEN** the planner returns schema-valid query and signals
- **THEN** Runtime SHALL search with `status=all`, candidate limit 10, and detail limit 3

#### Scenario: Query planner fails
- **WHEN** the planner times out, throws, or returns invalid JSON
- **THEN** Runtime SHALL search once using `answerGoal.resolvedQuestion` and empty signals
- **AND** the degraded plan SHALL NOT increase confidence

### Requirement: Knowledge, Experience, and Redmine SHALL collect concurrently
Runtime SHALL start evidence-only Knowledge, Experience, and complete Redmine branches without shared-request mutation and SHALL wait for a collection barrier before analysis.

#### Scenario: One source finishes first
- **WHEN** any branch settles while another branch is pending
- **THEN** Runtime SHALL retain the outcome without creating a formal reply

#### Scenario: A source is unavailable
- **WHEN** a branch returns timeout or failure
- **THEN** Runtime SHALL preserve that distinct status and continue with usable sources
- **AND** it MUST NOT convert timeout or failure to no-hit

### Requirement: Redmine retrieval SHALL enforce the ten-to-three protocol
Runtime SHALL receive no more than 10 candidates, select no more than 3 unique candidate IDs, and read details only under the same live search grant.

#### Scenario: Reranker selects valid candidates
- **WHEN** the model returns up to 3 unique IDs from the candidate set
- **THEN** Runtime SHALL pass exactly those IDs and the search ID to the detail tool

#### Scenario: Reranker output is invalid
- **WHEN** output contains unknown, duplicate, non-numeric, or over-limit IDs
- **THEN** Runtime SHALL use a deterministic bounded selection from the returned candidate set
- **AND** no unknown issue SHALL be read

### Requirement: Historical analysis SHALL produce evidence-bound diagnostic leads
Analyzer SHALL return hypotheses, conflicts, remaining unknowns, and read-only expected-match/expected-mismatch checks; each historical fact SHALL reference an existing current-run Redmine evidence ID.

#### Scenario: Analyzer returns valid leads
- **WHEN** every lead references existing evidence and every action is allowlisted read-only
- **THEN** Runtime SHALL accept the leads for Worker verification

#### Scenario: Analyzer invents evidence or a write action
- **WHEN** a lead references an unknown ID or requests a side effect
- **THEN** Runtime SHALL reject that lead
- **AND** rejected content SHALL NOT enter the Worker request or final reply

### Requirement: Valid historical leads SHALL trigger current verification
Runtime SHALL dispatch exactly one read-only Worker collection whenever one or more valid historical leads contain checks; a model MUST NOT suppress this verification.

#### Scenario: Multiple cases yield multiple checks
- **WHEN** the Analyzer returns checks from up to 3 cases
- **THEN** Runtime SHALL combine them into one bounded Worker request
- **AND** it SHALL NOT run one Worker per issue

#### Scenario: No valid lead exists
- **WHEN** Redmine has no candidates or every lead is invalid/irrelevant
- **THEN** Runtime SHALL NOT dispatch a Redmine-specific Worker collection
- **AND** the existing Knowledge-driven Worker path MAY still run

### Requirement: Current-cause conclusions SHALL require current and historical evidence
The deterministic historical-case gate MUST allow `same_root_cause_likely` only when current-run workspace/log evidence and current-run Redmine MCP evidence both support the claim and no material contradiction exists.

#### Scenario: Both evidence sides agree
- **WHEN** accepted current evidence and Redmine evidence support the same hypothesis
- **THEN** the gate MAY retain `same_root_cause_likely` for normal Review

#### Scenario: Only historical evidence exists
- **WHEN** no accepted current workspace/log evidence supports the hypothesis
- **THEN** the gate SHALL downgrade to `diagnostic_lead_only`

#### Scenario: Current evidence contradicts history
- **WHEN** Worker evidence or applicable Knowledge evidence contradicts the historical hypothesis
- **THEN** the gate SHALL prevent same-root wording and retain the conflict

### Requirement: Source failure semantics and investigation state SHALL remain safe
Only a successful empty search may become `no_hit`; planner reasons, queries, unselected cases, unreferenced details, raw model outputs, and ephemeral verification plans SHALL remain turn-local.

#### Scenario: Redmine times out
- **WHEN** the Redmine branch reaches its timeout budget
- **THEN** Runtime SHALL continue Knowledge/Worker processing with a source gap
- **AND** final output MUST NOT claim that no similar tickets exist

#### Scenario: Case is serialized
- **WHEN** the investigation Run, session, or logs are persisted
- **THEN** they SHALL contain only sanitized request/result, selected bounded evidence, source status/count/duration, IDs, and safe errors
- **AND** existing public DTO top-level shapes SHALL remain unchanged
