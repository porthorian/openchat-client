# Server Action Menus TODO

This TODO tracks the remaining work to make server action menus functional.

## Scope

- Channel pane header dropdown (server display name click menu).
- Server rail right-click context menu.
- Excludes `Server Boost` and `App Directory`.

## Action Items

- [ ] `Invite to Server`
  - Build invite creation modal.
  - Add server API contract for invite create/list/revoke.
  - Add permission checks and error states (no permission, expired invite, max invites).

- [ ] `Server Settings`
  - Define server settings route and navigation pattern.
  - Build sections for overview, moderation, roles, channels, integrations.
  - Wire save/cancel state with optimistic UI and rollback on failure.

- [ ] `Create Channel`
  - Create modal for name, type, category, and permission overrides.
  - Add channel create API call and validation.
  - Refresh channel tree and preserve current selection when possible.

- [ ] `Create Category`
  - Create modal for category metadata and ordering.
  - Add category create API call and sorting behavior.
  - Refresh channel tree without reconnecting websocket/session state.

- [ ] `Create Event`
  - Create event form (title, schedule, channel scope, visibility).
  - Add event create/list API integration.
  - Add calendar/event list UI surface and notification hooks.

- [x] `Mute/Unmute Server` quick action
  - Context menu action is wired through `ServerRail` -> `useWorkspaceShell` -> `useChatStore.toggleServerMuted`.
  - Mute preference persists in local storage (`openchat.chat-notification-prefs.v1`).
  - Remaining follow-up is richer notification policy controls (see item below).

- [ ] `Notification Settings`
  - Add per-server notification policy model in settings store.
  - Support policies: all messages, mentions only, muted.
  - Sync with desktop notification pipeline and mute/unmute context actions.

- [ ] `Privacy Settings`
  - Define per-server privacy controls (profile visibility, read receipts, presence detail).
  - Add API contract for server-scoped privacy preferences if server-managed.
  - Persist local-only toggles when backend capability is unavailable.

- [ ] `Edit Per-server Profile`
  - Build per-server profile editor (display name and avatar override).
  - Extend profile sync contract for server-scoped overrides.
  - Ensure message list, member list, voice roster, and presence all resolve override values.

- [ ] `Hide Muted Channels`
  - Add server-scoped preference in client settings store.
  - Filter muted channels in channel pane while preserving deep-link navigation.
  - Keep hidden channels visible in server settings for management.

- [x] `Leave Server`
  - Context menu action is wired and calls backend membership leave.
  - Client clears realtime/call/session/chat state and safely falls back to another server.
  - Remaining follow-up: explicit confirm UX before leave.

## Shared Engineering Tasks

- [ ] Centralize menu action definitions so both menus call the same handlers.
- [ ] Add telemetry hooks (optional/opt-in) for menu action usage.
- [ ] Add unit tests for action dispatch and store updates.
- [ ] Add component tests for menu keyboard support and click-outside behavior.
- [ ] Add integration tests for create channel/category flows.
