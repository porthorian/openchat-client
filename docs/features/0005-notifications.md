# Feature: Notifications

- Status: Implemented (M2 baseline)
- Owners: Maintainers
- Last Updated: 2026-02-22
- Related ADRs: `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`
- Related Issues: TBD

## Problem Statement
Users need timely, controllable notifications for mentions and relevant activity without noise or cross-server confusion.

## User Stories
- As a user, I want desktop alerts for mentions so that I do not miss direct activity.
- As a user, I want per-server notification controls so that I can reduce noise.
- As a user, I want unread indicators to stay accurate across server and channel switches.

## Scope
### In Scope
- Desktop notification delivery for incoming messages when relevant.
- Mention-sensitive behavior (direct user mentions plus `@here`/`@channel` audience mentions).
- Per-server mute toggle from server context menu.
- Unread badge updates across server rail and channel list.

### Out of Scope
- In-app notification center/toast history.
- Per-channel notification overrides and quiet hours.
- Mobile push notification infrastructure.
- Notification digests by email.
- Complex moderation broadcast channels.

## UX Flow
1. User optionally mutes a server from server context menu.
2. Incoming realtime events are filtered by mute state, mention detection, channel activity, and window visibility.
3. Client shows desktop notification when conditions are met (mention-class messages can notify even when active channel is focused).
4. Clicking notification focuses the app window.

## UI States
- Loading: muted-server preferences hydrate from local storage.
- Empty: no notification shown for current event.
- Success: desktop notification delivered.
- Error: permission denied or delivery failure.
- Degraded/Offline: unread indicators continue locally; notification delivery depends on browser permission/runtime support.

## Backend Capability Assumptions
- Realtime events include mention/unread-relevant metadata.
- Event envelopes include target server/channel/message identifiers.
- Actor identity in events is represented as `user_uid`/`author_uid`.
- Optional backend ack endpoint for read/unread synchronization.

## Client Data Model and State Impact
- Stores touched: `useChatStore`, `useServerRegistryStore`, `useAppUiStore`.
- Caches affected: unread counters by channel/server and muted server map.
- Persistence requirements: persist muted server IDs only.

## Security and Privacy Considerations
- Notification previews should respect privacy settings.
- Do not reveal sensitive content in desktop notifications by default.
- Ensure notification routing never crosses server boundaries.
- Do not require personal profile payloads from backend for notification rendering.

## Accessibility Requirements
- Desktop notification text remains plain-text readable by assistive technologies.
- Server mute control is available in server context menu; keyboard-first invocation hardening is still in progress.
- Configurable sound/visual cues remain a follow-up for dedicated settings shell work.

## Telemetry and Observability
- Events:
  - telemetry events are not wired yet for notifications in the current baseline.
- Metrics:
  - unread count accuracy
  - notification permission grant/deny rates (manual QA today)
  - duplicate notification rate on reconnect/replay paths (manual QA today)

## Testing Strategy
- Unit: mute/mention filtering logic.
- Component: server mute action behavior and unread rendering.
- Integration: realtime event to notification pipeline.
- End-to-end: mention triggers desktop notification and unread behavior.
- Manual QA: OS permission states and privacy-mode behaviors.

## Rollout Plan
- Milestone target: M2.
- Guardrails:
  - safe defaults avoid noisy notifications while channel is active and window focused
  - automatic downgrade when desktop notification permission is denied
- Success metrics:
  - mention delivery reliability
  - reduced false-positive notifications

## Open Questions
- Should default mention behavior differ by server trust level?
- Should quiet hours be a post-MVP setting?
