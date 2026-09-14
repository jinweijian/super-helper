## MODIFIED Requirements

### Requirement: Diagnostic runtime coordinates answer sources
The diagnostic runtime MUST coordinate input preparation, bounded context collection, one authority diagnosis, safe result handling, and presentation. Legacy Knowledge/RAG MUST NOT be a required or early-returning online source.

#### Scenario: Current project diagnosis
- **WHEN** a user submits a non-empty question for a valid workspace
- **THEN** the runtime invokes the authority adapter after preparing available experience and tool context

#### Scenario: Legacy knowledge is configured or indexed
- **WHEN** legacy knowledge configuration or index files are present
- **THEN** the runtime does not invoke legacy knowledge during the online diagnosis

### Requirement: Diagnostic runtime preserves public contracts
The runtime MUST keep existing Case, Run, Evidence, cancellation, and response shapes while changing only the online source selection behavior.

#### Scenario: Authority returns a usable result
- **WHEN** the adapter returns a normalized result
- **THEN** the runtime persists one compatible run and returns a response through the existing gateway contract
