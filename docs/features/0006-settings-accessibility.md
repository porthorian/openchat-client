# Feature: Client settings and accessibility

- Status: In progress; release gates below remain open
- Owners: Maintainers
- Last updated: 2026-09-18
- Related ADRs: ADR-0002, ADR-0005, ADR-0008, proposed ADR-0009

## Problem and user flows

Users need one place to edit local profile, appearance, keyboard shortcuts, notifications, accessibility preferences, identity disclosure, and call devices. The settings dialog opens from the dock, profile panel, server notification menus, and the Settings shortcut. Changes apply immediately and persist locally where appropriate. The app targets WCAG 2.2 AA across onboarding, chat, calls, and overlays.

## User stories

- As a user, I can change appearance and keyboard behavior and keep the choices after restart.
- As a user, I can control desktop alerts for each server and see OS permission state.
- As a user, I can edit my local profile without automatically sending it to a server.
- As a keyboard or screen-reader user, I can complete the same onboarding, chat, call, and settings tasks.

## Backend capability assumptions

All settings except optional profile publication are local. Publication uses the existing profile capability and update API only. The capability must advertise enabled status and either `server_scoped` or `global` scope. No backend service code or new endpoint is required.

## Client data and migration

- `useSettingsStore` hydrates before the first Vue render and writes normalized, non-sensitive preferences to `openchat.settings.v1`.
- Defaults: dark theme, system-following contrast and motion, 100% text, notifications enabled, previews on, sound off, online local presence, per-server policy All.
- Settings normalization falls back per invalid field. Existing `openchat.chat-notification-prefs.v1` muted server IDs migrate to Off on first v1 hydration. The previous All or Mentions policy is remembered when quick mute is toggled.
- Call device and volume preferences stay in the call store. Profile name and avatar stay in the identity store, outside settings preferences. Consent is a separate `openchat.profile-consent.v1` record; malformed consent fails closed.
- State is server-scoped for notification policy and client-wide for appearance, shortcuts, and presence.

## UI states

- Settings sections: My Account, Appearance, Keybinds, Notifications, Accessibility, Identity & Privacy, Voice & Video.
- Appearance: Dark, Light, Follow system. Accessibility: Standard, High contrast, or Follow system; Full motion, Reduced motion, or Follow system; 100, 125, 150, or 200% text.
- Keybind recorder validates in-app single chords, rejects reserved and duplicate shortcuts, and supports per-action and all reset. Navigation and call shortcuts ignore typing and modals. Typing outside the composer cannot redirect text from a dialog, menu, or button.
- Notification delivery obeys global enable, OS permission, Do Not Disturb, and the target server's All, Mentions, or Off policy. Permission is requested only from the explicit control. Message text previews can be hidden; sound defaults off.
- Local profile editing uses the onboarding name length and image type/size limits. Display name and avatar are not automatically published. The optional sharing UI explains scope, audience, and revocation limits. Publication is disabled until ADR-0009 security signoff.
- Error states: local storage failure, device selection failure, notification permission denied, unsupported output switching, profile sync failure. Offline local preferences remain editable.

## Security and accessibility

- ADR-0005's UID/proof-only boundary remains effective. `PROFILE_PUBLICATION_APPROVED` is false pending the ADR-0009 security review. No backend endpoint is added.
- Settings is a modal dialog with initial focus, Tab containment, Escape, background inertness, and focus return. Server menus use shared arrow-key behavior and focus return. Focus indication is visible across native controls.
- Semantic appearance tokens cover primary app surfaces and settings controls. Further tokenization and contrast verification are required for all chat/call states before declaring app-wide WCAG 2.2 AA conformance.

## Verification

- Unit: settings migration/defaults, notification decisions, consent scope and corrupt consent, shortcut conflicts.
- Component: settings profile editing and section navigation, dialog Tab/Escape, server notification menu action.
- Playwright Electron: fresh onboarding keyboard focus and axe, dark/light workspace, menu, settings and high-contrast axe, 200% text with narrow-dialog reflow, preference persistence after a full Electron restart, no profile upload before consent or while the review gate is closed.
- Manual release matrix: keyboard-only onboarding/chat/call flows, OS theme and contrast/motion changes, 200% reflow, notification permission states, screen reader announcements with VoiceOver on macOS, NVDA on Windows, and Orca on Linux. Record findings and fix all known Level A/AA failures before release.

## Release gates

- [ ] Security reviewer accepts ADR-0009 and profile publication review; network test covers granted, revoked, invalid, and changed-scope consent; only then enable publication.
- [ ] Finish semantic token conversion and app-wide WCAG 2.2 AA audit, including chat/call states and all overlays.
- [ ] Complete VoiceOver, NVDA, and Orca manual checks on supported platforms.
- [ ] Confirm PR CI and packaged artifacts on macOS, Windows, and Linux.

Identity backup, key rotation, and encrypted identity storage remain separate milestone work.

## Rollout and success criteria

Ship only after every release gate above is checked and CI passes on the target platforms. Treat any known user-facing WCAG Level A/AA failure or profile write without valid, scoped consent as a release blocker. Success means preferences survive restart, notification decisions follow the selected policy, and keyboard and assistive-technology users can complete the core flows.
