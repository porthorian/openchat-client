# WebRTC Test Strategy (Client)

## 1) Purpose
Define how the OpenChat client validates WebRTC voice/video behavior against capability-driven backends with SFU-first topology.

This document focuses on renderer/client confidence gates and cross-repo contract compatibility with `openchat-backend`.

## 2) Test Objectives
- Validate capability parsing and RTC feature gating.
- Validate signaling lifecycle handling and user-facing state transitions.
- Validate reconnect behavior and moderation-driven forced disconnect UX.
- Validate server-scoped isolation (`server_id` + `channel_id`) for all call state.

## 3) Scope
### In Scope
- Frontend unit/component/integration/e2e tests for WebRTC-related state and UI.
- Client-side contract fixture validation for RTC capability and signaling envelopes.
- CI stage definitions for client repo quality gates.

### Out of Scope
- SFU media forwarding correctness internals (backend responsibility).
- TURN network appliance availability testing.
- Full load testing at SFU capacity limits (backend/system responsibility).

## 4) Test Environments
- Local developer:
  - `openchat-client` + mock signaling harness.
- Integration:
  - `openchat-client` + `openchat-backend` + Postgres + TURN (Docker Compose).
- CI:
  - headless renderer test jobs with deterministic mock media tracks.

## 5) Contract Fixtures (Client-Owned)
Maintain JSON fixtures under a future folder (suggested):
- `tests/fixtures/capabilities/rtc-enabled.json`
- `tests/fixtures/capabilities/rtc-disabled.json`
- `tests/fixtures/capabilities/rtc-voice-only.json`
- `tests/fixtures/signaling/rtc-joined.json`
- `tests/fixtures/signaling/rtc-error-permission-denied.json`
- `tests/fixtures/signaling/rtc-kicked.json`

Fixture rules:
- include schema version in each fixture
- include negative/invalid variants
- keep one fixture per behavior, not one giant payload

## 6) Unit Test Matrix
- Capability normalization:
  - parses valid `rtc` payload
  - handles missing `rtc` gracefully
  - rejects/flags invalid signaling URL or unsupported topology
- Call store transitions:
  - `idle -> joining -> active`
  - `active -> reconnecting -> active`
  - `active -> disconnected` on kick/ban event
- Permission gating:
  - hide/disable camera/screen-share toggles from capabilities
  - deterministic error message mapping for permission-denied events
- Isolation guarantees:
  - call state for `server_a` must not mutate on `server_b` events

## 7) Component Test Matrix
- Voice channel join panel:
  - loading, success, error, degraded states
- Media controls:
  - mute/deafen/camera toggles with keyboard and pointer interaction
  - disabled states when capability absent or timeout restriction active
- Participant strip/grid:
  - participant join/leave updates
  - speaking indicator updates
- Moderation overlays:
  - forced disconnect banner on `rtc.kicked`
  - actioned state on `ban`/policy revoke event

## 8) Integration Test Matrix (Client + Mock/Real Backend)
- join flow:
  - fetch capabilities -> request join ticket -> signaling join -> active call
- negotiation path:
  - offer/answer + ICE exchange happy path
- reconnect path:
  - simulated signaling drop and grace-window reconnect success
- policy enforcement:
  - timeout role loses publish permissions while remaining connected
  - kick/ban triggers immediate leave state and UI lockout
- capability mismatch:
  - backend reports no RTC; client degrades without crash

## 9) End-to-End Smoke Scenarios
Run with 2-5 synthetic users:
1. User A and B join same voice channel and exchange audio tracks.
2. User C joins late; participant list updates in both existing clients.
3. Moderator kicks User C; C is forcibly disconnected and blocked from rejoin.
4. Temporary network loss for User A; client recovers within reconnect policy.
5. Server capability downgrade (video off); UI hides video controls without restart.

## 10) CI Stage Plan (Client Repo)
Proposed pipeline:
1. `validate`
   - lint/format/typecheck
   - capability/signaling fixture schema checks
2. `test-unit`
   - store/model reducers, capability parsing
3. `test-component`
   - media controls and call-state UI tests
4. `test-integration`
   - mocked signaling lifecycle
5. `test-e2e-smoke` (nightly or gated on main)
   - multi-client scripted smoke against backend test stack

## 11) Pass/Fail Thresholds
- `join_success_rate >= 99%` in stable CI environment
- `reconnect_success_rate >= 95%` under controlled transient drop test
- `forced_disconnect_latency_p95 <= 1s` after kick event delivery
- no uncaught exceptions in join/leave/reconnect scenarios

## 12) Tooling Notes
- Use fake media tracks (`getUserMedia` mocks) for deterministic CI.
- Keep signaling tests event-driven with explicit timeout assertions.
- Record and snapshot normalized capability models for regression detection.

## 13) Cross-Repo Coordination
- Client fixtures should mirror backend contract versions.
- Any signaling protocol change in backend must include:
  - fixture updates in client repo
  - integration test updates in both repos
  - contract version bump notes in docs

## 14) Open Questions
- Should client e2e smoke run on every PR or only on protected branches?
- Do we need browser-engine matrix coverage beyond Electron runtime baseline?
