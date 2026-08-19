## ADDED Requirements

### Requirement: Runtime SHALL own the mandatory case-investigation lifecycle
After successful Preflight dispatch, when the workspace has an enabled historical-case source, Runtime SHALL delegate to a focused case-investigation collaborator before Experience, Knowledge, generic MCP, or Worker can complete the turn.

#### Scenario: Configured workspace dispatches a technical turn
- **GIVEN** the workspace has one valid `historical_case/redmine` source
- **WHEN** Preflight returns `dispatch`
- **THEN** Runtime SHALL start the case-investigation collaborator
- **AND** it SHALL execute one bounded Redmine search before formal presentation

#### Scenario: Preflight needs more information
- **WHEN** Preflight returns `ask_user`
- **THEN** Runtime MAY ask the existing clarification question without querying Redmine

#### Scenario: Legacy workspace has no source
- **WHEN** a readable legacy workspace has no historical-case source
- **THEN** Runtime SHALL preserve the existing Experience → Knowledge → generic MCP → Worker behavior

### Requirement: Case-investigation Worker collection SHALL remain behind the stable worker contract
Runtime SHALL pass one schema-validated read-only ephemeral verification request to the existing `DiagnosticWorker` port whenever Analyzer produces at least one valid historical lead with checks.

#### Scenario: Analyzer returns valid leads
- **WHEN** at least one lead binds current Redmine evidence IDs and contains expected-match and expected-mismatch checks
- **THEN** Runtime SHALL dispatch exactly one Worker collection
- **AND** the Worker SHALL search for supporting evidence and counter-evidence
- **AND** the persisted request SHALL exclude historical bodies and the complete verification plan

#### Scenario: Plan requests a side effect
- **WHEN** any check requests file/database/network/Redmine mutation or an unallowlisted action
- **THEN** Runtime SHALL reject the plan before Worker dispatch

### Requirement: Case investigation SHALL complete the turn exactly once
Collectors, MCP tools, model stages, and Worker collection MUST NOT create a helper reply or invoke Review/Presentation independently.

#### Scenario: Multiple sources return evidence
- **WHEN** Knowledge, Experience, Redmine, and Worker return outcomes
- **THEN** Runtime SHALL create one Run, invoke existing Review once, invoke Presentation once, and persist one formal helper reply
- **AND** Gateway SHALL only serialize the Runtime result using existing response shapes
