# Feature: Channel List and Navigation

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-09
- Related ADRs: `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`
- Related Issues: TBD

## Problem Statement
Users need fast, predictable navigation across channel structures while preserving context per server.

## User Stories
- As a user, I want to browse channels by section so that I can find conversations quickly.
- As a user, I want unread and mention indicators so that I can prioritize attention.
- As a user, I want keyboard shortcuts for channel navigation so that I can move efficiently.

## Scope
### In Scope
- Channel tree rendering with sections/categories.
- Active channel selection and persisted per-server context.
- Unread and mention badges in channel list.
- Keyboard navigation for channel focus and selection.
- Search/filter within channel list (basic text filter).

### Out of Scope
- Channel creation/edit moderation interfaces.
- Advanced search across message bodies.
- Forum/thread-specific navigation patterns.

## UX Flow
1. User selects a server.
2. Client loads channel tree for that server.
3. User navigates via click or keyboard.
4. Active channel updates timeline pane.
5. Unread indicators update in real time.

## UI States
- Loading: channel tree retrieval.
- Empty: server has no channels or no accessible channels.
- Success: channel tree and active selection displayed.
- Error: channel list fetch failure or permission denial.
- Degraded/Offline: stale channel tree shown with offline indicator.

## Backend Capability Assumptions
- Endpoint or stream available for channel list.
- Channel payload includes ids, hierarchy metadata, permissions, unread stats.
- Update events for channel changes and unread counters.

## Client Data Model and State Impact
- Stores touched: `useChannelStore`, `useServerRegistryStore`, `useAppUiStore`.
- Caches affected: channel tree cache per `server_id`.
- Persistence requirements: persist last active channel per server (non-sensitive).

## Security and Privacy Considerations
- Respect server permissions and hide inaccessible channels.
- Never leak channel metadata across server contexts.
- Handle permission errors without revealing restricted channel names.

## Accessibility Requirements
- Arrow key navigation within tree/list structures.
- Focus-visible indicators for active and focused channel rows.
- ARIA semantics for tree/list roles and expandable groups.

## Telemetry and Observability
- Events:
  - `channel_list_loaded`
  - `channel_selected`
  - `channel_navigation_keyboard_used`
- Error logging:
  - channel fetch and permission errors with server context

## Testing Strategy
- Unit: channel tree normalization and selection logic.
- Component: channel row states and keyboard behaviors.
- Integration: channel load and active selection persistence.
- End-to-end: switch servers, switch channels, unread badge updates.
- Manual QA: rapid server switching and focus behavior consistency.

## Rollout Plan
- Milestone target: M2.
- Guardrails: fallback to last known channel tree on transient fetch errors.
- Success metrics:
  - channel switch latency
  - navigation error frequency
  - keyboard navigation adoption

## Open Questions
- Do we need pinning/favoriting in MVP channel navigation?
- Should collapsed category state persist per server?
