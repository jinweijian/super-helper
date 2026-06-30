## Purpose

Define the Chinese lexical tokenization and field-weighted BM25 scoring rules that preserve useful terms, frequency, and field contributions without generic single-character recall.

## Requirements

### Requirement: Chinese lexical tokenization preserves useful terms and frequency
The BM25 tokenizer SHALL produce Latin/alphanumeric tokens, registered business terms, and Chinese bigrams while preserving repeated term frequency and excluding generic single-character recall by default.

#### Scenario: Chinese business query is tokenized
- **WHEN** the query is `课程发布后学员看不到`
- **THEN** tokens include multi-character terms such as `课程`, `发布`, `学员`, and relevant bigrams without emitting every individual Chinese character

#### Scenario: Repeated term occurs in a document
- **WHEN** a document contains the same business term multiple times
- **THEN** term frequency reflects the repetitions instead of being reduced to a set membership flag

#### Scenario: One-character business term is required
- **WHEN** a one-character term is explicitly registered in taxonomy
- **THEN** it may be indexed as a business term without enabling arbitrary single-character matching

### Requirement: BM25 scores knowledge fields with fixed weights
Lexical retrieval SHALL score title at weight 4, headings and section path at 3, related terms at 3, module and intent at 2, and body at 1.

#### Scenario: Exact title match competes with body noise
- **WHEN** one candidate matches the complete query phrase in its title and another matches generic terms many times in its body
- **THEN** the title candidate ranks higher

#### Scenario: Field contributions are observed
- **WHEN** BM25 returns a candidate
- **THEN** its trace preserves raw score, rank, multi-character matched terms, and field contributions needed for explanation

### Requirement: BM25 supports a true no-hit outcome
Lexical retrieval SHALL return no candidates when the query has no meaningful multi-character or registered business-term overlap.

#### Scenario: Unique unrelated query
- **WHEN** the query contains only terms absent from the indexed corpus
- **THEN** BM25 returns an empty candidate list rather than unrelated documents sharing generic characters
