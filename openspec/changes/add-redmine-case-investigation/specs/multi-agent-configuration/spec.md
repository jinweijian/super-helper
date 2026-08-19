## ADDED Requirements

### Requirement: Four historical-case model stages SHALL be registered Product Agents
The system SHALL define Historical Search Query Planner, Historical Case Reranker, Historical Case Analyzer, and Historical Case Verifier configs under `src/agents/` and pair their runtime stages through `registry.json`.

#### Scenario: Runtime initializes investigation services
- **WHEN** Runtime resolves a historical-case model stage
- **THEN** it SHALL load the centralized config through `resolveAgentConfig`

#### Scenario: Agent registry is exposed
- **WHEN** the sanitized Agent API/UI lists roles
- **THEN** it SHALL include all four identities and summaries
- **AND** it SHALL not expose prompt content, Redmine config, secrets, query text, or model reasoning

### Requirement: Historical-case Agents SHALL never produce user-facing text
Every historical-case registry entry MUST set `mayProduceUserFacingText=false`; there SHALL be no Current Evidence Assessor Agent able to suppress mandatory Worker verification.

#### Scenario: Agent returns valid model JSON
- **WHEN** planner, reranker, analyzer, or verifier returns output
- **THEN** Runtime SHALL treat it only as internal structured data
- **AND** it SHALL not store the raw output as a helper message

### Requirement: Agent and tool activity SHALL retain correct actor identity
Agent-owned lifecycle events SHALL identify the responsible Agent; Redmine calls SHALL use the MCP actor and Workspace verification SHALL use the Worker actor.

#### Scenario: Redmine search is recorded
- **WHEN** Runtime calls `redmine_search_issues`
- **THEN** the event SHALL use `actor='mcp'`
- **AND** it MUST NOT masquerade as an Agent event
