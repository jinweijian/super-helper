## ADDED Requirements

### Requirement: Knowledge local ownership
Knowledge SHALL own local document discovery, frontmatter/source metadata, chunk construction and rebuildable artifact writes. It MUST NOT own provider-shaped interfaces, recall ranking, rerank or remote calls.

#### Scenario: Knowledge index is rebuilt
- **WHEN** caller updates the knowledge index
- **THEN** knowledge discovery and chunk modules rebuild the same manifest, chunks and keyword artifacts
- **AND** artifact paths and JSON shapes remain unchanged

#### Scenario: Knowledge files are missing or malformed
- **WHEN** documents, source metadata or chunk lines are absent or malformed
- **THEN** existing skip, fallback and empty-result behavior is preserved
- **AND** no provider call is attempted

### Requirement: Retrieval owns keyword compatibility ranking
The legacy keyword scoring, filtering, sorting and evidence conversion SHALL live under `src/retrieval/`. Knowledge implementation modules MUST NOT define recall provider ports or ranking weights.

#### Scenario: Existing searchKnowledge caller searches local knowledge
- **WHEN** caller uses the old `searchKnowledge` symbol
- **THEN** the compatibility facade delegates to retrieval keyword search
- **AND** scores, ordering, filters, evidence IDs, excerpts and coverage remain compatible

#### Scenario: Keyword recall strategy executes
- **WHEN** retrieval explicitly enables keyword compatibility
- **THEN** keyword strategy calls retrieval compatibility search directly
- **AND** it does not import `knowledge/indexer.ts`

### Requirement: Knowledge indexer is a thin compatibility facade
`src/knowledge/indexer.ts` SHALL contain only focused re-exports and MUST remain at or below approximately 120 lines.

#### Scenario: Boundary test scans indexer
- **WHEN** architecture tests inspect `knowledge/indexer.ts`
- **THEN** no provider-shaped interface, scoring weight, file traversal algorithm or RAG orchestration is present

#### Scenario: Existing knowledge imports compile
- **WHEN** old callers import update, discovery, search or RAG symbols from knowledge indexer/index
- **THEN** the same names and compatible signatures remain available
