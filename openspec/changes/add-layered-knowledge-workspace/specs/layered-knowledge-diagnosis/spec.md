## ADDED Requirements

### Requirement: Knowledge workspace structure
The system SHALL support an enterprise knowledge workspace layout under the active workspace root without depending on Obsidian at runtime.

#### Scenario: Knowledge directory exists
- **WHEN** the active workspace contains `knowledge/_taxonomy/`, `knowledge/faq/`, `knowledge/runbooks/`, `knowledge/tickets/`, `knowledge/whitepapers/`, `knowledge/glossary/`, and `knowledge/indexes/`
- **THEN** the runtime can discover the knowledge workspace as ordinary filesystem content

#### Scenario: Repositories remain separate from knowledge documents
- **WHEN** the active workspace contains both `knowledge/` and `repos/`
- **THEN** knowledge search reads from `knowledge/` first and does not inspect `repos/` until code escalation is selected

### Requirement: Source document provenance
The system SHALL preserve original PDF or source files separately from structured knowledge slices so answers can be traced back to source document metadata, page ranges, and import provenance.

#### Scenario: PDF source imported
- **WHEN** a whitepaper PDF is added to the knowledge workspace
- **THEN** the original file is stored under `knowledge/_sources/whitepapers/` with metadata containing source id, path, hash, title, page count, product versions, owner, and ingest timestamp

#### Scenario: Source document not used as direct answer context
- **WHEN** a user question is answered from whitepaper knowledge
- **THEN** the answer references structured Markdown evidence and source page metadata rather than relying on raw PDF text as the final evidence unit

### Requirement: Whitepaper slicing hierarchy
The system SHALL model long documents using a source document -> parent slice -> evidence chunk hierarchy.

#### Scenario: Parent slice created from PDF
- **WHEN** a whitepaper section is converted into structured Markdown
- **THEN** the resulting parent slice includes frontmatter linking to the source document, source pages, section path, module, intent, source_type, status, confidence, and owner

#### Scenario: Chunk derived from parent slice
- **WHEN** an evidence chunk is generated for search
- **THEN** it stores `chunk_id`, `parent_id`, source path, source document, source pages, headings, keywords, and bounded text

#### Scenario: Index can be rebuilt
- **WHEN** `knowledge/indexes/chunks.jsonl` is deleted
- **THEN** the system can rebuild evidence chunks from parent slice Markdown without losing canonical knowledge content

### Requirement: Knowledge document frontmatter
The system SHALL require Markdown knowledge documents to include standardized YAML frontmatter with id, title, type, module, intent, source_type, confidence, status, visibility, product_versions, related_terms, related_repos, last_verified_at, and owner.

#### Scenario: Valid knowledge document
- **WHEN** a Markdown file includes all required frontmatter fields with accepted enum values
- **THEN** the file can be parsed into a knowledge document candidate

#### Scenario: Missing required metadata
- **WHEN** a Markdown file is missing a required frontmatter field
- **THEN** the file is excluded from high-confidence evidence and the validation result identifies the missing field

#### Scenario: Review-required document
- **WHEN** a document has `status: review_required`
- **THEN** the document can appear as evidence but cannot by itself justify a high-confidence final answer

### Requirement: Knowledge router
The system SHALL normalize each user question and identify candidate module, intent, keywords, and source type filters before searching the enterprise knowledge base.

#### Scenario: Module alias match
- **WHEN** a user question contains a term listed in `knowledge/_taxonomy/aliases.yaml`
- **THEN** the router returns the mapped module or related term as a candidate

#### Scenario: Unknown module
- **WHEN** no taxonomy or alias entry matches the user question
- **THEN** the router keeps the module candidate list empty and allows broad MVP keyword search rather than inventing a module

### Requirement: MVP knowledge search
The system SHALL provide an MVP knowledge search that uses Markdown file discovery, frontmatter parsing, module routing, keyword matching, metadata filtering, and bounded evidence pack creation.

#### Scenario: FAQ hit
- **WHEN** a user question matches an active FAQ document by module, intent, and keywords
- **THEN** search returns an evidence pack containing the FAQ document id, source path, matched terms, summary, confidence, status, and bounded excerpt

#### Scenario: Deprecated document filtered
- **WHEN** a matching document has `status: deprecated` or `status: archived`
- **THEN** search either excludes it from answerable evidence or marks it as stale evidence that requires Evidence Judge review

#### Scenario: Evidence pack bounded
- **WHEN** search finds more candidate documents than the configured evidence limit
- **THEN** the evidence pack returns only the highest-ranked bounded results and records coverage counts

#### Scenario: Chunk hit expands to parent slice
- **WHEN** a query matches an evidence chunk derived from a whitepaper slice
- **THEN** search loads the parent slice and returns parent document metadata, source document, source pages, matched terms, and a bounded excerpt in the evidence pack

#### Scenario: Parent slice required for answering
- **WHEN** a chunk is used for recall
- **THEN** Evidence Judge and Output Review use the parent slice context as the answer evidence instead of treating the isolated chunk as sufficient by itself

