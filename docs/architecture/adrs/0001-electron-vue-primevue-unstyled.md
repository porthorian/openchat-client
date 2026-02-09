# ADR-0001: Electron + Vue 3 + PrimeVue (Unstyled)

- Status: Accepted
- Date: 2026-02-09
- Deciders: OpenChat Client maintainers
- Related: `AGENTS.md`, `docs/architecture/adrs/0002-pinia-state-architecture.md`

## Context
The project requires a desktop client with a Discord-like UX, rapid iteration speed, and strong control over visual styling. The team wants reusable accessible primitives without inheriting an opinionated visual theme.

## Decision
Use Electron for desktop runtime, Vue 3 for renderer architecture, and PrimeVue in global unstyled mode for component behavior primitives.

PrimeVue components must be wrapped inside local design-system components before broad usage in product surfaces.

## Alternatives Considered
- Electron + Vue + Vuetify.
- Electron + Quasar.
- Electron + Vue with only headless primitives and no component library.

## Consequences
### Positive
- Strong alignment with desktop requirements and existing Vue ecosystem.
- Unstyled mode supports a custom Discord-like visual system.
- Faster delivery by reusing mature component behavior and accessibility primitives.

### Negative
- Additional design-system wrapper work is required.
- PrimeVue API updates can impact wrappers and internal contracts.
- Team must actively prevent accidental styled-component usage.

## Implementation Notes
- Enforce unstyled mode at app bootstrap.
- Add lint or review rule preventing direct usage of non-wrapped PrimeVue components in feature code.
- Document each wrapped component in design-system docs.
