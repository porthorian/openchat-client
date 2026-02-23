# 0013 - Mentions Core

## Status
- Implemented baseline (M3 hardening in progress)

## Problem Statement
- OpenChat needs first-class mentions so users can direct attention in busy channels.
- Mention state must remain server-scoped and privacy-preserving in a multi-server client.
- Mention badges must clear based on authoritative read acknowledgements, not just local view state.

## User Stories and UX Flows
- As a user, I can type `@` in the composer and select a person to mention.
- As a user, I can use special channel mentions such as `@channel` and `@here`.
- As a user, when I am mentioned, I see unread mention indicators in the channel list and server rail.
- As a user, mention indicators clear when a read acknowledgment confirms I have read past the mentioned message.

## Scope
- In scope:
  - User mentions.
  - Channel/audience mentions (`@channel`, `@here`).
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
- Current client behavior when capability data is incomplete:
  - mention autocomplete gracefully falls back to plain text entry when resolve fails.
  - mention unread counters still compute from message metadata + read-ack state.

## Mention and Read Ack Contract (Client View)
- Message mention entity fields:
  - `type`: `user` | `channel`
  - `token`: raw token string (example: `@here`)
  - `target_id`: stable server-scoped identifier when applicable
  - `display_text`
  - `range`: UTF-16 start/end offsets for render mapping
- Read ack fields:
  - `channel_id`
  - `user_uid`
  - `last_read_message_id`
  - `acked_at`
  - `cursor_index`
  - optional `applied` on PUT response

## Read Ack Clearing Rules
- Mention counters clear only when read ack advances past mentioned message positions.
- Client applies an optimistic local read cursor update, then reconciles with server response/event state.
- Ack cursors are monotonic per channel; stale/older ack events must be ignored.
- On reconnect, client recomputes mention counters using latest ack cursor plus cached timeline window.

## UI States
- Loading:
  - Composer suggestions resolve asynchronously; baseline UI has no explicit loading spinner.
- Empty:
  - No matches state in mention picker.
- Error:
  - Suggestion fetch failure falls back to plain text entry without blocking send.
- Degraded:
  - If mention metadata is absent, user mention detection falls back to text heuristics for the active UID.

## Data Model and State Impact
- `useChatStore`:
  - stores message mention entities in `messagesByChannel`.
  - tracks per-channel read-ack state in `readAckByChannel`.
  - tracks unread mention counters in `mentionUnreadByChannel`.
  - aggregates per-server mention counts through getters consumed by workspace shell.
- `ChatComposer`:
  - resolves mention candidates via `/mentions:resolve`.
  - inserts selected mention tokens into draft text.
- `ChatMessageRow`:
  - renders mention tokens as mention pills.
  - highlights rows that mention the current user.

## Security and Privacy Considerations
- Mention resolution requests must include only protocol-required identifiers.
- Do not send local profile attributes during mention lookup unless future ADR explicitly allows it.
- Keep all mention cache and counters server-scoped to prevent cross-server leakage.
- Respect trust state warnings for unverified servers before enabling rich mention capabilities.

## Accessibility Requirements
- Mention suggestions are keyboard navigable with clear active option semantics.
- Mention highlights in timeline meet contrast targets and do not rely on color alone.
- Mention tokens render as plain text labels so screen readers can read the mention text.
- Dedicated mention-badge aria labeling is a hardening follow-up item.

## Test Strategy
- Unit tests:
  - Mention parse/store behavior.
  - Counter recomputation and read-ack monotonicity rules.
- Integration tests:
  - Composer autocomplete and insertion flow for user and channel mentions.
  - Read ack event processing clears counters correctly.
- E2E smoke tests:
  - Send mention, receive mention badge, issue read ack, verify badge clears.
  - Reconnect scenario with stale ack and latest ack reconciliation.
- Current gap:
  - dedicated automated mention tests are still pending; current validation is manual QA plus type/build checks.

## Rollout Plan and Success Criteria
- Phase 1:
  - User mentions + read-ack-based counter clearing. (Implemented)
- Phase 2:
  - Channel/audience mentions (`@channel`, `@here`). (Implemented)
- Hardening follow-up:
  - capability-driven audience token handling beyond `@here`/`@channel`.
  - explicit mention resolve loading/error UI polish.
  - dedicated automated test coverage.
- Success criteria:
  - Mention counters match server read state with no persistent false positives after ack.
  - No cross-server mention state contamination.
  - Keyboard-only mention compose flow is fully functional.
