## MODIFIED Requirements

### Requirement: Existing case and experience data remain readable
The system MUST preserve existing Case, Run, Evidence, log, CSV experience, and Markdown experience formats while removing legacy Knowledge/RAG from the online path.

#### Scenario: Existing case is opened after migration
- **WHEN** a Case contains legacy knowledge events or runs
- **THEN** the system can render and inspect it without replaying legacy knowledge online

#### Scenario: Experience import runs after migration
- **WHEN** a Redmine CSV is imported and refined
- **THEN** source provenance, revision, hash, review status, and Markdown output remain available
