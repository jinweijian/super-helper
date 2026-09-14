## ADDED Requirements

### Requirement: Authority diagnostic implementations are replaceable
The system MUST invoke technical diagnosis through a stable authority diagnostic port, and MUST allow Claude Code and a future DeepSeek Harness implementation to be selected without changing Case, UI, or experience contracts.

#### Scenario: Claude Code is the selected authority
- **WHEN** a workspace diagnosis is started with the Claude adapter
- **THEN** the Runtime passes a structured DiagnosticRequest to the adapter and persists its normalized result

#### Scenario: Authority implementation is replaced
- **WHEN** configuration selects another adapter implementing the same port
- **THEN** the Runtime continues to produce the same public Case and response shapes

### Requirement: Authority results preserve semantic status
The system MUST preserve authority claims as fact, inference, assumption, unknown, or next action, and MUST NOT promote or demote their meaning during output formatting.

#### Scenario: Authority returns a conclusion and an inference
- **WHEN** the authority result contains both types
- **THEN** the visible response labels them separately and preserves their order and meaning

### Requirement: Authority failures degrade safely
The system MUST represent adapter timeout, cancellation, malformed output, and execution failure without exposing raw provider payloads or pretending that diagnosis succeeded.

#### Scenario: Adapter execution fails
- **WHEN** the adapter cannot produce a usable result
- **THEN** the Case records a safe failure state and the user receives an actionable failure message
