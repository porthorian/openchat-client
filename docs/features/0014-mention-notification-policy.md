# Feature: Mention Notification Policy

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-22
- Related ADRs: `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`
- Related Specs: `docs/features/0005-notifications.md`, `docs/features/0013-mentions-core.md`, `docs/features/0011-atproto-server-capabilities.md`
- Related Issues: TBD

## Problem Statement
Mentions should reliably alert users without creating noisy or inconsistent behavior across servers. The client needs deterministic mention notification policy for user mentions and channel/audience mentions such as `@here` and `@channel`, with clearing behavior tied to read acknowledgments.

## User Stories
- As a user, I want direct mentions of me to notify reliably so I do not miss important messages.
- As a user, I want audience mentions (`@here`, `@channel`) to respect my notification settings and focus state.
- As a user, I want mention notifications and badges to clear when my read acknowledgment advances.
- As a maintainer, I want suppression and deduplication rules that are consistent across reconnects.

## Scope
### In Scope
- Notification policy for mention-bearing events (desktop and in-app toast surfaces where available).
- Mention-type priority handling: `user`, `@here`, `@channel`, and server-declared audience tokens.
- Suppression rules based on mute state, focus/active channel context, and user privacy settings.
- Deduplication and replay-safe behavior for realtime reconnect/retry.
- Read-ack-driven clearing alignment with mention badge lifecycle.

### Out of Scope
- Notification inbox/history UI.
- Email/mobile push channels.
- ML-based notification ranking.
- Moderation broadcast policy authoring.

## UX Flow
1. Realtime event arrives with mention metadata.
2. Client validates mention metadata and maps token/type to policy class.
3. Client evaluates mute/privacy/focus rules and decides `deliver` or `suppress` with reason code.
4. Client delivers desktop/toast notification when allowed and records dedupe key.
5. Mention badges update from mention state pipeline.
6. Read acknowledgment advancement clears eligible mention badges and any pending mention notification state.

## Policy Rules
- User mention (`type=user`) is highest priority and should notify unless globally disabled by explicit user preference.
- Channel/audience mentions (`@here`, `@channel`, server-defined audience tokens) notify by default but are suppressible by mute/privacy/focus policy.
- If app window is focused on the same channel/message context, desktop alerts should be suppressed while badge state remains accurate.
- Unknown mention token or malformed metadata should be treated as non-notifying text.
- Replayed events must not generate duplicate notifications for the same `(server_id, channel_id, message_id, mention_class)`.

## UI States
- Loading: notification settings and mute policy hydration.
- Empty: mention event processed with no notification delivery.
- Success: mention notification delivered.
- Error: notification permission denied or delivery failure.
- Degraded/Offline: mention counters continue from cached/replayed state with reduced delivery guarantees.

## Backend Capability Assumptions
- Mention metadata includes stable identifiers:
  - `server_id`
  - `channel_id`
  - `message_id`
  - `mention_type` and/or audience token
  - target user identifier when mention is user-specific
- Realtime payloads include replay-safe event identifiers.
- Capability discovery declares support for mention and read-ack semantics:
  - `mentions.notifications`
  - `mentions.channel`
  - `read_acks.channel`
- Backend read-ack model is monotonic per channel.

## Client Data Model and State Impact
- Services/stores touched:
  - mention notification policy service
  - `useChannelStore` mention counters
  - `useServerRegistryStore` aggregate mention badge counts
- Dedupe tracking:
  - maintain bounded dedupe cache keyed by `(server_id, channel_id, message_id, mention_class)`.
- Clearing behavior:
  - mention counters and pending mention-notification records clear when read ack passes target message cursor.

## Security and Privacy Considerations
- Notification preview content must honor privacy preferences and trust posture.
- Mention notification processing must remain server-scoped to prevent cross-server leakage.
- No additional profile attributes should be transmitted for notification decisions.
- Logs/telemetry should include reason codes, not sensitive message bodies by default.

## Accessibility Requirements
- Notification controls and mute toggles must be keyboard navigable.
- Mention notification text should provide clear context for screen readers.
- Visual indicators should not rely on color alone for mention urgency.

## Telemetry and Observability
- Events:
  - `mention_notification_evaluated`
  - `mention_notification_delivered`
  - `mention_notification_suppressed`
  - `mention_notification_deduplicated`
- Required dimensions:
  - `server_id`
  - `mention_class`
  - suppression reason code
  - delivery surface (`desktop`, `toast`)
- Privacy constraints:
  - do not include raw message body or sensitive identity artifacts in telemetry payloads.

## Testing Strategy
- Unit: policy decision matrix, suppression rules, and dedupe key behavior.
- Component: notification settings toggles and mention-specific rendering.
- Integration: realtime mention event -> policy evaluation -> notification delivery/suppression.
- End-to-end:
  - user mention delivers notification and badge
  - audience mention follows mute/focus rules
  - read ack clears mention badge state and prevents repeat delivery after reconnect
- Manual QA: OS notification permission states and privacy preview behavior.

## Rollout Plan
- Milestone target: M2 hardening after mentions core merge.
- Guardrails and fallback behavior:
  - when capability metadata is incomplete, default to conservative suppression for ambiguous audience mentions
  - keep badge correctness tied to read-ack state even if delivery surface is unavailable
- Success metrics:
  - mention notification delivery accuracy
  - suppression false-positive/false-negative rates
  - duplicate notification rate after reconnect

## Open Questions
- Should `@here` and `@channel` have separate default behaviors in user settings?
- Should unverified server trust state automatically reduce notification preview detail?
- Should audience mention notifications be rate-limited during high-volume bursts?
