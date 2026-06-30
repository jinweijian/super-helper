## Purpose

Define the runtime service decomposition that splits the diagnostic runtime into focused services with clear ownership and explicit dependency direction.

## Requirements

### Requirement: DiagnosticRuntime is a thin composition root
`DiagnosticRuntime` SHALL preserve its constructor and public methods while delegating queue、session、Preflight、experience、knowledge、worker/retry、review/presentation and case curation to focused collaborators. `src/runtime/diagnostic-runtime.ts` MUST remain at or below 300 lines.

#### Scenario: Caller handles a user message
- **WHEN** caller invokes `handleUserMessage`
- **THEN** the runtime starts and completes the turn through the same public pipeline
- **AND** returns the compatible case session、assistant message and decision

#### Scenario: Boundary test inspects the composition root
- **WHEN** architecture tests scan `diagnostic-runtime.ts`
- **THEN** it contains no knowledge path/index/provider implementation
- **AND** each required collaborator is instantiated and used by a real production path

### Requirement: Runtime collaborator ownership is narrow
Each collaborator SHALL own one runtime concern and MUST NOT absorb gateway DTO、provider protocol or persistence schema changes.

#### Scenario: A collaborator is extracted
- **WHEN** queue、session、Preflight、experience、knowledge、worker、review or curation logic is changed
- **THEN** the change occurs in its owning module
- **AND** `DiagnosticRuntime` only coordinates its input/output

#### Scenario: Runtime needs knowledge evidence
- **WHEN** a turn attempts knowledge diagnosis or solved-case curation
- **THEN** the dedicated collaborator resolves and uses the knowledge workspace
- **AND** the composition root does not parse paths or artifacts
