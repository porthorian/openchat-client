# Feature: User Identity and Session UI

- Status: Implemented (M1 baseline)
- Owners: Maintainers
- Last Updated: 2026-02-17
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
- Local identity initialization flow (create) during onboarding.
- Local profile fields: username, avatar mode/preset/upload image, compliance acknowledgements.
- Per-server UID projection (`server_scoped` / `global`) with active mode toggle.
- Session state binding per server in `useSessionStore` (`active` baseline).
- Disclosure UI in profile panel that confirms UID-only data sharing.

### Out of Scope
- Identity import/export flows.
- Session token refresh/expiry UX.
- Sign-out UI and explicit per-server session revocation UX.
- Backend identity provider implementation.
- Server-side storage of user profile attributes.
- Cloud sync of personal identity profile data.

## UX Flow
1. User completes first-run profile + compliance onboarding.
2. Client generates local identity root and persists local profile state.
3. For each active server, client projects `user_uid` from local identity and selected UID mode.
4. Session state for that server is set to `active` with projected `user_uid`.
5. User can toggle UID mode in profile panel; client reprojects per-server UIDs and rehydrates active server state.

## UI States
- Loading: identity initialization during app startup.
- Empty: onboarding not completed.
- Success: identity/profile initialized and session active for selected server.
- Error: onboarding validation errors (username/compliance) or server hydration failures.
- Degraded/Offline: server hydration fails or server becomes unreachable.

## Backend Capability Assumptions
- `identity_handshake_modes` and `user_uid_policy` are available via capabilities.
- `profile_data_policy` supports `uid_only`.
- Requester identity is carried via `X-OpenChat-User-UID` and `X-OpenChat-Device-ID`.

## Client Data Model and State Impact
- Stores touched: `useIdentityStore`, `useSessionStore`, `useServerRegistryStore`, `useAppUiStore`.
- Caches affected: session map keyed by `server_id`.
- Persistence requirements:
  - local profile and identity projection inputs are persisted in browser localStorage
  - no credentials/tokens are currently persisted by this client

## Security and Privacy Considerations
- Personal identity/profile data remains local by default.
- Server calls use projected `user_uid` plus device identifier headers.
- Session data is isolated per `server_id`.
- Sign-out/revocation flows are not implemented yet.

## Accessibility Requirements
- Fully keyboard-operable onboarding profile/compliance flow.
- Proper labels and error announcements for screen readers.
- Focus management after success/failure and disclosure acknowledgment.

## Telemetry and Observability
- Events:
  - identity/session telemetry is not wired yet in the current baseline.
- Error logging:
  - include `server_id` and failure context when available
  - exclude secrets and personal profile metadata

## Testing Strategy
- Unit: identity initialization, UID projection, and persistence behavior.
- Component: onboarding profile/compliance flow and profile disclosure panel.
- Integration: server hydration + projected UID session assignment.
- End-to-end: complete onboarding, join server, switch UID mode, reload app state.
- Manual QA: multi-server session switching with identity continuity.

## Rollout Plan
- Milestone target: M1 (completed baseline).
- Guardrails:
  - block incompatible servers that require personal profile upload
  - show explicit warnings for unsupported identity policies
- Success metrics:
  - onboarding completion rate
  - server hydration success rate
  - UID mode toggle success rate

## Open Questions
- Default UID policy: global stable UID or server-scoped pseudonymous UID?
- Should identity key rotation be in MVP or post-MVP?
