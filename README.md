# OpenChat Client

OpenChat Client is an open-source Electron desktop app that provides a Discord-like experience while connecting each joined server to its own independent backend.

## Status
- Early implementation phase (Milestone 0 scaffolding).
- No production-ready binaries yet.
- Repository now includes initial Electron + Vue runtime plus planning docs.

## Scope
- Client-side desktop application only.
- Frontend stack direction: Electron + Vue 3 + PrimeVue (unstyled) + Pinia.
- Multi-server UX where each server entry maps to a distinct backend endpoint.
- User data ownership model: personal identity/profile remains local; servers know only `user_uid` plus required protocol proofs.
- Package manager/runtime mode: Yarn v4 with `node-modules` linker.

This repo does not include backend service code.

## Project Principles
- Keep user experience familiar, fast, and keyboard-friendly.
- Isolate server data and trust boundaries per server.
- Keep user identity/profile ownership local to the client by default.
- Ship with strong security defaults for Electron and credentials.
- Require documentation for user-facing features before implementation.

## Documentation Map
- Planning document: `AGENTS.md`
- Contributing guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Support policy: `SUPPORT.md`
- Architecture docs: `docs/architecture/README.md`
- ADR index: `docs/architecture/adrs/README.md`
- Backend contract: `docs/architecture/backend-contract.md`
- Design system architecture: `docs/architecture/design-system.md`
- Feature specs: `docs/features/README.md`
- Milestones: `docs/release/milestones.md`

## Getting Started (Current Phase)
1. Read `AGENTS.md` for scope and milestones.
2. Read `docs/architecture/adrs/README.md` for accepted technical decisions.
3. Install dependencies: `yarn install`
4. Start desktop app in dev mode: `yarn dev`
5. Type-check renderer/main/preload code: `yarn typecheck`
6. Use `docs/features/FEATURE_TEMPLATE.md` for new feature proposals.

## Open Source Contribution
Contributions are welcome. Start with `CONTRIBUTING.md`, then open an issue or proposal before major changes.

## License
License to be added before first public release candidate.
