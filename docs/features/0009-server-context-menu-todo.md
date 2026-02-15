# Server Context Menu TODO

Status: UI scaffold added. Menu actions are currently placeholders only.

## Scope
- Right-click menu on server rail entries.
- Actions shown:
  - `Mark As Read`
  - `Invite to Server`
  - `Unmute Server`
  - `Notification Settings` (submenu target)
  - `Hide Muted Channels`
  - `Server Settings` (submenu target)
  - `Privacy Settings`
  - `Edit Per-server Profile`
  - `Create Event`
  - `Leave Server`

## Action TODOs

### 1) Mark As Read
- Add server-level read/ack action in client store layer (`chat` + `appUi` flow).
- Mark all unread channels in the selected server as read.
- Ensure unread badge in server rail updates immediately (optimistic UI).
- Add backend contract decision:
  - If backend requires explicit read sync, define endpoint/event for bulk mark-read.

### 2) Invite to Server
- Define invite model contract in backend (`invite code`, `expiry`, `max uses`, `permissions`).
- Add invite creation API call and error handling.
- Add invite modal UI (copy link/code, regenerate, revoke).
- Add trust/safety copy for sharing server invite links.

### 3) Unmute Server
- Add per-server notification preference model in `useSettingsStore`:
  - `muted`, `muteUntil`, `mentionsOnly`, `channelOverrides`.
- Wire mute state into desktop/in-app notification delivery logic.
- Toggle label dynamically (`Mute Server` / `Unmute Server`).

### 4) Notification Settings
- Implement submenu with server-level options:
  - `All Messages`, `Only @mentions`, `Nothing`.
- Persist settings locally and apply immediately.
- Add backend-sync strategy only if required by multi-client consistency goals.

### 5) Hide Muted Channels
- Extend channel state to support `isMuted` visibility filtering.
- Add UI setting per server for hidden muted channels.
- Ensure keyboard navigation and channel selection skip hidden muted channels safely.

### 6) Server Settings
- Define settings surface routing/modal architecture.
- Gate sections by role/capabilities from backend.
- Add settings categories:
  - Overview, roles/permissions (if supported), integrations, invites, safety.

### 7) Privacy Settings
- Define server-scoped privacy controls:
  - message request policy, DM policy, mention permissions, activity visibility.
- Decide local-only versus server-enforced controls.
- Add explicit disclosure copy for what is local preference versus server policy.

### 8) Edit Per-server Profile
- Extend backend profile contract for server-scoped overrides:
  - display name, avatar, optional pronouns/status text.
- Add client editor UI and validation.
- Add fallback rules:
  - server-scoped override -> global profile -> UID fallback.

### 9) Create Event
- Define event model in backend contract:
  - title, description, start/end, timezone, recurrence, participants.
- Add event creation modal and validation.
- Add event list/surface to channel/server UI.
- Add notification/reminder behavior.

### 10) Leave Server
- Add confirm flow with explicit consequences.
- On confirm:
  - remove server profile from registry,
  - clear server-scoped volatile caches (messages/presence/call),
  - disconnect realtime and voice sessions,
  - switch to next available server safely.
- Define backend leave API only if membership is server-managed.

## Cross-cutting TODOs
- Accessibility:
  - keyboard navigation for context menu and submenus,
  - focus trap + escape handling,
  - screen reader semantics (`menu`, `menuitem`, `menuitemcheckbox`, `aria-expanded`).
- Telemetry (opt-in only): capture menu action usage for prioritization.
- Tests:
  - component tests for open/close and action dispatch,
  - integration tests for mark-read/mute/leave flows.
