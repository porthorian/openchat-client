# Feature: AT Protocol Identity Linking

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-15
- Related ADRs: `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`, `docs/architecture/adrs/0007-at-protocol-hybrid-integration.md`
- Related Issues: TBD

## Problem Statement
Users need a safe, server-scoped way to link an AT identity so AT-enabled servers can interoperate without weakening OpenChat's user-owned identity and UID-only disclosure baseline.

## User Stories
- As a user, I want to link my AT identity to a specific server so that I can use AT-enabled interoperability features there.
- As a user, I want to unlink or relink easily so that I can recover from revoked or expired credentials.
- As a user, I want clear disclosure of what identity data is shared so that I can make informed trust decisions.
- As a user, I want link status and health indicators so that I can troubleshoot capability issues.

## Scope
### In Scope
- Server-scoped AT identity link flow in join/settings surfaces.
- Explicit user consent and disclosure summary before completing link.
- Link lifecycle controls: view status, relink, unlink.
- Per-server DID/handle status display and verification timestamp.
- Secure handling of AT session artifacts using Electron main process and OS keychain path.
- Clear error handling for unsupported modes, expired challenges, and revoked sessions.

### Out of Scope
- Automatic global identity linking across all servers.
- Default upload/sync of personal profile fields to servers.
- Direct renderer-to-PDS credential exchange.
- Account recovery flows beyond unlink/relink in MVP.

## UX Flow
1. User opens server settings and navigates to identity section.
2. Client checks server capabilities and offers "Link AT Identity" when supported.
3. User reviews disclosure summary and initiates linking.
4. Client performs backend-mediated link challenge flow.
5. On success, linked DID/handle status appears with verification timestamp.
6. User may unlink at any time with confirmation.
7. Unlink clears server-scoped AT session artifacts and returns to unlinked state.

## UI States
- Loading: capability check, current link lookup, challenge start.
- Empty: AT supported but identity not linked.
- Success: linked identity with healthy status.
- Error: resolution failure, challenge expiry, revoked session, or permission denial.
- Degraded/Offline: unable to re-verify existing link; state marked stale.

## Backend Capability Assumptions
- `GET /client/capabilities` includes `atproto.enabled`, `atproto.auth_modes`, and compatibility flags.
- Backend exposes link lifecycle endpoints (naming TBD in contract):
  - start link challenge
  - complete link challenge
  - fetch current link status
  - unlink/revoke
- Backend returns normalized identity metadata:
  - `did`
  - `handle` (if available)
  - `status`
  - `verified_at`
- Error payloads include stable codes (for example: `did_resolution_failed`, `challenge_expired`, `session_revoked`, `unsupported_auth_mode`).

## Client Data Model and State Impact
- Stores touched: `useIdentityStore`, `useSessionStore`, `useServerRegistryStore`, `useAppUiStore`.
- Caches affected: per-server AT link status cache and verification freshness.
- Persistence requirements:
  - persist non-sensitive link metadata per `server_id`
  - persist sensitive session references via secure storage only
  - clear link/session artifacts on unlink and server removal

## Security and Privacy Considerations
- Linking requires explicit user action and clear disclosure.
- UID-only baseline disclosure remains default for chat operations.
- Link metadata is strictly server-scoped to prevent cross-server leakage.
- Insecure transport or trust failures must surface blocking/warning UI as policy requires.
- Logs and telemetry must redact proof/session secrets.

## Accessibility Requirements
- Full keyboard navigation through all link/unlink interactions.
- Screen-reader announcements for status changes and error outcomes.
- Deterministic focus handling after async completion, cancel, or failure.

## Telemetry and Observability
- Events to instrument:
  - `atproto_link_started`
  - `atproto_link_succeeded`
  - `atproto_link_failed`
  - `atproto_unlink_succeeded`
- Error logging expectations:
  - include `server_id` and normalized error code
  - do not include raw challenge or token material
- Privacy constraints:
  - avoid sending raw DID/handle values unless explicitly approved by privacy policy

## Testing Strategy
- Unit: link state transitions, stale-state handling, and permission gating.
- Component: disclosure UI, link controls, and error rendering.
- Integration: capability-gated link lifecycle API behavior.
- End-to-end: join server, link identity, unlink, and relink recovery.
- Manual QA: trust warning clarity and offline/degraded status handling.

## Rollout Plan
- Milestone target: M1/M2 integration foundation.
- Guardrails and fallback behavior:
  - hide link actions when `atproto.enabled` is false
  - disable linking when capability probe is incompatible or stale
- Success metrics:
  - link completion rate
  - failure reason distribution
  - unlink/relink recovery success rate

## Open Questions
- Should servers support multiple linked DIDs per local user for advanced role separation?
- Should handle display be mandatory in UI or diagnostic-only?
- What verification refresh interval balances trust freshness and network cost?
