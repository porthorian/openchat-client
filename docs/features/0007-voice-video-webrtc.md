# Feature: Voice and Video Communication (WebRTC)

- Status: Implemented baseline (voice + video + screenshare), hardening in progress
- Owners: Maintainers
- Last Updated: 2026-02-20
- Related ADRs: `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`, `docs/architecture/adrs/0006-webrtc-sfu-media-architecture.md`
- Related Issues: TBD

## Problem Statement
Users need low-latency voice and video communication in channels without sacrificing OpenChat's multi-server isolation model, trust transparency, and UID-only identity disclosure boundary.

## User Stories
- As a user, I want to join a voice channel quickly so that I can talk in real time.
- As a user, I want to toggle microphone and deafen state with clear feedback so that I can control my privacy and participation.
- As a user, I want reconnect behavior that is visible and recoverable so that temporary network loss does not permanently break calls.
- As a user, I want consistent media controls across servers so that backend differences do not create confusing UX.

## Scope
### In Scope
- Voice channel sessions using backend signaling + PCM audio relay.
- Join/leave flow with per-server capability gating.
- Core controls:
  - mute/unmute
  - deafen/undeafen
  - camera toggle
  - screen-share toggle
  - device selection (mic/speaker where supported)
  - input/output volume
- Screen-share source picker via Electron desktop capture bridge.
- Video stream stage with hero tile, thumbnails, and pin/unpin behavior.
- WebRTC offer/answer/ICE negotiation for video stream exchange.
- Speaking indicator and participant state badges.
- Server-scoped call lifecycle state with reconnect and degraded states.

### Out of Scope
- End-to-end encrypted media layer beyond transport defaults.
- Advanced bitrate/simulcast selection UX.
- Push-to-talk and advanced hotkey voice controls.
- Recording/stream archiving and post-call artifacts.
- Backend SFU/signaling implementation details.
- Broadcast/live streaming workflows.
- Full moderation feature set (stage channels, advanced role-controlled media policies).

## UX Flow
1. User selects a voice-enabled channel.
2. Client validates capabilities and requests a join ticket.
3. Client opens signaling transport, starts local mic uplink, and initializes participant session state.
4. User can enable camera and/or screen share when capability + permission checks pass.
5. Remote participants and video/screen streams render in call stage with speaking/activity indicators.
6. On transport degradation, UI shows reconnecting/degraded state and retries per policy.
7. User leaves channel; local media streams, mic uplink, and peer connections are torn down.

## UI States
- Loading: capability check, join-ticket fetch, signaling connect, mic capture init, video publish startup.
- Empty: user is alone in channel.
- Success: active call with participant media tiles and controls.
- Error: capability mismatch, permission denied, signaling transport failure.
- Degraded/Offline: signaling disconnected, media paused, reconnect in progress.

## Backend Capability Assumptions
- `GET /v1/client/capabilities` (or legacy `/client/capabilities`) returns base compatibility data plus optional `rtc` object.
- `rtc` includes:
  - `protocol_version`
  - `signaling_url`
  - `signaling_transport` (initially `websocket`)
  - `topologies` (`sfu` required for group channels; optional `p2p`)
  - `features.voice`
  - `features.video`
  - `features.screenshare`
  - `features.simulcast`
  - `ice_servers[]` with credential metadata
  - `connection_policy` (timeouts, ICE restart behavior, reconnect backoff hints)
- Server must support session-bound signaling auth that does not require personal profile fields.
- Capability flags determine which media controls render/enabled in the UI.

## Client Data Model and State Impact
- Stores touched:
  - `useServerRegistryStore` (capability snapshots)
  - `useSessionStore` (session readiness for signaling auth)
  - `useCallStore` (active calls, participants, media device state)
  - `useChatStore` (profile lookups for participant labels)
- Caches affected:
  - per-server capability cache with staleness timestamp
  - per-channel ephemeral participant/media state
- Persistence requirements:
  - persist non-sensitive media preferences only (selected device ids, mute/deafen defaults, input/output volume)
  - do not persist raw media frames or signaling credential material beyond session needs

## Security and Privacy Considerations
- Enforce trust warnings for insecure transport or certificate anomalies before join.
- Keep UID-only identity disclosure boundary for media signaling/auth.
- Request microphone permissions at interaction time, not app startup.
- Provide clear in-call indicators when mic is active/muted and when output is deafened.
- Apply log redaction for signaling payloads and credential fields.

## Accessibility Requirements
- Full keyboard operation for join/leave and media toggles.
- Screen-reader announcements for mute/deafen status changes.
- Visible focus and high-contrast treatment for active media controls.
- Non-audio visual indicators for speaking and connection state.

## Telemetry and Observability
- Events:
  - media telemetry is not wired in the current baseline.
- Diagnostics:
  - aggregate call setup latency
  - reconnect frequency
  - permission denial rates
- Privacy constraints:
  - no raw audio/video content collection
  - no personal profile data required for media telemetry

## Testing Strategy
- Unit:
  - capability parsing/validation
  - call-state reducers/actions
  - reconnect policy timing logic
- Component:
  - media control panel behavior
  - permission prompt and error states
  - participant list/speaking indicators
- Integration:
  - capability negotiation to call session bootstrap
  - signaling reconnect and ICE restart handling
  - server-scoped call state isolation
- End-to-end:
  - join channel
  - mute/unmute
  - disconnect/reconnect recovery
- Manual QA:
  - device switching across OSes
  - keyboard-only operation
  - degraded network behavior

## Rollout Plan
- Milestone target: baseline media controls delivered; M3 reliability hardening in progress.
- Guardrails:
  - hide/disable unsupported controls from capability flags
  - provide non-blocking fallback UI when RTC unavailable
  - never mix call state across `server_id` contexts
- Success metrics:
  - call join success rate
  - median time-to-first-audio
  - median time-to-first-video
  - reconnect success rate
  - media-related crash/error rate

## Open Questions
- Should 1:1 direct calls permit `p2p` if a server does not advertise SFU?
- Which minimum browser codec set is required for first stable release?
- How should push-to-talk keybind conflicts be resolved in cross-platform defaults?
