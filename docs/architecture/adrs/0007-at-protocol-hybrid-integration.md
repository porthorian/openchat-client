# ADR-0007: AT Protocol Hybrid Integration Model

- Status: Proposed
- Date: 2026-02-15
- Deciders: OpenChat Client maintainers
- Related: `AGENTS.md`, `docs/architecture/backend-contract.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`, `docs/features/0010-atproto-identity-linking.md`, `docs/features/0011-atproto-server-capabilities.md`, `docs/features/0012-atproto-message-sync.md`

## Context
OpenChat supports independent server backends and must preserve a consistent Discord-like UX across heterogeneous deployments. The project now needs an AT Protocol integration path that supports interoperability without forcing a single backend architecture across all servers.

Several constraints must hold:
- This repository remains client-only.
- Multi-server isolation rules remain strict (`server_id`-scoped state).
- User-owned identity and UID-only baseline disclosure remain default behavior.
- Permission and moderation semantics must stay deterministic for OpenChat UX.

Without a clear integration model, AT support risks fragmenting client behavior and weakening trust and privacy boundaries.

## Decision
Adopt a hybrid, backend-mediated AT Protocol integration model.

- AT support is optional and capability-gated per server.
- OpenChat backend remains the primary client-facing authority for timeline queries, permissions, and moderation outcomes.
- AT integration is handled by backend bridge capabilities that perform:
  - DID/handle resolution and AT auth/session lifecycle
  - lexicon record mapping for durable chat objects
  - repo write operations and event ingestion/sync
  - label/moderation signal ingestion into OpenChat read models
- Client integrations consume normalized backend contracts and AT diagnostics; renderer does not depend on raw AT endpoints for MVP behavior.
- Durable entities map to AT lexicons (server profile, channels, messages, memberships, reactions, read receipts). Ephemeral signals (typing, transient presence/voice indicators) remain realtime transport events rather than durable AT records.
- Linking an AT identity is explicit user opt-in per server and does not expand baseline profile disclosure beyond UID/proof unless a future ADR is accepted.

## Alternatives Considered
- Direct AT-native renderer integration where client talks to PDS/AppView for primary chat operations.
- Deferring AT support entirely until after stable release.
- Requiring full AT-native backend migration before shipping any interoperability features.

## Consequences
### Positive
- Preserves current OpenChat UX model while adding AT interoperability.
- Supports incremental rollout across servers with different capability sets.
- Keeps AT complexity mostly server-side, reducing renderer coupling.
- Maintains existing identity/privacy boundaries from ADR-0005.

### Negative
- Increases backend integration and reconciliation complexity.
- Introduces dual-model consistency risks between OpenChat read models and AT repo state.
- Requires stronger observability and replay/idempotency controls.
- Delays fully AT-native client behavior in favor of bridge-first delivery.

## Implementation Notes
- Extend capability discovery contracts with AT-specific fields and compatibility semantics.
- Implement planning/spec coverage for:
  - identity linking
  - server AT capability negotiation and trust UI
  - message sync and reconciliation states
- Define lexicon namespace and record mappings in interface documentation (no backend service code in this repository).
- Add integration test fixtures for AT-enabled and non-AT servers, including degraded and partial-capability modes.
- Require explicit security/privacy review for any behavior that expands server-visible user data beyond UID/proof baseline.
