# Architecture Documentation

This section defines the client architecture, major constraints, and accepted technical decisions.

## Contents
- ADR index: `docs/architecture/adrs/README.md`
- ADR template: `docs/architecture/adrs/ADR_TEMPLATE.md`

## Current Focus
- Electron process boundaries and renderer safety model.
- Vue 3 client architecture and PrimeVue unstyled design-system approach.
- Pinia-based state organization with server-scoped isolation.
- Clear client/backend contract boundaries for this repository.

## Updating Architecture Docs
1. Create or update an ADR for major decisions.
2. Link the ADR in the ADR index.
3. Reference impacted feature specs in `docs/features/`.
