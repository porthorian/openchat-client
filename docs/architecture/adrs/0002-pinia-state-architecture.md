# ADR-0002: Pinia-Centered State Architecture

- Status: Accepted
- Date: 2026-02-09
- Deciders: OpenChat Client maintainers
- Related: `AGENTS.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`

## Context
The client requires predictable reactive state across multiple server contexts, real-time updates, and offline/degraded UX handling. State must remain understandable and auditable as the app grows.

## Decision
Use Pinia as the primary state management layer for client and UI state.

Adopt a service-layer-first model for transport and request logic. Optional `@tanstack/vue-query` usage is allowed where request cache/synchronization complexity justifies it.

Current store boundaries in this repository:
- `useAppUIStore`
- `useIdentityStore`
- `useSessionStore`
- `useServerRegistryStore`
- `useChatStore` (channels, messages, presence, typing, profile sync, unread state, notification prefs)
- `useCallStore`

The original planned split (`useChannelStore`/`useMessageStore`/`usePresenceStore`/`useSettingsStore`) is deferred; those concerns are currently consolidated in `useChatStore` for M1/M2 velocity.

## Alternatives Considered
- Vuex.
- Ad hoc composables-only state without a centralized store.
- Vue Query as primary state system for all domains.

## Consequences
### Positive
- Clear ownership boundaries and predictable global state behavior.
- Strong TypeScript ergonomics with Vue 3 composition model.
- Easier testing of domain state transitions and optimistic update flows.

### Negative
- Requires discipline to avoid overloading global stores with transport side effects.
- Some domains may duplicate cache logic if Vue Query adoption is delayed.
- Store contracts become critical and need strong review standards.

## Implementation Notes
- Key all server-scoped state by `server_id`.
- Persist only non-sensitive preferences by default.
- Store credentials and tokens via secure Electron/OS facilities, not local storage.
- Define TTL and cache bounds for high-volume message/presence stores.
