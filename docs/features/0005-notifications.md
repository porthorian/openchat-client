# Feature: Notifications

- Status: Implemented (M2 baseline)
- Owners: Maintainers
- Last Updated: 2026-02-13
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
- Desktop notification delivery for direct mentions and configured events.
- In-app notification center/toast patterns.
- Per-server and per-channel notification preferences.
- Unread and mention badge updates across server rail and channel list.

### Out of Scope
- Mobile push notification infrastructure.
- Notification digests by email.
- Complex moderation broadcast channels.

## UX Flow
1. User configures notification preferences.
2. Incoming events are filtered by preference and context.
3. Client shows desktop and/or in-app notification.
4. Clicking notification routes user to target server/channel/message context.

## UI States
- Loading: preference fetch or sync.
- Empty: no pending notifications.
- Success: notifications delivered and tracked.
- Error: permission denied or delivery failure.
- Degraded/Offline: local unread indicators continue, remote sync delayed.

## Backend Capability Assumptions
- Realtime events include mention/unread-relevant metadata.
- Event envelopes include target server/channel/message identifiers.
- Actor identity in events is represented as `user_uid`/`author_uid`.
- Optional backend ack endpoint for read/unread synchronization.

## Client Data Model and State Impact
- Stores touched: `usePresenceStore`, `useChannelStore`, `useServerRegistryStore`, `useSettingsStore`, `useAppUiStore`.
- Caches affected: unread counters and notification queue by `server_id`.
- Persistence requirements: persist notification preferences only.

## Security and Privacy Considerations
- Notification previews should respect privacy settings.
- Do not reveal sensitive content in desktop notifications by default.
- Ensure notification routing never crosses server boundaries.
- Do not require personal profile payloads from backend for notification rendering.

## Accessibility Requirements
- In-app notification center keyboard navigable.
- Screen-reader friendly notification text and action controls.
- Configurable sound/visual cues where possible.

## Telemetry and Observability
- Events:
  - `notification_received`
  - `notification_shown_desktop`
  - `notification_clicked`
  - `notification_delivery_failed`
- Metrics:
  - notification click-through rate
  - missed mention rate
  - delivery failure rate by platform

## Testing Strategy
- Unit: preference filtering and routing logic.
- Component: notification UI and preference controls.
- Integration: realtime event to notification pipeline.
- End-to-end: mention triggers notification and deep-link navigation.
- Manual QA: OS permission states and privacy-mode behaviors.

## Rollout Plan
- Milestone target: M2.
- Guardrails:
  - safe defaults favor lower notification noise
  - automatic downgrade when desktop notification permission is denied
- Success metrics:
  - mention delivery reliability
  - reduced false-positive notifications

## Open Questions
- Should default mention behavior differ by server trust level?
- Should quiet hours be a post-MVP setting?
