# ADR-0008: Local Vue Components

- Status: Accepted
- Date: 2026-09-17
- Deciders: OpenChat Client maintainers
- Supersedes: `docs/architecture/adrs/0001-electron-vue-primevue-unstyled.md`

## Context
The renderer already uses local Vue components, native HTML controls, and tokenized CSS. The previously configured UI library supplies no components to product surfaces.

## Decision
Keep the existing local-component approach without a general-purpose UI component library. Share reusable controls through the client design system, and own their styling and accessible interaction behavior.

## Consequences
- Removing the unused dependency does not require replacing current UI components.
- The client maintains keyboard, focus, and screen-reader behavior for its reusable controls.
- Future component needs are evaluated against this local design system rather than assuming an external library.
