# Release Milestones

Last updated: 2026-02-19

## M0: Project Foundation
- Status: `done`
- Scope:
  - Electron + Vue + Pinia bootstrap.
  - Core repository docs and ADR index.
  - Initial architecture and feature spec scaffolding.

## M1: Multi-Server Shell
- Status: `done`
- Scope:
  - Server registry hydration and persistence.
  - Server rail and channel pane shell.
  - Add server flow with capability probe and trust warning summary.
  - Server-scoped UID projection and session binding state.

## M2: Core Messaging UX
- Status: `done`
- Scope:
  - Channel navigation and filtering.
  - Message timeline and composer baseline.
  - Realtime message/presence/typing subscriptions.
  - Desktop notifications baseline and unread tracking.

## M3: Hardening and Open-Source Readiness
- Status: `in_progress`
- Current focus:
  - Voice baseline hardening (reconnect stability, device handling, error states).
  - Documentation alignment with implemented behavior.
  - TODO: add explicit maintainer contact (`maintainers@pennyos.com`) to `SECURITY.md`, `SUPPORT.md`, and `.github/ISSUE_TEMPLATE/config.yml` contact links.
  - TODO: swap domain references from `marone.us` to `pennyos.com` (for example, `https://openchat.marone.us` -> `https://openchat.pennyos.com`) when cutover is approved.
  - TODO: fix `Shift+Enter` in the composer (newline behavior).
  - TODO: restore voice/video/screenshare functionality in notarized macOS builds (required entitlements/permissions).
  - TODO: auto-scroll when sending a message with `Enter`.
  - TODO: auto-scroll when an image is pasted into the composer.
  - TODO: auto-scroll on incoming messages when the user is near the bottom.
  - TODO: ensure composer/typing text is never visually clipped; when composer height grows, push message-pane scroll so active text remains fully visible.
  - TODO: fix composer text wrapping so input does not overflow horizontally.
  - TODO: add message-pane right-click context menu with message actions (react, reply, copy text/link, mark unread, pin, delete).
  - TODO: add copy/paste right-click menu support in the lightbox.
  - TODO: add support for message quotes.
  - TODO: add support for code blocks.
  - TODO: add emoji support.
  - TODO: make the bottom-left settings button functional.
  - TODO: investigate and fix the issue captured in the referenced screenshot backlog item.
  - Accessibility and settings follow-up pass.
  - CI/release hardening and contributor workflow polish.
