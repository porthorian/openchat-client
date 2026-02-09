# Feature: Server Join and Registry Management

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-09
- Related ADRs: `docs/architecture/adrs/0003-client-only-boundary.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`
- Related Issues: TBD

## Problem Statement
Users need a reliable way to join, configure, and manage multiple servers where each server maps to an independent backend.

## User Stories
- As a user, I want to join a server from an invite or URL so that I can access that community.
- As a user, I want to edit or remove a joined server so that I can keep my server list clean.
- As a user, I want trust and security warnings before joining so that I can make informed decisions.
- As a user, I want to see exactly what identity data is shared so that I can verify UID-only disclosure.

## Scope
### In Scope
- Join flow from invite/URL input.
- Capability probe before join confirmation.
- Identity disclosure summary in join confirmation.
- Server registry listing and ordering in server rail.
- Server profile editing (display name, icon override, endpoint metadata where allowed).
- Remove server flow with confirmation.

### Out of Scope
- Server creation workflows.
- Backend provisioning automation.
- Cross-device sync of joined server list.

## UX Flow
1. User opens "Join Server" dialog.
2. User pastes invite or backend URL.
3. Client validates URL and probes capabilities.
4. Client displays server identity, trust state, warnings, and data-disclosure summary.
5. User confirms join; server is added to registry and rail.
6. User can later edit metadata or remove server.

## UI States
- Loading: capability probe and identity fetch.
- Empty: no servers joined.
- Success: server added and visible in rail.
- Error: invalid URL, probe failure, incompatible backend.
- Degraded/Offline: cannot probe server during join attempt.

## Backend Capability Assumptions
- Capability discovery endpoint exists and returns required fields.
- Server identity metadata is available.
- Backends expose supported transport/identity/features for compatibility checks.
- Capability response includes `profile_data_policy` and `user_uid_policy`.

## Client Data Model and State Impact
- Stores touched: `useServerRegistryStore`, `useSessionStore`, `useAppUiStore`.
- Caches affected: capability snapshot per server.
- Persistence requirements:
  - persist non-sensitive server profile metadata
  - clear server-scoped volatile caches on server removal

## Security and Privacy Considerations
- Show explicit warnings for insecure transport and certificate mismatch.
- Do not automatically trust unknown servers without user confirmation.
- Block or warn for servers that do not support UID-only disclosure policy.
- Present explicit "data sent to server" panel (UID + proof only).
- Remove associated sensitive session state when a server is removed.

## Accessibility Requirements
- Join and edit dialogs fully keyboard-navigable.
- Clear validation messaging announced to screen readers.
- Confirmation dialogs with predictable focus behavior.

## Telemetry and Observability
- Events:
  - `server_join_started`
  - `server_join_succeeded`
  - `server_join_failed`
  - `server_removed`
- Error logging:
  - include `server_id` when available
  - include probe error code

## Testing Strategy
- Unit: URL validation and registry CRUD reducers/actions.
- Component: join dialog states and warning presentation.
- Integration: capability probe + join persistence flow.
- End-to-end: add server, switch server, edit server, remove server.
- Manual QA: trust warning clarity and recoverability from probe failures.

## Rollout Plan
- Milestone target: M1.
- Guardrails: block join for clearly incompatible capabilities with actionable messaging.
- Success metrics:
  - join completion rate
  - join failure reasons distribution
  - server removal friction

## Open Questions
- Should users be able to override compatibility checks in advanced mode?
- What minimal metadata is editable client-side vs backend-authoritative?
- Should UID policy default to global stable UID or server-scoped pseudonymous UID?
