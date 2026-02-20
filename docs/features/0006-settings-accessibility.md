# Feature: Settings and Accessibility Foundations

- Status: In progress (baseline controls implemented, dedicated settings shell pending)
- Owners: Maintainers
- Last Updated: 2026-02-20
- Related ADRs: `docs/architecture/adrs/0001-electron-vue-primevue-unstyled.md`, `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0005-user-owned-identity.md`
- Related Issues: TBD

## Problem Statement
Users need consistent settings and accessibility controls so the client remains usable across preferences, devices, and assistive technologies.

## User Stories
- As a user, I want to control appearance and behavior settings so that the app fits my workflow.
- As a user, I want keyboard and accessibility controls so that the app is usable without a mouse.
- As a user, I want settings to persist safely across sessions on this device.

## Scope
### In Scope
- Current implemented baseline controls:
  - identity disclosure panel (`user_uid` sharing summary) and UID mode toggle
  - profile presence status picker (`online`, `idle`, `busy`, `invisible`) in user dock panel
  - per-server notification mute toggle via server context menu
  - voice input/output device selectors and volume controls
  - members pane visibility toggle
- Persistence of non-sensitive settings currently in domain stores:
  - identity/profile setup state
  - muted server list
  - server registry and active-channel context
- Planned settings shell categories:
  - appearance
  - keybinds
  - notifications
  - accessibility
  - identity/privacy

### Out of Scope
- Fully routed, dedicated settings modal/screen shell (not shipped yet).
- Keybind remapping UX.
- Reduced motion and high-contrast user toggles.
- Identity backup/export and key rotation workflows.
- Cloud sync of user preferences.
- Full localization and language packs.
- Enterprise policy enforcement.
- Automatic upload of identity profile data to servers.

## UX Flow
1. User opens profile and audio controls from the bottom user dock.
2. User adjusts presence, UID mode, microphone/speaker device, and volume controls.
3. User can mute a server from server context menu for notification control.
4. Client applies changes immediately and persists non-sensitive values where supported.

## UI States
- Loading: device list refresh, profile hydration, or store initialization.
- Empty: defaults active (no user overrides).
- Success: control updates apply immediately.
- Error: device selection failure, unavailable output switching, or persistence failure.
- Degraded/Offline: local settings still usable without backend dependency.

## Backend Capability Assumptions
- No backend dependency for baseline settings.
- Optional future capability flags may inform server-specific defaults.

## Client Data Model and State Impact
- Stores touched:
  - `useIdentityStore` (profile + UID mode)
  - `useChatStore` (server notification mute preferences)
  - `useCallStore` (voice device and volume state)
  - `useAppUiStore` (pane/layout toggles)
- Planned future store: `useSettingsStore` for unified settings categories and schema versioning.
- Caches affected: local settings cache.
- Persistence requirements:
  - persist only non-sensitive values
  - schema versioning for settings migrations

## Security and Privacy Considerations
- Avoid persisting sensitive user data in settings payloads.
- Validate settings values before persistence.
- Include safe fallback to defaults on schema mismatch.
- Keep personal identity/profile details local-only by default.

## Accessibility Requirements
- Current controls are keyboard reachable (profile popover, device menus, sliders, toggles).
- Semantic labels for profile, disclosure, and voice-control actions.
- Focus-visible treatment required for dock actions, popouts, and context menus.
- Dedicated reduced-motion/high-contrast preferences remain pending.

## Telemetry and Observability
- Events:
  - settings telemetry is not wired in the current baseline.
- Metrics:
  - device-selection failure rate
  - settings persistence failure rate

## Testing Strategy
- Unit: settings normalization and persistence helpers in domain stores.
- Component: profile panel, user dock controls, and device menu interactions.
- Integration: persistence + runtime rehydration for identity and notification preferences.
- End-to-end: change settings and verify behavior after app restart.
- Manual QA: keyboard-only navigation and screen-reader behavior for popovers/menus.

## Rollout Plan
- Milestone target: M3.
- Guardrails:
  - baseline dock controls must remain functional while settings shell is introduced
  - bad persisted config falls back safely
- Success metrics:
  - settings persistence reliability
  - accessibility regression count

## Open Questions
- Should presence status become server-synced or remain local-only?
- Which keybind customization depth is in-scope for first stable release?
- Which identity backup format and encryption UX should be default?
