## ADDED Requirements

### Requirement: Published parents produce bounded child chunks
The knowledge index builder SHALL keep published Markdown as canonical parent evidence and generate one or more child chunks along source block and section boundaries.

#### Scenario: Parent contains multiple bounded sections
- **WHEN** a parent contains independently answerable source blocks
- **THEN** child chunks target 300 to 800 Chinese characters, preserve parent ID, source block IDs, section path, order, and text hash, and do not cross section paths

#### Scenario: Boundary requires overlap
- **WHEN** adjacent child chunks require context continuity
- **THEN** overlap contains at most one complete sentence and no more than 120 characters

#### Scenario: Single source block exceeds maximum
- **WHEN** one indivisible source block exceeds 800 characters
- **THEN** the builder preserves the block, records manual split required, and does not silently truncate provenance or content

### Requirement: Parent-child artifacts remain compatible and rebuildable
Child chunk artifacts SHALL be rebuildable from canonical parent/source artifacts and add metadata without making old JSONL records unreadable.

#### Scenario: Old chunk record is read
- **WHEN** a JSONL record lacks new child metadata
- **THEN** readers parse it as a legacy chunk and strict direct-answer eligibility remains false until rebuild

#### Scenario: Parent content changes
- **WHEN** parent text, source blocks, or child boundaries change
- **THEN** chunk hashes and vector compatibility detect the change and require vector rebuild

### Requirement: Child hits expand to bounded parent evidence
Retrieval SHALL deduplicate child hits by parent and return a parent evidence result with the best answer span and bounded surrounding context.

#### Scenario: Multiple children from one parent match
- **WHEN** several children under the same parent are recalled
- **THEN** final evidence contains one parent with preserved child strategy scores and the strongest answer span

#### Scenario: Answer span exists
- **WHEN** a child contains an answer-bearing sentence with the strongest business-term coverage
- **THEN** that sentence is returned as answer span with at most 1600 characters of same-section context

#### Scenario: No answer span exists
- **WHEN** a candidate is semantically related but no answer-bearing sentence is found
- **THEN** it remains investigation context and strict Judge blocks direct answer
