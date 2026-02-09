# ADR-0004: Multi-Server Isolation Model

- Status: Accepted
- Date: 2026-02-09
- Deciders: OpenChat Client maintainers
- Related: `AGENTS.md`, `docs/architecture/adrs/0002-pinia-state-architecture.md`

## Context
Each joined server in OpenChat maps to an independent backend endpoint. Without strict isolation, client state, credentials, and cached data could leak across server contexts.

## Decision
Adopt strict server-scoped isolation for configuration, connection state, caches, and session contexts.

Core rules:
- Every domain store holding server data must key by `server_id`.
- Connection management is independent per server profile.
- Trust state and endpoint metadata are stored per server.
- Removing a server clears its volatile and cached state.
- Sign-out clears server-scoped sensitive state and session linkage.

## Alternatives Considered
- Single global state model with active-server filtering only.
- Partial isolation for credentials but shared domain caches.

## Consequences
### Positive
- Reduces risk of cross-server data contamination.
- Supports mixed trust levels and capability differences between servers.
- Improves reliability by isolating reconnect and failure handling.

### Negative
- Higher implementation complexity in store and cache layers.
- Additional QA matrix for server switching and isolation correctness.
- More explicit APIs are needed for cross-store coordination.

## Implementation Notes
- Add tests that simulate rapid server switching and reconnect events.
- Validate no cross-server reads in selectors and computed state.
- Define observability fields with `server_id` context for debugging.
