# Feature: User Identity and Session UI

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-09
- Related ADRs: `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`
- Related Issues: TBD

## Problem Statement
Users need a consistent identity experience across multiple servers while keeping personal profile data local to their device. Servers should only receive an opaque `user_uid` and required handshake/session proofs.

## User Stories
- As a user, I want one local identity that I can use across servers.
- As a user, I want to know exactly what identity data is shared with a server.
- As a user, I want session state visibility and recovery without exposing profile details to servers.

## Scope
### In Scope
- Local identity initialization flow (create/import).
- Per-server identity binding flow (UID + proof-based session establishment).
- Session status indicators (active, expiring, expired, invalid).
- Sign-out and session reset flows per server.
- Disclosure UI that confirms UID-only data sharing.

### Out of Scope
- Backend identity provider implementation.
- Server-side storage of user profile attributes.
- Cloud sync of personal identity profile data.

## UX Flow
1. User opens identity setup (first run) and creates/imports local identity.
2. User selects server and starts identity binding.
3. Client shows server-supported handshake mode and disclosure summary.
4. User confirms; client completes challenge/proof handshake.
5. Session state updates for that server.
6. If session expires, user is prompted to re-bind or refresh.

## UI States
- Loading: identity initialization or session validation in progress.
- Empty: no local identity configured or no active server session.
- Success: identity ready and session active for selected server.
- Error: handshake rejected, expired proof, unsupported handshake mode.
- Degraded/Offline: cannot validate or refresh session due to connectivity.

## Backend Capability Assumptions
- `identity_handshake_modes` is provided via capability discovery.
- `profile_data_policy` supports `uid_only`.
- Session validation/introspection behavior is documented.
- Errors provide stable `code` and `retryable` fields.

## Client Data Model and State Impact
- Stores touched: `useIdentityStore`, `useSessionStore`, `useServerRegistryStore`, `useAppUiStore`.
- Caches affected: session status cache per `server_id`.
- Persistence requirements:
  - local identity material stored securely on device
  - no plain local storage for sensitive credentials/proof material

## Security and Privacy Considerations
- Personal identity/profile data remains local by default.
- Only `user_uid` and protocol-required proofs are transmitted to server.
- Session data is isolated per `server_id`.
- Sign-out clears sensitive in-memory state.

## Accessibility Requirements
- Fully keyboard-operable identity and session dialogs.
- Proper labels and error announcements for screen readers.
- Focus management after success/failure and disclosure acknowledgment.

## Telemetry and Observability
- Events:
  - `identity_setup_started`
  - `identity_setup_completed`
  - `identity_bind_started`
  - `identity_bind_succeeded`
  - `identity_bind_failed`
  - `session_expired`
- Error logging:
  - include `server_id`, `error_code`, `retryable`
  - exclude secrets and personal profile metadata

## Testing Strategy
- Unit: identity/session state transitions and error mapping.
- Component: identity setup, disclosure panel, and session banner behaviors.
- Integration: handshake mode discovery + bind/session validation flows.
- End-to-end: setup identity, bind to server, sign out, expiration recovery.
- Manual QA: multi-server session switching with identity continuity.

## Rollout Plan
- Milestone target: M1.
- Guardrails:
  - block incompatible servers that require personal profile upload
  - show explicit warnings for unsupported identity policies
- Success metrics:
  - identity bind success rate
  - average session recovery time
  - disclosure-confirmation completion rate

## Open Questions
- Default UID policy: global stable UID or server-scoped pseudonymous UID?
- Should identity key rotation be in MVP or post-MVP?
