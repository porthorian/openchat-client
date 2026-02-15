# Feature: AT Protocol Message Sync and Reconciliation

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-15
- Related ADRs: `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`, `docs/architecture/adrs/0007-at-protocol-hybrid-integration.md`
- Related Issues: TBD

## Problem Statement
AT-enabled servers need reliable message interoperability while preserving OpenChat's low-latency UX. The client requires clear sync semantics when backend bridge writes or ingests AT records asynchronously.

## User Stories
- As a user, I want sent messages to appear immediately even when federation sync is delayed.
- As a user, I want clear indicators when message sync is pending, confirmed, or failed.
- As a user, I want timelines to remain stable if duplicate or replayed events occur.
- As a maintainer, I want deterministic reconciliation rules so state remains consistent across reconnects.

## Scope
### In Scope
- Sync state model for outbound message writes through backend bridge.
- Reconciliation of optimistic local messages with canonical message records.
- Handling inbound AT-backed events from backend realtime streams.
- Duplicate suppression and idempotent event application.
- Degraded behavior when AT ingest/write capabilities are partially unavailable.

### Out of Scope
- Voice/presence/typing ephemeral sync via AT records.
- Full-text cross-repo search indexing.
- Binary attachment transfer protocol changes.
- Moderation policy authoring workflows.

## UX Flow
1. User sends message; client renders optimistic entry immediately.
2. Backend acknowledges send with server message id and initial sync status.
3. Client updates message state as sync progresses (pending, confirmed, failed).
4. Inbound event stream delivers canonical updates for local and remote messages.
5. Client reconciles by deterministic keys and suppresses duplicates.
6. On permanent sync failure, client surfaces retry/diagnostic affordances.

## UI States
- Loading: channel history sync and reconnect catch-up.
- Empty: no messages in selected channel.
- Success: timeline with synchronized messages and stable ordering.
- Error: send rejected, reconcile conflict not recoverable, or permanent sync failure.
- Degraded/Offline: local send works with delayed AT confirmation or read-only fallback.

## Backend Capability Assumptions
- Capability payload advertises message bridge behaviors (for example: `atproto.features.write_bridge`, `atproto.features.repo_ingest`).
- Send response includes canonical fields for reconciliation:
  - `message_id`
  - `channel_id`
  - `created_at`
  - `sync_state`
  - optional AT references (`at_uri`, `at_cid`) when available
- Timeline and realtime payloads include stable event identifiers and monotonic ordering keys.
- Backend exposes retry and replay-safe semantics for bridge write failures.
- Error model distinguishes transient vs permanent sync errors.

## Client Data Model and State Impact
- Stores touched: `useMessageStore`, `useChannelStore`, `useSessionStore`.
- Caches affected: per-channel message window caches and send queue metadata.
- Persistence requirements:
  - persist bounded local send queue metadata per `server_id`
  - apply TTL to failed-sync diagnostics
  - clear server-scoped volatile sync state on sign-out/server removal

## Security and Privacy Considerations
- Message sync metadata must not expand identity disclosure beyond UID/proof baseline.
- Sync diagnostics should not leak raw credential material or sensitive server internals.
- Replay/duplicate handling should be resilient to malicious or malformed events.
- Trust warnings must appear when AT sync integrity guarantees are degraded.

## Accessibility Requirements
- Sync state indicators require non-color-only affordances and screen-reader labels.
- Retry and error actions must be keyboard accessible in timeline context.
- Live-region announcements should be rate-limited to avoid screen-reader spam during reconnect.

## Telemetry and Observability
- Events to instrument:
  - `message_send_optimistic_created`
  - `message_sync_confirmed`
  - `message_sync_failed`
  - `message_reconcile_duplicate_suppressed`
- Error logging expectations:
  - include `server_id`, `channel_id`, and normalized sync error code
  - include lag/retry metadata without sensitive payload content
- Privacy constraints:
  - avoid raw message content in telemetry/logs by default

## Testing Strategy
- Unit: reconciliation reducer logic, duplicate suppression, and sync state transitions.
- Component: timeline rendering for pending/confirmed/failed states.
- Integration: outbound send + inbound canonical event reconciliation.
- End-to-end: optimistic send, reconnect replay, duplicate event suppression, failure retry.
- Manual QA: degraded mode messaging and user clarity of sync indicators.

## Rollout Plan
- Milestone target: M2 bridge messaging rollout.
- Guardrails and fallback behavior:
  - when bridge sync unavailable, keep local OpenChat message flow functional with explicit status messaging
  - disable AT sync-specific UI if capability probe drops required flags
- Success metrics:
  - optimistic send latency
  - sync confirmation rate
  - duplicate suppression correctness rate
  - permanent sync failure rate

## Open Questions
- Which reconciliation key should be primary when `at_uri` is missing (`message_id`, client nonce, or both)?
- Should failed bridge sync allow manual retry from timeline UI in MVP?
- What maximum acceptable AT sync lag should trigger degraded-state warnings?
