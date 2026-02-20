# Feature Spec: Client Upgrade Mechanism

## Status
- Implemented baseline (M3 hardening in progress)
- Owner: Client team
- Last updated: 2026-02-20

## Problem Statement
The desktop client now includes a formal update mechanism, but this document defines the implemented baseline and remaining hardening work. Users should get reliable update visibility and predictable install behavior without disrupting active workflows.

Current baseline behavior:
- checks for updates on startup + periodic schedule,
- surfaces update status and actions through `AppTaskbar` (`mdiDownload`),
- provides version/update detail and download/install progress modals.

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
- Taskbar state change on `available` (primary passive indicator).
- Optional tooltip text with exact version (`vX.Y.Z`).
- Version info modal includes a manual "Check again" action.

## Data Model And Client State Impact
Implemented model:
- `currentVersion: string`
- `latestVersion: string | null`
- `status: UpdateStatus`
- `progressPercent: number | null`
- `lastCheckedAt: string | null` (ISO timestamp)
- `releaseNotesUrl: string | null`
- `errorMessage: string | null`

Store boundary:
- `useClientUpdateStore` in renderer state layer.
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
Completed baseline:
1. Update domain types and IPC contract implemented.
2. Main-process scheduler + updater bridge implemented.
3. Renderer store + `AppTaskbar` update action implemented.
4. Version info modal + update progress modal implemented.

Remaining hardening:
1. Expand integration/e2e coverage across macOS/Windows/Linux.
2. Refine failure UX and retry guidance for updater-disabled environments.
3. Add release checklist documentation for update QA signoff.

## Success Criteria
- App performs automatic periodic checks in production.
- Users can identify update availability from `AppTaskbar` without opening settings.
- Download/install flow completes without renderer crashes or duplicate action errors.
- No cross-server data leakage introduced.
- Test coverage added for status transitions and taskbar behavior.

## Open Questions
- Whether Linux distributions require per-channel behavior differences.
- How aggressively to surface `error` state in taskbar vs notifications.
- Whether release notes should open external browser or in-app modal.
