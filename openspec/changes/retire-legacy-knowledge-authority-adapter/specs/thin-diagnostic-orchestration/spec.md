## ADDED Requirements

### Requirement: First investigation precedes clarification
The system MUST start one authority investigation when the user message and workspace are present, and MUST NOT ask for technical details before that investigation.

#### Scenario: User provides a non-empty issue and workspace
- **WHEN** the user submits a diagnosis request
- **THEN** the system prepares context and invokes the authority adapter before generating a clarification

#### Scenario: Authority reports missing information
- **WHEN** the first investigation returns explicit missingInfo or ask_user
- **THEN** the system presents concrete questions explaining where the user can obtain each item

### Requirement: Legacy document knowledge is excluded online
The system MUST NOT invoke legacy document Knowledge/RAG, BM25, embedding, or rerank services during online diagnosis.

#### Scenario: Online diagnosis runs with old indexes present
- **WHEN** a diagnosis starts while legacy indexes exist on disk
- **THEN** the Runtime ignores those indexes and proceeds with experience, allowed tools, and authority diagnosis

### Requirement: Experience and graph context are input only
The system MUST pass reviewed experience and future graph context as bounded input context, and MUST NOT use either source to produce a final user response without authority diagnosis.

#### Scenario: Experience source is available
- **WHEN** reviewed experience matches the current workspace
- **THEN** it is included as reference context and the authority adapter remains responsible for the technical conclusion
