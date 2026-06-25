## Purpose

Define the deterministic validation, frozen review outcome, and accepted-content boundary that the runtime applies before the Presentation stage so that no model call can promote a partial review to a final answer, invent facts outside accepted evidence, or leak rejected claims into the user reply.

## Requirements

### Requirement: Diagnostic results are validated before presentation
The runtime SHALL deterministically validate evidence identities, claim references, claim types, and evidence confidence before choosing the review outcome.

#### Scenario: Fact references no evidence
- **WHEN** a fact claim has an empty evidence ID list
- **THEN** it is rejected or downgraded and cannot support final answer

#### Scenario: Fact references nonexistent evidence
- **WHEN** a fact claim references an ID absent from the result evidence list
- **THEN** the reference is invalid, the fact is rejected or downgraded, and the validation issue is logged

#### Scenario: Fact references only low confidence evidence
- **WHEN** a fact claim references only low-confidence or unknown evidence
- **THEN** it cannot remain a final fact

### Requirement: Review outcome is frozen before presentation
The deterministic Review Gate SHALL decide `ask_user`, `partial`, `final`, or `escalate` before Presentation and Presentation MUST NOT promote or replace that outcome.

#### Scenario: Model requests final for partial result
- **WHEN** the Presentation model returns wording or metadata that implies final answer for a frozen partial outcome
- **THEN** runtime keeps partial and renders only accepted partial claims

#### Scenario: Presentation fails
- **WHEN** the model returns malformed JSON, unknown claim IDs, or no usable presentation
- **THEN** runtime uses deterministic formatting from the same validated result and frozen outcome

### Requirement: Presentation is limited to accepted content
Presentation SHALL only select and arrange accepted claim/evidence identities; final rendering SHALL use accepted claim text and safe non-factual connective language.

#### Scenario: Model invents a new fact
- **WHEN** presentation output includes text not attributable to accepted claim IDs
- **THEN** that text is discarded and does not reach the user

#### Scenario: Persona changes wording order
- **WHEN** accepted evidence is presented to operations, support, customer, or developer personas
- **THEN** ordering and labels may differ while factual claim text and outcome remain unchanged

### Requirement: Review validation is observable
Runtime logs SHALL record rejected claims, invalid evidence references, frozen outcome, presentation fallback, and accepted claim IDs without exposing hidden prompts or sensitive payloads.

#### Scenario: Unsupported worker claim is rejected
- **WHEN** worker output contains an unsupported fact
- **THEN** the diagnostic log identifies the rejected claim and the main reply omits it