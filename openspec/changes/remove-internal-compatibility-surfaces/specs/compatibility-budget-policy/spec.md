## ADDED Requirements

### Requirement: Private source compatibility is not a delivery contract
Private TypeScript imports、tests and unshipped duplicate CLI commands SHALL migrate atomically to canonical owners. The project MUST NOT add deprecated aliases or dual implementations solely to preserve repository history.

#### Scenario: Private compatibility path has no external consumer
- **WHEN** its callers are all inside this private repository
- **THEN** callers and tests migrate in the same change and the path is deleted
- **AND** documentation lists only the canonical path

#### Scenario: Removed duplicate CLI is invoked
- **WHEN** an unshipped duplicate command has a canonical replacement
- **THEN** only the canonical command remains registered
- **AND** no hidden compatibility handler executes

#### Scenario: Knowledge pipeline commands are not compatibility aliases
- **WHEN** source compatibility cleanup removes old knowledge query/evaluation entrypoints
- **THEN** knowledge ingestion、vector build、audit、review、publish and migration-report commands remain owned by the knowledge/onboarding pipeline
- **AND** production query/evaluation behavior moves to retrieval commands rather than being silently removed

### Requirement: Current product and persisted source contracts remain stable
This source cleanup SHALL preserve current HTTP/UI behavior、config、SecretRef、case JSON and canonical knowledge source files. Any change to those contracts MUST use a separate explicit migration/change.

#### Scenario: Dashboard and HTTP workflows run after cleanup
- **WHEN** onboarding、chat、settings、sessions、logs and knowledge-health routes execute
- **THEN** their current response shapes and persisted case/config behavior remain valid
- **AND** alias removal is not exposed as a runtime outage

### Requirement: Data migration safety is distinct from source aliases
Legacy Parent-Child/vector/quality artifacts MAY remain readable only while a real migration inventory and fail-closed eligibility rule exist. This cleanup MUST NOT modify their schema、mark migration tasks complete or make legacy evidence direct-answer eligible.

#### Scenario: Active migration still has missing sources or human review
- **WHEN** migration batches are blocked or real provider/holdout validation is not run
- **THEN** their status remains blocked/not-run and legacy evidence remains investigation-only
- **AND** source cleanup does not fabricate publish、vector or metric success

#### Scenario: Legacy artifact is encountered by canonical retrieval
- **WHEN** it lacks current provenance、quality or vector compatibility fields
- **THEN** existing fail-closed/rebuild-required behavior remains in force
- **AND** it is not used as justification for retaining a private source alias

### Requirement: Future compatibility exceptions require evidence and expiry
Any future private compatibility surface SHALL include a verified external consumer、canonical replacement、owner、removal version/date、migration task and a boundary test blocking new callers.

#### Scenario: Proposed alias lacks exception evidence
- **WHEN** any required field is missing
- **THEN** the alias MUST NOT be added
- **AND** callers migrate directly to the canonical owner

### Requirement: Verification remains offline and privacy-safe
Default cleanup verification SHALL use fixture/fake or disabled providers and MUST NOT require network、paid calls or real credentials. Logs、reports、errors and fixtures MUST NOT contain secrets、raw vectors、complete provider payloads、complete documents or unbounded conversation text.

#### Scenario: Full suite runs without credentials
- **WHEN** `pnpm test` runs in a clean environment
- **THEN** canonical retrieval、strict grounding and conversation evidence tests complete offline
- **AND** missing provider access records safe fallback/not-run rather than fabricated success
