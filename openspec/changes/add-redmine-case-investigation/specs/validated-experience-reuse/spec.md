## ADDED Requirements

### Requirement: Experience SHALL not short-circuit configured case investigation
Experience SHALL expose evidence-only collection and treat reusable/rejected prior-session matches as candidates while historical-case investigation is configured.

#### Scenario: Reusable Experience match exists
- **WHEN** a match would normally satisfy the fast path
- **THEN** Runtime SHALL add its bounded current-revalidated history evidence to the aggregator
- **AND** it SHALL continue Redmine collection, Worker verification when leads exist, Review, and Presentation

#### Scenario: No Experience match exists
- **WHEN** no candidate exists
- **THEN** collection SHALL return no-hit without creating a helper reply

#### Scenario: Legacy workspace has no historical source
- **WHEN** case investigation is not configured
- **THEN** existing reviewed Experience reuse SHALL remain compatible
