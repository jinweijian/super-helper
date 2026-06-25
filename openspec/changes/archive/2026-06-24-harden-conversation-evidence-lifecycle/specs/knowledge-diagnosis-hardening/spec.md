## ADDED Requirements

### Requirement: Knowledge and worker diagnosis share resolved turn semantics
Knowledge-first diagnosis and worker escalation SHALL consume the same resolved query, facts, claims, hypotheses, and unknowns for a user turn.

#### Scenario: Knowledge evidence is insufficient
- **WHEN** strict knowledge review escalates to a worker
- **THEN** the worker request preserves the resolved query and evidence gaps without turning user hypotheses into known facts

### Requirement: Evidence claim boundary is enforced before final presentation
All knowledge, history, workspace, MCP, manual, and log evidence SHALL pass the same deterministic claim/evidence validation before a final user reply.

#### Scenario: Knowledge result uses invalid evidence ID
- **WHEN** a generated knowledge fact references an evidence ID not present in the result
- **THEN** the final outcome cannot be final and the issue is logged

#### Scenario: History evidence is the only support
- **WHEN** a historical reply is similar but current evidence validation fails
- **THEN** history is labeled as unconfirmed context and normal diagnosis continues

### Requirement: Conversation evidence lifecycle preserves compatibility and isolation
New context, validation, and registry metadata SHALL be additive, bounded, and isolated by tenant, user, case, run, and workspace.

#### Scenario: Existing API client loads session
- **WHEN** session and agent APIs include records created before this change
- **THEN** existing required fields and status values remain compatible and new metadata is optional

#### Scenario: Same workspace contains different users
- **WHEN** Experience or context building runs
- **THEN** messages, runs, evidence, and conclusions from another user or tenant are not included
