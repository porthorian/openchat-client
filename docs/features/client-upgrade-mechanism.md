# Feature Spec: Client Upgrade Mechanism

## Status
- Proposed
- Owner: Client team
- Last updated: 2026-02-17

## Problem Statement
The desktop client currently has no formal mechanism to periodically check for newer client versions and surface upgrade actions in the UI. Users may continue running outdated versions, missing security fixes, protocol compatibility changes, and product improvements.

We need a client-side upgrade mechanism that:
- checks for updates on a periodic schedule,
- clearly indicates when an update is available,
- uses the existing `AppTaskbar` download control (`mdiDownload`) as the primary action entry point.

## Goals
- Detect new client versions without manual user intervention.
- Surface update availability in a non-disruptive, always-visible location.
- Provide a deterministic state model from check through install.
- Keep privileged update logic in Electron main process.
- Preserve client-only scope (no backend service code added).

## Non-Goals
- Forced auto-restart without user consent.
- Differential patch format design (delegated to updater provider/tooling).
- Server-specific update policy tied to joined community backends.
- In-app changelog renderer beyond a link to release notes.

## User Stories And UX Flows
1. As a user, I want the app to periodically check for updates so I do not need to remember to check manually.
2. As a user, when a new version is found, I want a clear visual indicator in the taskbar.
3. As a user, I want the same taskbar button to let me start download and later restart to apply.
4. As a user, I want clear failure messaging if update checks/downloads fail.
5. As a user, I want update actions to avoid disrupting critical active input (for example while composing a message).

### Primary Flow: Passive Check -> Available -> Download -> Install
1. App launches.
2. Main process schedules and performs an update check.
3. If no update is found, show the client version information in a popup model. This also should show the github, and where to post issues.
4. If update is found:
   - `mdiDownload` button becomes visible in `AppTaskbar`.
   - tooltip/label indicates update availability and target version.
5. User clicks `mdiDownload`:
   - if status is `available`, begin download.
   - if status is `downloading`, open/update status detail.
   - if status is `downloaded`, prompt restart and install.
6. On user confirmation, app restarts and applies update.

### Secondary Flow: Failure And Retry
1. Check or download fails.
2. UI surfaces concise error state (toast + taskbar contextual state).
3. User can retry from the same taskbar control or settings action.

## API / Capability Assumptions
This feature does not depend on community server backends. It assumes:
- client can reach an update feed/service over HTTPS,
- platform signing/notarization requirements are satisfied by release pipeline,
- Electron main process integrates with a supported updater library/provider.

No new protocol fields are required from joined OpenChat servers.

## UI States
Renderer consumes a normalized update status model:
- `idle`: no active check; no update known.
- `checking`: currently checking for updates.
- `available`: newer version detected; ready to download.
- `downloading`: package download in progress (optional progress %).
- `downloaded`: update ready to install.
- `error`: most recent action failed.

### AppTaskbar (`mdiDownload`) Behavior
- Hidden for: `idle`, `checking` with no known update.
- Visible for: `available`, `downloading`, `downloaded`, optional `error` (retry affordance).
- Click handling:
  - `available` -> start download
  - `downloading` -> show progress detail (no duplicate start)
  - `downloaded` -> show restart/install confirmation
  - `error` -> retry check or retry download (context dependent)

### Supporting UI
- Non-blocking toast on `available`.
- Optional tooltip text with exact version (`vX.Y.Z`).
- Optional settings page "Check for updates" action for manual trigger.

## Data Model And Client State Impact
Add shared types for updater state and metadata.

Planned model:
- `currentVersion: string`
- `latestVersion: string | null`
- `status: UpdateStatus`
- `progressPercent: number | null`
- `lastCheckedAt: string | null` (ISO timestamp)
- `releaseNotesUrl: string | null`
- `errorMessage: string | null`

Suggested store boundary:
- New `useClientUpdateStore` in renderer state layer.
- Main process remains source of truth for privileged updater events.
- Renderer store subscribes via preload IPC and mirrors status for UI rendering.

State hygiene:
- Update status is global app state, not server-scoped.
- No server context mixing concerns for this domain.

## Architecture Notes
- Main process:
  - owns scheduler and updater integration,
  - emits status transitions to renderer via IPC.
- Preload:
  - exposes least-privilege update API surface.
- Renderer:
  - reads reactive status from Pinia store,
  - drives `AppTaskbar` button state and actions.

Candidate check cadence:
- first check 30-60s after startup,
- recurring check every 4-6 hours with jitter,
- manual check endpoint for user action.

## Security And Privacy Considerations
- Update transport must be HTTPS.
- Signed artifact validation required via platform/updater tooling.
- No user profile attributes are sent for update checks beyond technical metadata required by updater transport.
- Logs must avoid sensitive token/session data.
- Update endpoint trust should be explicit in docs and release pipeline.

## Accessibility Requirements
- Taskbar update button must be keyboard reachable and have accessible name.
- State changes (available, download complete, error) should be announced via accessible live region/toast semantics.
- Restart/install confirmation dialog must support keyboard-only flow and focus trapping.
- Color indicators must meet contrast requirements and not be the sole status signal.

## Test Strategy
### Unit
- Status reducer/store transition tests.
- Guard tests for duplicate action prevention (no double download trigger).

### Integration
- IPC contract tests: main -> preload -> renderer status propagation.
- Taskbar rendering tests by status.

### End-To-End / Smoke
- Simulated update available flow:
  - detect update,
  - button appears,
  - download progress updates,
  - install prompt shown when ready.

### Manual
- Platform checks on macOS, Windows, Linux.
- Offline and intermittent network behavior.
- Error and recovery validation.

## Rollout Plan
1. Define update domain types and IPC contract.
2. Implement main-process scheduler and event bridge with mock provider.
3. Add renderer store and `AppTaskbar` integration for `mdiDownload`.
4. Integrate real updater provider in production builds.
5. Add docs/release notes guidance and QA checklist.

Feature flag recommendation:
- Gate initial rollout behind `client_updates_enabled` for staged validation.

## Success Criteria
- App performs automatic periodic checks in production.
- Users can identify update availability from `AppTaskbar` without opening settings.
- Download/install flow completes without renderer crashes or duplicate action errors.
- No cross-server data leakage introduced.
- Test coverage added for status transitions and taskbar behavior.

## Open Questions
- Final updater provider/package choice and platform-specific constraints.
- Whether Linux distributions require per-channel behavior differences.
- How aggressively to surface `error` state in taskbar vs notifications.
- Whether release notes should open external browser or in-app modal.

