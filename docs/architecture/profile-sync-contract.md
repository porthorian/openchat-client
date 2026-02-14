# Backend Profile Sync Contract (Draft)

This document defines an optional backend contract extension for cross-client profile consistency (display name + avatar). It complements the baseline contract in `docs/architecture/backend-contract.md`.

## 1) Goals
- Ensure all clients render the same user-selected `display_name` and avatar.
- Keep `user_uid` as the canonical identity key.
- Support both uploaded avatars and server-known generated avatar presets.
- Preserve explicit user disclosure and consent before profile data is shared.

## 2) Non-Goals
- Defining backend storage engine details.
- Defining auth provider internals.
- Defining image CDN infrastructure requirements.

## 3) Capability Discovery Additions
Backends that support profile sync should expose a `profile` capability object in `GET /client/capabilities`.

### Required `profile` fields
- `enabled` (boolean)
- `scope` (`global` or `server_scoped`)
- `fields` (must include `display_name`; avatar optional)
- `avatar_modes` (subset of `generated`, `uploaded`)
- `display_name` rules:
- `min_length`
- `max_length`
- `pattern` (optional validation regex identifier)
- `avatar_upload` rules (required when `uploaded` is supported):
- `max_bytes`
- `mime_types` (e.g. `image/png`, `image/jpeg`, `image/webp`)
- `max_width`
- `max_height`
- `realtime_event` (expected value: `profile_updated`)

## 4) Profile Data Model

### Canonical profile object
- `user_uid`
- `display_name`
- `avatar_mode` (`generated` or `uploaded`)
- `avatar_preset_id` (required when `avatar_mode=generated`)
- `avatar_asset_id` (required when `avatar_mode=uploaded`)
- `avatar_url` (optional resolved URL for CDN-backed delivery)
- `profile_version` (monotonic integer for concurrency + cache invalidation)
- `updated_at` (ISO 8601 timestamp)

### Notes
- `user_uid` remains the key used across chat, presence, and RTC.
- `display_name` and avatar are mutable profile attributes.
- `profile_version` must increment for any profile change.

## 5) Required Endpoints

### `GET /v1/profile/me`
- Purpose: fetch caller's current canonical profile.
- Response: canonical profile object.

### `PUT /v1/profile/me`
- Purpose: update caller profile metadata.
- Request body:
- `display_name`
- `avatar_mode`
- `avatar_preset_id` (when generated)
- `avatar_asset_id` (when uploaded)
- Concurrency:
- Clients should send `If-Match: <profile_version>` or equivalent.
- Server should reject stale updates with `409 profile_conflict`.
- Response: updated canonical profile object.

### `POST /v1/profile/avatar`
- Purpose: upload avatar image when `uploaded` mode is supported.
- Request: `multipart/form-data` with `file`.
- Validation: enforce `avatar_upload` capability constraints.
- Response:
- `avatar_asset_id`
- `avatar_url` (optional)
- `width`
- `height`
- `content_type`
- `bytes`

### `GET /v1/profiles:batch?user_uid=<uid>&user_uid=<uid>`
- Purpose: resolve profile data for multiple users in one request.
- Response: list of canonical profile objects.
- Requirement: support at least 100 UIDs per request (or advertise lower limit).

## 6) Realtime Contract

### Event type
- `profile_updated`

### Event payload
- `user_uid`
- `profile_version`
- `display_name`
- `avatar_mode`
- `avatar_preset_id` (if generated)
- `avatar_asset_id` (if uploaded)
- `avatar_url` (optional)
- `updated_at`

### Delivery expectations
- Emit to all connected clients in affected scope (`global` or server-scoped membership).
- Preserve ordering per `user_uid` by `profile_version`.
- Allow idempotent re-application on duplicate delivery.

## 7) Integration Requirements for Existing Domains

### Presence / member list / activity sidebar
- Clients should render latest canonical profile for each `user_uid`.
- Backend should ensure profile cache invalidation via `profile_updated`.

### Voice participant lists
- Participant identity must resolve through canonical profile.
- Avoid fallback display to raw `user_uid` except degraded/failure states.

### Chat timeline
- Backend must advertise one of two modes in capability payload:
- `message_author_profile_mode=live` (name/avatar update historically)
- `message_author_profile_mode=snapshot` (name/avatar frozen at send time)
- Recommended default: `snapshot` for audit and historical consistency.

## 8) Validation Rules
- `display_name` must be normalized (Unicode NFC or NFKC) before persistence.
- Reserved/banned names policy should return deterministic validation errors.
- Avatar uploads must be image-only and bounded by capability limits.
- Server should strip metadata (EXIF) from uploaded avatars before serving.

## 9) Error Model Extensions
- `profile_unsupported`
- `display_name_invalid`
- `display_name_taken` (only if uniqueness policy is enabled)
- `avatar_mode_unsupported`
- `avatar_type_unsupported`
- `avatar_too_large`
- `avatar_dimensions_exceeded`
- `profile_conflict`
- `profile_rate_limited`

Each error should include:
- `code`
- `message`
- `retryable`
- `details` (optional structured metadata)

## 10) Privacy and Security Requirements
- Client must collect explicit consent before first profile sync publish.
- Capability payload must disclose if profile scope is `global` vs `server_scoped`.
- Backends must not require email/phone/legal-name for this contract.
- TLS is required in production.
- Audit logs should reference `user_uid` and change metadata only.

## 11) Suggested Rollout
1. Deploy capabilities with `profile.enabled=false` (dark launch).
2. Deploy read endpoints and batch resolution.
3. Enable write + realtime (`profile_updated`) for test cohorts.
4. Enable client onboarding step for profile publish consent.
5. Move to default-on once conflict/error rates are stable.

## 12) Open Questions
- Should display name uniqueness be global, server-scoped, or disabled by default?
- Should uploaded avatar URLs be signed short-lived URLs or stable public CDN URLs?
- Should profile sync allow per-server override when `scope=global`?
