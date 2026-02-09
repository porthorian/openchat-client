# ADR-0003: Client-Only Repository Boundary

- Status: Accepted
- Date: 2026-02-09
- Deciders: OpenChat Client maintainers
- Related: `AGENTS.md`

## Context
OpenChat uses per-server independent backends. Mixing backend implementation into this repository would blur ownership boundaries, slow client iteration, and complicate security review.

## Decision
This repository is strictly for the user-facing desktop client and supporting client tooling/documentation.

Backend services, infrastructure, and server-side business logic are explicitly out of scope. Backend interactions are represented only as typed contracts, capability assumptions, and integration docs.

## Alternatives Considered
- Monorepo containing client and backend implementations.
- Shared repository for client plus minimal reference backend code.

## Consequences
### Positive
- Clear responsibility boundaries and cleaner contributor onboarding.
- Faster client release cadence independent of backend deployment schedules.
- Reduced accidental coupling between UI concerns and server internals.

### Negative
- Requires explicit cross-repo coordination on API contract changes.
- Local end-to-end testing may require separate backend setup or mocks.
- Some contributors may need to work across repositories for full features.

## Implementation Notes
- Reject backend runtime code in this repository during review.
- Maintain backend interface contract docs in client docs.
- Require feature specs to identify backend capability assumptions.
