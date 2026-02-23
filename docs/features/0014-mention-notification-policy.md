# Feature: Mention Notification Policy

- Status: Implemented baseline (M3 hardening in progress)
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
- Notification policy for mention-bearing events (desktop notifications in baseline implementation).
- Mention-type handling for `user`, `@here`, and `@channel`.
- Suppression rules based on mute state, focus/active channel context, and runtime notification permission.
- Read-ack-driven clearing alignment with mention badge lifecycle.

### Out of Scope
- Notification inbox/history UI.
- Email/mobile push channels.
- ML-based notification ranking.
- Moderation broadcast policy authoring.
- Deterministic cross-reconnect notification dedupe cache.
- Capability-driven audience tokens beyond currently supported `@here`/`@channel`.

## UX Flow
1. `chat.message.created` realtime event arrives with message mention metadata.
2. Client classifies message as mention-relevant when it directly mentions current user or includes `@here`/`@channel`.
3. Client evaluates suppression rules (`own message`, muted server, focused active channel for non-mentions).
4. Client delivers desktop notification when allowed.
5. Mention badges update from mention state pipeline.
6. Read acknowledgment advancement clears eligible mention badge state.

## Policy Rules
- User mention (`type=user`) is mention-relevant and not suppressed by active-channel focus.
- Channel/audience mentions (`@here`, `@channel`) are mention-relevant and not suppressed by active-channel focus.
- If app window is focused on the same channel/message context, non-mention message alerts are suppressed.
- Unknown mention token or malformed metadata should be treated as non-notifying text.
- Current baseline does not maintain a durable dedupe cache for notification replay.

## UI States
- Loading: notification settings and mute policy hydration.
- Empty: mention event processed with no notification delivery.
- Success: mention notification delivered.
- Error: notification permission denied or delivery failure.
- Degraded/Offline: mention counters continue from cached/replayed state with reduced delivery guarantees.

## Backend Capability Assumptions
- Message payload includes mention entities with stable fields (`type`, `token`, `target_id`, optional `range`).
- Realtime payloads include:
  - `chat.message.created` for new message events
  - `chat.read_ack.updated` for authoritative read-ack updates
- Capability discovery may declare mention/read-ack semantics:
  - `mentions.notifications`
  - `mentions.channel`
  - `read_acks.channel`
- Backend read-ack model is monotonic per channel.

## Client Data Model and State Impact
- Services/stores touched:
  - `useChatStore` mention counters (`mentionUnreadByChannel`)
  - `useChatStore` read-ack cursors (`readAckByChannel`)
  - `useChatStore` per-server mute preferences (`serverMutedById`)
- Clearing behavior:
  - mention counters recompute when read ack passes target message cursor.
  - pending-notification records are not separately tracked in baseline.

## Security and Privacy Considerations
- Notification preview content must honor privacy preferences and trust posture.
- Mention notification processing must remain server-scoped to prevent cross-server leakage.
- No additional profile attributes should be transmitted for notification decisions.
- Logs/telemetry should include reason codes, not sensitive message bodies by default.

## Accessibility Requirements
- Mention notification text should provide clear context when read by assistive technologies.
- Visual indicators should not rely on color alone for mention urgency.
- Keyboard-first invocation for all notification/mute controls remains a hardening target.

## Telemetry and Observability
- Current baseline:
  - mention notification telemetry is not yet wired.
- Future hardening target:
  - capture policy evaluation/delivery/suppression metrics without message body content.

## Testing Strategy
- Unit: policy decision matrix and suppression rules.
- Component: notification settings toggles and mention-specific rendering.
- Integration: realtime mention event -> policy evaluation -> notification delivery/suppression.
- End-to-end:
  - user mention delivers notification and badge
  - audience mention follows mute/focus rules
  - read ack clears mention badge state
- Current gap:
  - dedicated automated coverage for mention-notification replay scenarios is pending.
- Manual QA: OS notification permission states and privacy preview behavior.

## Rollout Plan
- Baseline delivery status:
  - mention notification policy is active in `useChatStore.notifyIncomingMessage`.
  - mention badge clear behavior is tied to read-ack state.
- Hardening backlog:
  - dedupe strategy for replay/reconnect notification events.
  - capability-driven audience token policy beyond `@here`/`@channel`.
  - per-channel mention preference controls.
- Success metrics:
  - mention notification delivery accuracy
  - suppression false-positive/false-negative rates
  - duplicate notification rate after reconnect

## Open Questions
- Should `@here` and `@channel` have separate default behaviors in user settings?
- Should unverified server trust state automatically reduce notification preview detail?
- Should audience mention notifications be rate-limited during high-volume bursts?
- Should mention notifications remain unsuppressed when the channel is active and focused, or become configurable?
