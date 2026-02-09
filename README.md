# OpenChat Client

OpenChat Client is an open-source Electron desktop app that provides a Discord-like experience while connecting each joined server to its own independent backend.

## Status
- Planning and documentation phase.
- No production-ready binaries yet.
- This repository currently contains design docs and architecture decisions.

## Scope
- Client-side desktop application only.
- Frontend stack direction: Electron + Vue 3 + PrimeVue (unstyled) + Pinia.
- Multi-server UX where each server entry maps to a distinct backend endpoint.

This repo does not include backend service code.

## Project Principles
- Keep user experience familiar, fast, and keyboard-friendly.
- Isolate server data and trust boundaries per server.
- Ship with strong security defaults for Electron and credentials.
- Require documentation for user-facing features before implementation.

## Documentation Map
- Planning document: `AGENTS.md`
- Contributing guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Support policy: `SUPPORT.md`
- Architecture docs: `docs/architecture/README.md`
- ADR index: `docs/architecture/adrs/README.md`
- Feature specs: `docs/features/README.md`

## Getting Started (Current Phase)
1. Read `AGENTS.md` for scope and milestones.
2. Read `docs/architecture/adrs/README.md` for accepted technical decisions.
3. Use `docs/features/FEATURE_TEMPLATE.md` for new feature proposals.

## Open Source Contribution
Contributions are welcome. Start with `CONTRIBUTING.md`, then open an issue or proposal before major changes.

## License
License to be added before first public release candidate.
