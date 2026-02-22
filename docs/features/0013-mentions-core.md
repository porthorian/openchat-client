# 0013 - Mentions Core

## Status
- Draft

## Problem Statement
- OpenChat needs first-class mentions so users can direct attention in busy channels.
- Mention state must remain server-scoped and privacy-preserving in a multi-server client.
- Mention badges must clear based on authoritative read acknowledgements, not just local view state.

## User Stories and UX Flows
- As a user, I can type `@` in the composer and select a person to mention.
- As a user, I can use special channel mentions such as `@channel`, `@here`, and other server-supported audience mentions.
- As a user, when I am mentioned, I see unread mention indicators in the channel list and server rail.
- As a user, mention indicators clear when a read acknowledgment confirms I have read past the mentioned message.

## Scope
- In scope:
  - User mentions.
  - Channel/audience mentions (`@channel`, `@here`, and server-capability-supported variants).
  - Mention rendering in timeline and composer insertion.
  - Mention counters per channel and per server.
  - Mention counter clearing on read acknowledgment.
- Out of scope:
  - Mention inbox/search surfaces.
  - Role hierarchy editing.
  - Cross-server/global mention routing.

## API and Capability Assumptions
- `mentions.user`: backend supports user mention entities.
- `mentions.channel`: backend supports special channel/audience mentions.
- `mentions.resolve`: backend supports mention autocomplete resolution.
- `mentions.notifications`: backend emits mention-qualified notification signals.
- `read_acks.channel`: backend emits or accepts per-channel read acknowledgments.

## Mention and Read Ack Contract (Client View)
- Message mention entity fields:
  - `type`: `user` | `channel`
  - `token`: raw token string (example: `@here`)
  - `target_id`: stable server-scoped identifier when applicable
  - `display_text`
  - `range`: UTF-16 start/end offsets for render mapping
  - `server_id`
- Read ack fields:
  - `server_id`
  - `channel_id`
  - `last_read_message_id` or `last_read_cursor`
  - `acked_at`

## Read Ack Clearing Rules
- Mention counters clear only when read ack advances past mentioned message positions.
- Local UI may show a temporary "pending clear" state while ack is in flight, but durable counter state remains ack-driven.
- Ack cursors are monotonic per channel; stale/older ack events must be ignored.
- On reconnect, client recomputes mention counters using latest ack cursor plus cached timeline window.

## UI States
- Loading:
  - Composer mention suggestions show loading state while resolving.
- Empty:
  - No matches state in mention picker.
- Error:
  - Suggestion fetch failure falls back to plain text entry with non-blocking error toast.
- Degraded:
  - If mention capabilities are missing, render raw `@text` without entity linking and suppress mention counters.

## Data Model and State Impact
- `useMessageStore`:
  - Store mention entities with message payloads under `server_id` and `channel_id`.
- `useChannelStore`:
  - Maintain unread mention counters per channel.
  - Track per-channel read ack cursor for clearing logic.
- `useServerRegistryStore`:
  - Aggregate channel-level mention counts into server rail badges.
- Notification service:
  - Trigger in-app/desktop mention notifications gated by focused channel and user preferences.

## Security and Privacy Considerations
- Mention resolution requests must include only protocol-required identifiers.
- Do not send local profile attributes during mention lookup unless future ADR explicitly allows it.
- Keep all mention cache and counters server-scoped to prevent cross-server leakage.
- Respect trust state warnings for unverified servers before enabling rich mention capabilities.

## Accessibility Requirements
- Mention suggestions are keyboard navigable with clear active option semantics.
- Mention highlights in timeline meet contrast targets and do not rely on color alone.
- Screen readers announce mention type and display text consistently.
- Counter badges include accessible labels (example: "3 unread mentions").

## Test Strategy
- Unit tests:
  - Mention entity parse/store behavior.
  - Counter increment/decrement and read-ack monotonicity rules.
- Integration tests:
  - Composer autocomplete and insertion flow for user and channel mentions.
  - Read ack event processing clears counters correctly.
- E2E smoke tests:
  - Send mention, receive mention badge, issue read ack, verify badge clears.
  - Reconnect scenario with stale ack and latest ack reconciliation.

## Rollout Plan and Success Criteria
- Phase 1:
  - User mentions + read-ack-based counter clearing.
- Phase 2:
  - Channel/audience mentions (`@channel`, `@here`, capability-based variants).
- Success criteria:
  - Mention counters match server read state with no persistent false positives after ack.
  - No cross-server mention state contamination.
  - Keyboard-only mention compose flow is fully functional.

