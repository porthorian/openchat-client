# ADR-0006: SFU-First WebRTC Media Architecture

- Status: Proposed
- Date: 2026-02-11
- Deciders: OpenChat Client maintainers
- Related: `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`, `docs/architecture/backend-contract.md`, `docs/features/0007-voice-video-webrtc.md`

## Context
OpenChat needs real-time voice/video communication across independent server backends while preserving a consistent client UX, server-scoped isolation, and clear trust signaling. A naive peer-to-peer mesh approach creates unstable performance as participant counts grow, while a fully centralized media mixer creates high backend compute costs and higher end-to-end latency.

Because this repository is client-only, the architecture decision must be expressed as frontend behavior and backend capability contracts instead of backend implementation code.

## Decision
Adopt a WebRTC architecture with SFU-first topology for channel voice/video:
- Client media transport is WebRTC for voice/video/screen share sessions.
- Group channels default to SFU topology when the server advertises RTC support.
- Servers may advertise optional `p2p` topology for direct calls, but mesh is not the baseline for multi-party channels.
- The client requires capability negotiation per server (`/client/capabilities`) before enabling media UI.
- RTC capability contract includes:
  - `rtc.protocol_version`
  - `rtc.signaling_url`
  - `rtc.ice_servers`
  - `rtc.features` (`voice`, `video`, `screenshare`, `simulcast`)
  - `rtc.connection_policy` (timeouts/reconnect hints)
- Media and call state remains server-scoped and channel-scoped (`server_id` + `channel_id` keys) to avoid cross-server leakage.
- Security/trust gates are enforced before media join:
  - explicit insecure transport warnings
  - certificate mismatch warnings
  - least-privilege mic/camera permission prompts at join time
- Identity disclosure remains UID-only by default; media signaling/auth must not require personal profile attributes.

## Alternatives Considered
- Full mesh peer-to-peer for all channels.
- MCU-style server-side media mixing as default topology.
- Non-WebRTC custom realtime media protocol.

## Consequences
### Positive
- Better scalability than full mesh in typical community channels.
- Lower client bandwidth/CPU pressure in larger calls.
- Frontend can adapt to heterogeneous server capabilities with explicit feature gating.
- Decision remains compatible with multi-server isolation and UID-only identity boundaries.

### Negative
- Requires server-side SFU/signaling support in compatible backends.
- Increases frontend complexity in call lifecycle, reconnect, and degraded-state handling.
- Introduces more detailed capability schema and contract testing requirements.

## Implementation Notes
- Frontend capability interfaces for RTC negotiation and capability snapshots are implemented.
- Voice/media state is implemented in `useCallStore` keyed by `server_id` and `channel_id`.
- Feature spec exists for voice/video UX, state, security, and testing (`0007-voice-video-webrtc.md`).
- Remaining work:
  - peer-connection/media architecture hardening against this ADR target
  - expanded integration/e2e coverage for RTC capability variants
