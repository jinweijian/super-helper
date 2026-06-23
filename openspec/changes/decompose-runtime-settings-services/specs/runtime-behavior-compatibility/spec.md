## ADDED Requirements

### Requirement: Turn ordering and lifecycle remain compatible
Runtime decomposition SHALL preserve same-case serialization, sync/async shared execution, session state transitions and reply-to message association.

#### Scenario: Two turns for one case overlap
- **WHEN** two accepted turns complete concurrently for the same case
- **THEN** they execute in acceptance order
- **AND** a failed turn does not poison the next queued turn

#### Scenario: Sync and async routes execute
- **WHEN** gateway uses either route style
- **THEN** both call the same `DiagnosticRuntime` start/complete pipeline
- **AND** public response and persisted case shapes remain unchanged

### Requirement: Diagnostic review and retry behavior remain compatible
Runtime decomposition SHALL preserve Evidence Review、presentation fallback and the existing one-follow-up Deep Query path, including diagnostic log phases and payloads.

#### Scenario: Evidence review requests more diagnosis
- **WHEN** the first worker result and trace satisfy the existing follow-up gate
- **THEN** runtime creates one follow-up request with prior evidence and pivot context
- **AND** emits the same retry、pivot、worker and review event phases in order

#### Scenario: Model review fails
- **WHEN** presentation model output is malformed or throws
- **THEN** runtime uses the existing reviewed fallback
- **AND** does not invent unsupported facts or lose the worker result
