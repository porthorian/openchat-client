# Feature: Channel List and Navigation

- Status: Implemented (M2 baseline)
- Owners: Maintainers
- Last Updated: 2026-02-17
- Related ADRs: `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`
- Related Issues: TBD

## Problem Statement
Users need fast, predictable navigation across channel structures while preserving context per server.

## User Stories
- As a user, I want to browse channels by section so that I can find conversations quickly.
- As a user, I want unread indicators so that I can prioritize attention.
- As a user, I want fast click-based channel switching with clear active state.

## Scope
### In Scope
- Channel tree rendering with sections/categories.
- Active channel selection and persisted per-server context.
- Unread badges in channel list.
- Search/filter within channel list (basic text filter).
- Voice channel list rows with active-channel state and participant badges.

### Out of Scope
- Channel creation/edit moderation interfaces.
- Advanced search across message bodies.
- Forum/thread-specific navigation patterns.

## UX Flow
1. User selects a server.
2. Client loads channel tree for that server.
3. User navigates via click.
4. Active channel updates timeline pane.
5. Unread indicators update in real time.

## UI States
- Loading: channel tree retrieval.
- Empty: server has no channels or no accessible channels.
- Success: channel tree and active selection displayed.
- Error: channel list fetch failure or permission denial.
- Degraded/Offline: stale channel tree shown with offline indicator.

## Backend Capability Assumptions
- `GET /v1/servers/{server_id}/channels` returns channel groups and channels.
- Realtime events provide message activity used for unread increments.

## Client Data Model and State Impact
- Stores touched: `useChatStore`, `useServerRegistryStore`, `useAppUiStore`.
- Caches affected: channel groups per `server_id` and per-channel unread counts.
- Persistence requirements: persist last active channel per server (non-sensitive).

## Security and Privacy Considerations
- Respect server permissions and hide inaccessible channels.
- Never leak channel metadata across server contexts.
- Handle permission errors without revealing restricted channel names.

## Accessibility Requirements
- Focus-visible indicators for active and focused channel rows.
- ARIA semantics for tree/list roles and expandable groups.

## Telemetry and Observability
- Events:
  - channel navigation telemetry is not wired yet in the current baseline.
- Error logging:
  - channel fetch and permission errors with server context

## Testing Strategy
- Unit: channel tree normalization and selection logic.
- Component: channel row states, collapsed groups, and filter behavior.
- Integration: channel load and active selection persistence.
- End-to-end: switch servers, switch channels, unread badge updates.
- Manual QA: rapid server switching and focus behavior consistency.

## Rollout Plan
- Milestone target: M2.
- Guardrails: fallback to last known channel tree on transient fetch errors.
- Success metrics:
  - channel switch latency
  - navigation error frequency
  - unread indicator correctness during realtime updates

## Open Questions
- Do we need pinning/favoriting in MVP channel navigation?
- Should collapsed category state persist per server?
