# Feature: Message Timeline and Composer

- Status: Implemented (M2 baseline)
- Owners: Maintainers
- Last Updated: 2026-02-17
- Related ADRs: `docs/architecture/adrs/0001-electron-vue-primevue-unstyled.md`, `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0005-user-owned-identity.md`
- Related Issues: TBD

## Problem Statement
Users need a performant, readable message timeline and a reliable composer to participate in real-time conversations.

## User Stories
- As a user, I want to read recent messages for the active channel.
- As a user, I want to compose and send messages quickly with predictable feedback.
- As a user, I want clear send failure feedback.

## Scope
### In Scope
- Message timeline rendering for loaded channel history.
- Latest-window message fetch (`limit` query) per channel.
- Composer input with send button and Enter-to-send behavior.
- Realtime message append and typing indicators.
- Basic send-state feedback (`isSendingMessage` disable state).

### Out of Scope
- Timeline virtualization and infinite scroll pagination.
- Optimistic message insertion and retry queue.
- Attachment upload and inline embed rendering.
- Full rich-text editor.
- Voice/video inline controls.
- Complex moderation actions and pinboards.

## UX Flow
1. User enters channel.
2. Client loads latest message window.
3. User composes and submits a message.
4. Client posts message and appends server-confirmed payload to timeline.
5. Realtime events append remote messages and update typing indicator state.

## UI States
- Loading: initial timeline window.
- Empty: no messages in channel.
- Success: timeline and composer active.
- Error: timeline fetch failure or send failure.
- Degraded/Offline: cached messages with reconnecting realtime status.

## Backend Capability Assumptions
- Message list endpoint returning recent messages with `limit` support.
- Send message endpoint returning stable message id and timestamps.
- Realtime event stream for new messages plus presence/typing updates.
- Current client implementation consumes create events only for timeline append.
- Message author identity represented by `author_uid`/`user_uid` without requiring profile PII.

## Client Data Model and State Impact
- Stores touched: `useChatStore`, `useAppUiStore`, `useIdentityStore`, `useSessionStore`.
- Caches affected:
  - bounded timeline windows per channel and `server_id`
  - typing membership per channel
- Persistence requirements:
  - avoid long-term persistence of sensitive message content by default
  - message state remains in-memory only

## Security and Privacy Considerations
- Sanitize message content rendering to prevent injection.
- Enforce server-scoped message isolation.
- Redact sensitive values from error logs.
- Respect channel permission constraints before send.
- Avoid transmitting local user profile fields with message payloads.

## Accessibility Requirements
- Proper reading order and semantic grouping in timeline.
- Composer controls accessible by keyboard and screen readers.
- Error states announced to assistive technologies.

## Telemetry and Observability
- Events:
  - timeline/composer telemetry is not wired yet in the current baseline.
- Metrics:
  - send ack latency
  - duplicate event suppression rate

## Testing Strategy
- Unit: message normalization, dedupe logic, typing membership transitions.
- Component: timeline rendering states and composer interactions.
- Integration: realtime events + send flow + profile resolution fallback.
- End-to-end: send flow, channel switching, reconnect and sync correctness.
- Manual QA: long timeline performance and rapid channel switching.

## Rollout Plan
- Milestone target: M2.
- Guardrails:
  - no optimistic insertion until retry/reconciliation semantics are defined
  - prevent duplicate append on realtime + post response convergence
- Success metrics:
  - message send success rate
  - timeline render performance
  - user-visible send failure rate

## Open Questions
- Should failed sends persist as drafts automatically?
- Should pagination be added before introducing timeline virtualization?
- Should attachment rendering land with capability-gated upload controls or as a separate milestone?
