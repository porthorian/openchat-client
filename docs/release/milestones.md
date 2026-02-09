# Milestones

This document tracks delivery milestones for the OpenChat client planning and implementation roadmap.

## Status Key
- `planned`: defined but not started
- `in_progress`: active work
- `done`: accepted and complete
- `blocked`: waiting on dependency

## Milestone Overview

### M0: Project Foundation
- Status: `in_progress`
- Goals:
  - Repository scaffolding and documentation baseline.
  - Architecture decisions recorded.
  - Contribution and security policies published.
- Exit criteria:
  - Core docs present and linked.
  - Initial ADR set accepted.
  - MVP feature specs drafted.
  - Runtime scaffold exists for Electron + Vue + Pinia + PrimeVue (unstyled).

### M1: Multi-Server Shell
- Status: `planned`
- Goals:
  - Server rail and server registry UI.
  - Join flow with capability probe and trust states.
  - Session handling and active server context.
- Exit criteria:
  - Server management flows implemented and tested.
  - Multi-server switching validated for isolation behavior.

### M2: Core Messaging UX
- Status: `planned`
- Goals:
  - Channel navigation.
  - Message timeline rendering and composer.
  - Notifications and unread state behavior.
- Exit criteria:
  - Core chat loop is usable across multiple servers.
  - Reconnect and degraded states tested for primary surfaces.

### M3: Hardening and Open-Source Readiness
- Status: `planned`
- Goals:
  - Security hardening baseline complete.
  - CI/CD pipeline stabilized.
  - Contributor operations finalized for public growth.
- Exit criteria:
  - Required quality gates enforced.
  - Release process documented and trialed.

## Feature-to-Milestone Mapping
| Feature Spec | Target Milestone | Status |
| --- | --- | --- |
| `docs/features/0001-auth-session-ui.md` | M1 | planned |
| `docs/features/0002-server-join-registry.md` | M1 | planned |
| `docs/features/0003-channel-navigation.md` | M2 | planned |
| `docs/features/0004-message-timeline-composer.md` | M2 | planned |
| `docs/features/0005-notifications.md` | M2 | planned |
| `docs/features/0006-settings-accessibility.md` | M3 | planned |

## Notes
- Milestone assignments are provisional and should be updated when implementation starts.
- Backend contract dependencies must be resolved in parallel with feature implementation planning.
- Identity-related work must enforce the UID-only server disclosure model documented in ADR-0005.
