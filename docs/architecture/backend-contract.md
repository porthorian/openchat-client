# Backend Interface Contract (Client View)

This document defines backend assumptions required by the OpenChat client. It is a client-facing contract reference, not backend implementation guidance.

## 1) Contract Principles
- This repository remains client-only.
- Backend behavior is represented by typed contracts and capability negotiation.
- The client must degrade gracefully when optional capabilities are unavailable.
- Per-server contract differences are supported through capability flags.
- User profile and personal identity metadata are user-owned and local-only by default.
- Server-side identity knowledge is limited to an opaque unique user identifier (`user_uid`) plus protocol-required proofs.

## 2) Server Identity and Capability Discovery

### Required discovery endpoint
- `GET /client/capabilities`

### Required capability response fields
- `server_name`
- `server_id` (backend-issued identifier)
- `api_version`
- `identity_handshake_modes` (list)
- `user_uid_policy` (global UID accepted, server-scoped UID required, or both)
- `profile_data_policy` (must declare `uid_only` compatibility for this client)
- `transport` (WebSocket/SSE/polling support)
- `features` (feature flags and limits)
- `limits` (message size, upload size, rate limits)
- `security` (transport requirements, optional certificate metadata)

### Client behavior
- Probe capabilities before finalizing server join.
- Store capability snapshot in server profile.
- Re-probe on reconnect when server version changes.
- Block or warn on servers that do not support `uid_only` profile policy.

## 3) Identity Binding Contract (UID-Only)

### Identity model
- User identity root is generated/imported and stored locally by the client.
- Backend receives only:
  - `user_uid` (opaque unique identifier)
  - required proof material for handshake/session continuity
- Backend must not require user profile fields such as name, email, avatar, or phone.

### Handshake expectations
- Server advertises supported handshake mode(s).
- Client performs challenge/proof binding flow to establish session.
- Server returns accepted `user_uid` and optional session token metadata.

### Required identity behaviors
- Stable and clear error semantics for invalid/expired proof material.
- Session validity check endpoint or equivalent server behavior.
- Logout/revocation endpoint or explicit revocation behavior.

### Client constraints
- Sensitive material never persisted in plain local storage.
- Identity/session state is tied to `server_id`.
- UI must clearly disclose that only UID/proof data is shared with server.

## 4) Session Tokens (Optional)
- Servers may issue session tokens after identity binding.
- Token claims should be minimal and avoid personal profile data.
- Recommended claims:
  - `user_uid`
  - `server_id`
  - scope/permissions
  - expiry

## 5) Realtime Transport Contract

### Preferred transport
- WebSocket transport when available.

### Fallback transports
- Server may advertise SSE or polling fallback.

### Event envelope
All realtime events should include:
- `event_type`
- `server_id`
- `channel_id` (if applicable)
- `event_id`
- `timestamp`
- `payload`

### Author identity in events/messages
- Message and presence events should use `author_uid` / `user_uid`.
- No server-required personal profile payloads are assumed by this client.

### Delivery and ordering assumptions
- Server should provide monotonic event identifiers per stream.
- Client supports at-least-once handling and duplicate suppression.

## 6) Core Domain Endpoints (Minimum Expectations)
- Server metadata and user membership state retrieval.
- Channel list retrieval and updates.
- Message pagination for timeline history.
- Message send endpoint with server-assigned message id.
- Presence and typing update streams.

The exact URI layout is backend-defined, but capabilities must describe available operations and versions.

## 7) Pagination and Synchronization
- Cursor-based pagination is preferred for message history.
- Endpoints should return `next_cursor` and ordering guarantees.
- Client uses bounded windows and discards stale pages by policy.

## 8) Error Model

### Required error fields
- `code`
- `message`
- `retryable` (boolean)
- `details` (optional)

### Client mapping expectations
- Identity binding errors map to identity/session UX states.
- Permission errors map to access-denied UX states.
- Rate-limit errors map to cooldown/retry UX states.

## 9) Connection and Resume Behavior
- Server should advertise reconnect guidance (retry hints, backoff hints).
- Resume token flow is recommended for realtime session continuity.
- Client falls back to full sync when resume is not supported.

## 10) RTC and Signaling Contract

### RTC capability fields
When media is supported, capability discovery should include `rtc` with:
- `protocol_version`
- `signaling_url`
- `signaling_transport` (`websocket` for current contract)
- `topologies` (must include `sfu` for group channels)
- `features` (`voice`, `video`, `screenshare`, `simulcast`)
- `ice_servers` (STUN/TURN definitions with credential metadata)
- `connection_policy` (`join_timeout_ms`, `answer_timeout_ms`, `ice_restart_enabled`, `reconnect_backoff_ms`)

### Join and signaling expectations
- `POST /v1/rtc/channels/:channel_id/join-ticket`:
  - validates session + channel membership + media permission state
  - returns short-lived, one-time signaling join ticket
- `GET /v1/rtc/signaling` (WebSocket upgrade):
  - accepts join ticket
  - supports SDP/ICE exchange and participant state events

Join tickets should be scoped minimally to:
- `server_id`
- `channel_id`
- `user_uid`
- `device_id`
- permitted media actions
- expiry and single-use identifier

### RTC event expectations
Backends should emit explicit events for:
- participant join/leave
- track publish/unpublish
- speaking state updates
- negotiation/permission errors
- forced disconnect (`kick`, `ban`, policy revoke)

### Moderation and permission integration
- Moderation enforcement should immediately invalidate relevant RTC access.
- `kick`/`ban` should force disconnect active media sessions.
- `timeout`/channel-level restrictions should map to deterministic permission errors.

## 11) Attachments and Media
- Capability flags must indicate upload support and limits.
- Server response should include stable media URLs or retrieval tokens.
- Client supports placeholder and failure states for uploads.

## 12) Versioning and Compatibility
- `api_version` must be exposed in capability discovery.
- Backward-compatible changes should not break previous minor client versions.
- Breaking changes require explicit version bump and migration guidance.

## 13) Security Requirements for Compatible Backends
- HTTPS required in production use.
- Certificate mismatch or insecure transport should trigger explicit client warnings.
- Servers must not require privileged renderer execution patterns.
- Servers compatible with this client must support a UID-only identity boundary.

## 14) Contract Testing Strategy
- Client integration tests use contract fixtures for capabilities and error shapes.
- Contract test matrix includes capability variation by server.
- New feature specs must declare required capability flags.
- Tests must verify no personal profile fields are required by server paths.

## 15) Moderation and Governance Contract

### Capability fields
Moderation-capable backends should expose moderation policy in discovery payloads, for example:
- `moderation.enabled`
- `moderation.actions.immediate` (e.g. kick/timeout/channel_lock)
- `moderation.actions.vote_required` (e.g. ban)
- `moderation.vote_policy` (`threshold`, `quorum`, `window_seconds`)
- `moderation.evidence_policy` (`report_bundle_required`, `plaintext_disclosure_optional`)

### E2EE moderation behavior
- Backends must not assume moderators can decrypt all historical content.
- Report flows should support ciphertext references and optional user-disclosed plaintext evidence.
- Moderation enforcement (`kick`/`ban`) should emit server and channel membership updates for client state invalidation.

### Endpoint expectations
- Case create/read/list endpoints.
- Vote create/read endpoints for vote-gated actions.
- Enforcement endpoints for immediate safety actions and finalized vote actions.
- Audit/event feed exposing moderation case and action lifecycle metadata.

## 16) Open Questions
- Should default `user_uid` mode be global or server-scoped pseudonymous projection?
- Standard schema package location for shared contracts across repositories.
- Minimum supported API version policy for the first stable release.