### Requirement: Evidence judge
The system SHALL judge whether knowledge evidence is sufficient to answer without code and SHALL produce a structured result containing answerable, confidence, need_code_escalation, reason, evidence, risks, missing_info, conflicts, and recommended_next_action.

#### Scenario: Answerable from knowledge
- **WHEN** active FAQ or runbook evidence clearly answers a product rule or operation flow question and no conflict is detected
- **THEN** Evidence Judge returns `answerable: true`, `need_code_escalation: false`, and `recommended_next_action: final_answer`

#### Scenario: No knowledge hit
- **WHEN** knowledge search returns no usable evidence
- **THEN** Evidence Judge returns `answerable: false`, `need_code_escalation: true`, and a reason explaining that code or additional evidence is required

#### Scenario: Conflicting knowledge
- **WHEN** multiple knowledge documents provide incompatible answers for the same module and intent
- **THEN** Evidence Judge returns `answerable: false`, lists conflicts, and requires code escalation or user/human clarification

#### Scenario: Stale knowledge
- **WHEN** a matched document is past its review cycle or has stale status
- **THEN** Evidence Judge lowers confidence and requires code escalation if the answer depends on current implementation

### Requirement: Code escalation rules
The system SHALL escalate to Claude Code / CC worker when the user question requires current implementation evidence or knowledge evidence is insufficient, stale, risky, or conflicting.

#### Scenario: Implementation detail signal
- **WHEN** the user provides a log, error, table name, class name, interface path, config key, file path, or code implementation question
- **THEN** the system escalates to the existing `DiagnosticWorker` flow after preserving knowledge evidence in context

#### Scenario: High-risk domain
- **WHEN** the question involves production incident, data repair, payment, permission, or security impact
- **THEN** the system escalates to code or human review instead of relying only on knowledge FAQ

#### Scenario: Existing worker preserved
- **WHEN** code escalation is selected
- **THEN** the existing Claude Code worker remains a read-only diagnostic tool and does not directly generate the user-facing reply

### Requirement: Knowledge-first final answer
The system SHALL allow direct final answers from knowledge evidence only after Evidence Judge and Output Review accept the evidence.

#### Scenario: Direct answer from FAQ
- **WHEN** Evidence Judge returns answerable high-confidence knowledge evidence
- **THEN** runtime skips Claude Code, creates a `DiagnosticResult` with `knowledge` evidence, and sends it through Output Review and Presentation

#### Scenario: Unsupported fact blocked
- **WHEN** a knowledge-derived answer contains a fact without supporting evidence id
- **THEN** Output Review rejects or downgrades the claim before user-facing presentation

#### Scenario: Evidence disclosed
- **WHEN** a final answer is presented to the user
- **THEN** the reply explains which evidence sources were used at an appropriate detail level for the user's persona and visibility permissions

### Requirement: Case curator
The system SHALL support solved case curation after the user confirms the issue is resolved.

#### Scenario: User confirms resolved
- **WHEN** the user confirms that the issue has been solved
- **THEN** Case Curator generates a solved case Markdown draft from the current case, evidence, diagnostic runs, and final confirmation

#### Scenario: Default curation metadata
- **WHEN** Case Curator writes a solved case document
- **THEN** the document has `status: review_required` and `confidence: medium` by default

#### Scenario: Solved case saved to knowledge base
- **WHEN** a solved case draft is generated
- **THEN** it is saved under `knowledge/tickets/solved-cases/<module-id>/` and includes original question, normalized question, module, intent, environment, evidence, investigation process, root cause, solution, applicability, non-applicability, related code paths, and user confirmation

#### Scenario: Index marked dirty
- **WHEN** a solved case document is saved
- **THEN** the system marks `knowledge/indexes/dirty.flag` or equivalent index metadata so future indexing can refresh derived search data

### Requirement: Observability for layered diagnosis
The system SHALL record observable lifecycle events for knowledge routing, knowledge search, evidence judging, code escalation, resolution confirmation, case curation, and index dirty marking.

#### Scenario: Knowledge search logged
- **WHEN** the runtime searches the enterprise knowledge base
- **THEN** diagnostic logs include search start, search result summary, matched evidence count, and responsible agent or service label

#### Scenario: Code escalation logged
- **WHEN** Evidence Judge requires code escalation
- **THEN** diagnostic logs include the judge reason, evidence used, missing information, and escalation target

#### Scenario: Case curation logged
- **WHEN** Case Curator saves or fails to save a solved case
- **THEN** diagnostic logs include the outcome, document path when available, and review-required status

### Requirement: Existing behavior compatibility
The system SHALL preserve existing super helper diagnostic contracts while adding knowledge-first behavior.

#### Scenario: Knowledge feature disabled or absent
- **WHEN** the active workspace has no usable `knowledge/` directory or the knowledge feature is disabled
- **THEN** the runtime falls back to the current Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation behavior

#### Scenario: Public API compatibility
- **WHEN** layered knowledge diagnosis is added
- **THEN** existing `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, and `/api/logs` response shapes remain backward compatible

#### Scenario: Case JSON compatibility
- **WHEN** existing case JSON files are loaded after this capability is implemented
- **THEN** they remain readable without a destructive migration
