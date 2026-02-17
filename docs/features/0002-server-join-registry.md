# Feature: Server Join and Registry Management

- Status: Implemented (M1 baseline)
- Owners: Maintainers
- Last Updated: 2026-02-17
- Related ADRs: `docs/architecture/adrs/0003-client-only-boundary.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`
- Related Issues: TBD

## Problem Statement
Users need a reliable way to join, configure, and manage multiple servers where each server maps to an independent backend.

## User Stories
- As a user, I want to join a server from a backend URL so that I can access that community.
- As a user, I want to remove a joined server so that I can keep my server list clean.
- As a user, I want trust and security warnings before joining so that I can make informed decisions.
- As a user, I want to see exactly what identity data is shared so that I can verify UID-only disclosure.

## Scope
### In Scope
- Join flow from backend URL input with server discovery.
- Capability probe before join confirmation.
- Trust warning summary from capability/security probe.
- Server registry listing in server rail.
- Manual add flow when discovery is unavailable.
- Leave/remove server flow from server context menu.

### Out of Scope
- Invite-code parsing/join flow.
- Server profile editing after join (display name/icon overrides).
- Leave confirmation modal.
- Server creation workflows.
- Backend provisioning automation.
- Cross-device sync of joined server list.

## UX Flow
1. User opens "Add Server" dialog.
2. User enters backend URL and discovers available servers (`GET /v1/servers`).
3. User selects a discovered server (or enters server ID/display name manually).
4. Client probes capabilities and computes trust warnings.
5. User confirms add; server is persisted in local registry and becomes active.
6. User can leave from server context menu; client removes registry entry and clears server-scoped state.

## UI States
- Loading: discovery and capability probe.
- Empty: no servers joined.
- Success: server added and visible in rail.
- Error: invalid URL, discovery failure, probe failure, duplicate server ID.
- Degraded/Offline: cannot probe server during join attempt.

## Backend Capability Assumptions
- Capability discovery endpoint exists and returns required fields.
- Server identity metadata is available.
- Backends expose supported transport/identity/features for compatibility checks.
- Capability response includes `profile_data_policy` and `user_uid_policy`.

## Client Data Model and State Impact
- Stores touched: `useServerRegistryStore`, `useSessionStore`, `useAppUiStore`, `useChatStore`, `useCallStore`.
- Caches affected: capability snapshot per server; server-scoped chat/realtime/call state on leave.
- Persistence requirements:
  - persist non-sensitive server profile metadata
  - clear server-scoped volatile caches on server removal

## Security and Privacy Considerations
- Show explicit warnings for insecure transport and HTTPS-required mismatches.
- Do not automatically trust unknown servers without user confirmation.
- Preserve UID-only disclosure baseline in join summary and profile panel messaging.
- Remove associated sensitive session state when a server is removed.

## Accessibility Requirements
- Join/add dialogs fully keyboard-navigable.
- Clear validation messaging announced to screen readers.

## Telemetry and Observability
- Events:
  - join/remove telemetry is not wired yet in the current baseline.
- Error logging:
  - include server and probe context when available

## Testing Strategy
- Unit: URL validation and registry CRUD reducers/actions.
- Component: join dialog states and warning presentation.
- Integration: capability probe + join persistence flow.
- End-to-end: add server, switch server, remove server.
- Manual QA: trust warning clarity and recoverability from probe failures.

## Rollout Plan
- Milestone target: M1 (completed baseline).
- Guardrails: block join for clearly incompatible capabilities with actionable messaging.
- Success metrics:
  - join completion rate
  - discovery/probe failure distribution
  - leave flow success rate

## Open Questions
- Should users be able to override compatibility checks in advanced mode?
- What minimal metadata is editable client-side vs backend-authoritative?
- Should UID policy default to global stable UID or server-scoped pseudonymous UID?
