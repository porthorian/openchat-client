# Milestones

This document tracks delivery milestones for the OpenChat client planning and implementation roadmap.

Last updated: 2026-02-13

## Status Key
- `planned`: defined but not started
- `in_progress`: active work
- `done`: accepted and complete
- `blocked`: waiting on dependency

## Milestone Overview

### M0: Project Foundation
- Status: `done`
- Goals:
  - Repository scaffolding and documentation baseline.
  - Architecture decisions recorded.
  - Contribution and security policies published.
- Exit criteria:
  - Core docs present and linked.
  - Initial ADR set accepted.
  - MVP feature specs drafted.
  - Runtime scaffold exists for Electron + Vue + Pinia + PrimeVue (unstyled).
- Completion notes:
  - Runtime scaffold exists and is actively used (`electron-vite`, Vue renderer, Pinia stores).
  - Core documentation and architecture records are present and linked from `README.md`.
  - Feature spec set is drafted and versioned in `docs/features/`.

### M1: Multi-Server Shell
- Status: `done`
- Goals:
  - Server rail and server registry UI.
  - Join flow with capability probe and trust states.
  - Session handling and active server context.
- Exit criteria:
  - Server management flows implemented and tested.
  - Multi-server switching validated for isolation behavior.
- Completion notes:
  - Implemented: server rail and registry UX with backend discovery and manual add flow.
  - Implemented: capability probe + trust-state visibility in add-server join flow.
  - Implemented: server-scoped session binding and UID projection flow.
  - Implemented: per-server UI context isolation for active channel/filter during server switching.

### M2: Core Messaging UX
- Status: `done`
- Goals:
  - Channel navigation.
  - Message timeline rendering and composer.
  - Notifications and unread state behavior.
- Exit criteria:
  - Core chat loop is usable across multiple servers.
  - Reconnect and degraded states tested for primary surfaces.
- Completion notes:
  - Implemented: channel navigation/filtering and active channel switching across server contexts.
  - Implemented: message timeline + composer with send/receive over realtime channel updates.
  - Implemented: unread behavior by channel and aggregate unread indicators in server rail.
  - Implemented: desktop notification delivery for incoming realtime messages with mention-aware behavior.
  - Implemented: realtime reconnect/backoff handling and degraded/offline connection state surfacing in primary toolbar UI.

### M3: Hardening and Open-Source Readiness
- Status: `in_progress`
- Goals:
  - Security hardening baseline complete.
  - CI/CD pipeline stabilized.
  - Contributor operations finalized for public growth.
- Exit criteria:
  - Required quality gates enforced.
  - Release process documented and trialed.
- Progress notes:
  - Implemented: desktop installer release workflow (`client-vX.X.X`) for macOS/Windows/Linux.
  - Implemented: signing/notarization secret wiring and unsigned fallbacks in CI.
  - Remaining: hardening checklist completion, full quality-gate enforcement, and release runbook maturity.

## Feature-to-Milestone Mapping
| Feature Spec | Target Milestone | Status |
| --- | --- | --- |
| `docs/features/0001-auth-session-ui.md` | M1 | done |
| `docs/features/0002-server-join-registry.md` | M1 | done |
| `docs/features/0003-channel-navigation.md` | M2 | done |
| `docs/features/0004-message-timeline-composer.md` | M2 | done |
| `docs/features/0005-notifications.md` | M2 | done |
| `docs/features/0006-settings-accessibility.md` | M3 | planned |
| `docs/features/0007-voice-video-webrtc.md` | M2 | in_progress |
| `docs/features/0008-moderation-and-governance.md` | M3 | planned |

## Notes
- Milestone assignments are implementation-driven and should be revalidated after each release tag.
- Backend contract dependencies continue to gate completion for parts of M1/M2/M3.
- Identity-related work must enforce the UID-only server disclosure model documented in ADR-0005.
