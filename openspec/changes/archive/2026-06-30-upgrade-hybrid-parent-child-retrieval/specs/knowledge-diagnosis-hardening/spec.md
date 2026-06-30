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

#### Scenario: Retrieval metrics pass but quality fails
- **WHEN** expected parents rank correctly but one top parent has blocking quality or provenance issues
- **THEN** the batch remains ineligible for direct answer

#### Scenario: Quality passes but retrieval metrics fail
- **WHEN** parents are quality-clean but holdout recall or ranking misses the required threshold
- **THEN** the batch remains ineligible and the failure is attributed to retrieval

### Requirement: Hybrid migration preserves existing boundaries
Knowledge SHALL own artifact building and local metadata, retrieval SHALL own tokenization/scoring/fusion/rerank orchestration, providers SHALL own vendor protocols, and runtime SHALL own direct-answer decisions.

#### Scenario: Boundary audit runs
- **WHEN** implementation is reviewed
- **THEN** no knowledge module imports provider adapters, no provider imports knowledge, no runtime implements scoring/vendor mapping, and no CLI duplicates the business flow
