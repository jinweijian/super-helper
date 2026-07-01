## ADDED Requirements

### Requirement: Knowledge indexing distinguishes parent evidence from child recall
The knowledge processing pipeline SHALL build provenance-complete child recall artifacts from reviewed published parents while retaining parents as the final evidence unit.

#### Scenario: Published parent is indexed
- **WHEN** an approved parent is published and index update runs
- **THEN** every child maps to the parent and source blocks, and evidence expansion can recover an answer span and canonical source

#### Scenario: Legacy artifact is encountered
- **WHEN** a legacy parent or chunk lacks v2 metadata
- **THEN** compatibility reading succeeds but strict direct-answer eligibility remains false

### Requirement: Quality and evaluation govern hybrid release
Knowledge quality reports and production retrieval evaluation SHALL jointly govern whether a parent/module batch can support direct answer.

#### Scenario: Draft mirror does not downgrade a published parent
- **WHEN** a published parent and its draft review copy have the same `documentId` and identical meaningful body
- **THEN** quality audit SHALL NOT mark the published parent as `duplicate_content`
- **AND** duplicate detection SHALL still report duplicated content across different document IDs

#### Scenario: Retrieval metrics pass but quality fails
- **WHEN** expected parents rank correctly but one top parent has blocking quality or provenance issues
- **THEN** the batch remains ineligible for direct answer

#### Scenario: Quality passes but retrieval metrics fail
- **WHEN** parents are quality-clean but holdout recall or ranking misses the required threshold
- **THEN** the batch remains ineligible and the failure is attributed to retrieval

### Requirement: Feature overview questions use knowledge direct answers
The runtime SHALL treat explicit feature-list questions as `feature_overview` and answer them from eligible knowledge evidence before escalating to code.

#### Scenario: Specific module feature list is answerable
- **WHEN** the user asks a concrete module question such as “AI伴学助手有哪些功能”
- **AND** retrieval returns active, provenance-complete, quality-eligible evidence for that module
- **THEN** Evidence Judge SHALL allow direct answer
- **AND** the knowledge result SHALL aggregate multiple feature facts instead of reducing the answer to the top span only

#### Scenario: Generic feature question remains unsafe
- **WHEN** the user asks a generic question such as “这个功能支持吗” without a concrete module or feature signal
- **THEN** the system SHALL abstain, ask for clarification, or continue diagnosis instead of guessing a feature list

### Requirement: Hybrid migration preserves existing boundaries
Knowledge SHALL own artifact building and local metadata, retrieval SHALL own tokenization/scoring/fusion/rerank orchestration, providers SHALL own vendor protocols, and runtime SHALL own direct-answer decisions.

#### Scenario: Boundary audit runs
- **WHEN** implementation is reviewed
- **THEN** no knowledge module imports provider adapters, no provider imports knowledge, no runtime implements scoring/vendor mapping, and no CLI duplicates the business flow
