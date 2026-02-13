# Feature: Message Timeline and Composer

- Status: Implemented (M2 baseline)
- Owners: Maintainers
- Last Updated: 2026-02-13
- Related ADRs: `docs/architecture/adrs/0001-electron-vue-primevue-unstyled.md`, `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0005-user-owned-identity.md`
- Related Issues: TBD

## Problem Statement
Users need a performant, readable message timeline and a reliable composer to participate in real-time conversations.

## User Stories
- As a user, I want to read recent messages and load older history as I scroll.
- As a user, I want to compose and send messages quickly with predictable feedback.
- As a user, I want clear send failure and retry behavior.

## Scope
### In Scope
- Message timeline rendering with virtualized scrolling.
- Cursor-based history pagination (infinite history loading pattern).
- Message composer with markdown-lite formatting and mentions.
- Optimistic send state with ack/failure transitions.
- Basic attachment list display in timeline (metadata rendering).

### Out of Scope
- Full rich-text editor.
- Voice/video inline controls.
- Complex moderation actions and pinboards.

## UX Flow
1. User enters channel.
2. Client loads latest message window.
3. User scrolls up to fetch older messages.
4. User composes and submits a message.
5. Message appears optimistically, then confirms or fails with retry option.

## UI States
- Loading: initial timeline window.
- Empty: no messages in channel.
- Success: timeline and composer active.
- Error: timeline fetch failure or send failure.
- Degraded/Offline: cached messages with disabled or queued send controls.

## Backend Capability Assumptions
- Message list endpoint with cursor pagination.
- Send message endpoint returning stable message id and timestamps.
- Realtime event stream for new, edited, and deleted messages.
- Optional upload capability metadata for attachments.
- Message author identity represented by `author_uid`/`user_uid` without requiring profile PII.

## Client Data Model and State Impact
- Stores touched: `useMessageStore`, `useChannelStore`, `usePresenceStore`, `useAppUiStore`.
- Caches affected:
  - bounded timeline windows per channel and `server_id`
  - pending send queue for optimistic messages
- Persistence requirements:
  - avoid long-term persistence of sensitive message content by default
  - cache TTL and size bounds enforced

## Security and Privacy Considerations
- Sanitize message content rendering to prevent injection.
- Enforce server-scoped message isolation.
- Redact sensitive values from error logs.
- Respect channel permission constraints before send.
- Avoid transmitting local user profile fields with message payloads.

## Accessibility Requirements
- Proper reading order and semantic grouping in timeline.
- Composer controls accessible by keyboard and screen readers.
- Error and retry states announced to assistive technologies.

## Telemetry and Observability
- Events:
  - `timeline_loaded`
  - `history_page_loaded`
  - `message_send_attempted`
  - `message_send_succeeded`
  - `message_send_failed`
- Metrics:
  - send ack latency
  - pagination latency
  - duplicate event suppression rate

## Testing Strategy
- Unit: pagination cursors, optimistic state transitions, dedupe logic.
- Component: timeline rendering states and composer interactions.
- Integration: realtime events + optimistic send reconciliation.
- End-to-end: send/retry flow, pagination, reconnect and sync correctness.
- Manual QA: long timeline performance and rapid channel switching.

## Rollout Plan
- Milestone target: M2.
- Guardrails:
  - fallback to non-virtualized mode for debugging builds only
  - safe retry/backoff for failed sends
- Success metrics:
  - message send success rate
  - timeline render performance
  - user-visible send failure rate

## Open Questions
- Should failed sends persist as drafts automatically?
- What is the initial max page size per timeline fetch?
- How should display names/avatars for other UIDs be resolved without server profile storage?
