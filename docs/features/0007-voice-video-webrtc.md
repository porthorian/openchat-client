# Feature: Voice and Video Communication (WebRTC)

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-11
- Related ADRs: `docs/architecture/adrs/0002-pinia-state-architecture.md`, `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`, `docs/architecture/adrs/0006-webrtc-sfu-media-architecture.md`
- Related Issues: TBD

## Problem Statement
Users need low-latency voice and video communication in channels without sacrificing OpenChat's multi-server isolation model, trust transparency, and UID-only identity disclosure boundary.

## User Stories
- As a user, I want to join a voice channel quickly so that I can talk in real time.
- As a user, I want to toggle microphone and camera state with clear feedback so that I can control my privacy and participation.
- As a user, I want reconnect behavior that is visible and recoverable so that temporary network loss does not permanently break calls.
- As a user, I want consistent media controls across servers so that backend differences do not create confusing UX.

## Scope
### In Scope
- Voice and video channel sessions using WebRTC transport.
- Join/leave flow with per-server capability gating.
- Core controls:
  - mute/unmute
  - deafen/undeafen
  - camera on/off
  - device selection (mic/camera/speaker)
- Speaking indicator and participant state badges.
- Server-scoped call lifecycle state with reconnect and degraded states.
- Screen share UI placeholders and capability-gated controls.

### Out of Scope
- Backend SFU/signaling implementation details.
- Recording/stream archiving.
- Broadcast/live streaming workflows.
- End-to-end media encryption beyond standard WebRTC transport security.
- Full moderation feature set (stage channels, advanced role-controlled media policies).

## UX Flow
1. User selects a voice-enabled channel.
2. Client checks cached server capability snapshot; if stale/missing, re-probes capabilities.
3. Client validates trust/security posture and discloses required permissions.
4. User confirms join; mic/camera permissions are requested only when needed.
5. Client connects signaling transport, negotiates WebRTC session, and attaches local tracks.
6. Remote participants appear with speaking/activity state.
7. On transport degradation, UI shows reconnecting/degraded banner and retries per policy.
8. User leaves channel; local tracks stop and ephemeral call state is cleared.

## UI States
- Loading: capability check, signaling connect, SDP/ICE negotiation.
- Empty: user is alone in channel.
- Success: active call with participant media and controls.
- Error: capability mismatch, permission denied, signaling/ICE failure.
- Degraded/Offline: signaling disconnected, media paused, reconnect in progress.

## Backend Capability Assumptions
- `GET /client/capabilities` returns base compatibility data plus optional `rtc` object.
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
  - planned `usePresenceStore` (speaking/ephemeral indicators)
  - planned `useCallStore` (active calls, participants, media device state)
- Caches affected:
  - per-server capability cache with staleness timestamp
  - per-channel ephemeral participant/media state
- Persistence requirements:
  - persist non-sensitive media preferences only (device ids, push-to-talk preference, local preview settings)
  - do not persist raw media frames, SDP blobs, or ICE credentials beyond session needs

## Security and Privacy Considerations
- Enforce trust warnings for insecure transport or certificate anomalies before join.
- Keep UID-only identity disclosure boundary for media signaling/auth.
- Request microphone/camera permissions at interaction time, not app startup.
- Provide clear in-call indicators when mic/camera is active.
- Apply log redaction for signaling payloads and credential fields.

## Accessibility Requirements
- Full keyboard operation for join/leave and media toggles.
- Screen-reader announcements for mute/deafen/camera status changes.
- Visible focus and high-contrast treatment for active media controls.
- Non-audio visual indicators for speaking and connection state.

## Telemetry and Observability
- Events:
  - `voice_join_requested`
  - `voice_join_succeeded`
  - `voice_join_failed`
  - `voice_reconnect_started`
  - `voice_reconnect_succeeded`
  - `media_toggle_changed`
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
  - camera on/off
  - disconnect/reconnect recovery
- Manual QA:
  - device switching across OSes
  - keyboard-only operation
  - degraded network behavior

## Rollout Plan
- Milestone target: M2 for voice baseline, post-M2 for broader video/screen-share hardening.
- Guardrails:
  - hide/disable unsupported controls from capability flags
  - provide non-blocking fallback UI when RTC unavailable
  - never mix call state across `server_id` contexts
- Success metrics:
  - call join success rate
  - median time-to-first-audio
  - reconnect success rate
  - media-related crash/error rate

## Open Questions
- Should 1:1 direct calls permit `p2p` if a server does not advertise SFU?
- Which minimum browser codec set is required for first stable release?
- How should push-to-talk keybind conflicts be resolved in cross-platform defaults?
