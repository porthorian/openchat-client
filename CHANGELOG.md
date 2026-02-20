# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.0.6] - 2026-02-20

### Added
- Reply UX in the chat composer and message rows.
- Markdown syntax support with markdown security test coverage.
- Right-click context menus for message items and image lightbox actions.
- Sticky scroll behavior when a user is firmly at the bottom of the chat pane.

### Changed
- Desktop release automation was split into OS-specific workflows for Linux, macOS, and Windows.
- Milestone tracking docs/templates were updated from TODO-style items to issue/work-item tracking.

### Fixed
- Composer input behavior for `Shift+Enter`, including wrapping and clipping improvements.
- macOS packaging entitlements now include audio input and video capture permissions.

## [0.0.5] - 2026-02-19

### Changed
- macOS packaging now emits both `x64` and `arm64` artifacts for `dmg` and `zip` targets.
- Desktop release workflow now treats macOS signing and notarization secrets as required and fails fast when missing.
- Desktop release workflow now validates macOS app signatures and stapled notarization tickets before artifacts are uploaded.
- Release artifact upload/publish now includes macOS `.zip` files alongside existing installers and metadata.

### Fixed
- Removed the invalid `com.apple.developer.usernotifications.communication` entitlement from macOS signing config.
- Removed a workflow-level `APPLE_API_KEY` override that could interfere with notarization environment wiring.

## [0.0.4] - 2026-02-19

### Added
- Video and screen sharing support in the desktop client.
- Rich media messaging support with image uploads and URL preview rendering.
- In-app image lightbox with pan/zoom, download, copy-link, and open-in-browser actions.
- Additional debug and diagnostic hooks for RTC channels and desktop packaging flows.

### Changed
- Release pipeline now runs through local build scripts for easier local/CI parity and debugging.
- Desktop release workflow now stamps `build/package.json` before packaging so release artifacts use the tagged semantic version.
- CI packaging paths now distinguish signed vs unsigned macOS and Windows builds, including explicit warning steps for unsigned fallback artifacts.
- Release automation now standardizes Node `23.9.0` and Yarn `4.12.0` in CI for deterministic desktop artifact builds.

### Fixed
- Improved error messaging when outbound message delivery to the backend fails.
- Screen sharing model/layout pane fixes.
- `build/run-builder-with-stamped-package.js` now resolves Yarn/Corepack invocation more reliably on Windows by handling non-JS `npm_execpath` shim cases.
- Stamped build execution now restores the root `package.json` after packaging, preventing stamped version spillover into local workspace state.
- macOS signing/notarization workflow and Windows packaging fixes for desktop release builds.

## [0.0.3] - 2026-02-17

### Added
- Auto-update manager integration via `electron-updater`.
- Ability to remove joined servers.
- Onboarding profile policy selector updates for faster agree/disagree flows.
- Updated client logo assets.

### Changed
- Documentation updates for client behavior and upgrade planning.

### Fixed
- CSS/layout fixes for user profile, server rail, and channel pane.
- Additional release cleanup and stale-version removal in packaging flow.

## [0.0.2] - 2026-02-15

### Added
- Server build versions surfaced in Add Server flow.
- Submenus for servers and server channels.

### Changed
- User dock layout/placement refinements.
- Voice connected card moved for improved channel-panel UX.

## [0.0.1] - 2026-02-15

### Added
- Initial Electron desktop client implementation and Discord-like shell baseline.
- Initial onboarding for first install plus join/create first server.
- Realtime foundations including reconnect/backoff handling, notifications, server probing, and typing signals.
- Voice/audio UX foundations including device menus and microphone activity highlighting.
- Electron Builder packaging/release pipeline and initial CI/typecheck/dependency automation.
- Initial documentation set, milestone tracking, and core UI assets.

### Changed
- Iterative UI refinements across server rail, chat pane, profile pane, and member presence surfaces.
- Early composable refactor and interaction polish for playback/device menus.

### Fixed
- CI workflow and lockfile maintenance fixes leading into the first `v*` tagged release.

[Unreleased]: https://github.com/porthorian/openchat-client/compare/v0.0.6...HEAD
[0.0.6]: https://github.com/porthorian/openchat-client/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/porthorian/openchat-client/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/porthorian/openchat-client/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/porthorian/openchat-client/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/porthorian/openchat-client/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/porthorian/openchat-client/releases/tag/v0.0.1
