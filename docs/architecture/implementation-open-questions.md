# Implementation Open Questions (Frontend)

Last updated: 2026-02-11

## 1) Media Capture and Playback Integration
- Should first implementation use direct `getUserMedia` + `RTCPeerConnection`, or wrap this behind a renderer `media-layer` abstraction immediately?
- Do we want to support audio output device switching (`setSinkId`) in MVP, knowing platform support differs?

## 2) Voice UI and Behavior
- Should selecting a voice channel auto-switch text context to a mapped text channel, or stay independent?
- For `timeout` moderation states, should UI remain in listen-only mode with disabled publish controls, or force full disconnect?

## 3) Capability Refresh Policy
- Current implementation probes capabilities on voice join; should we add TTL-based background refresh while server is active?
- Should capability mismatches trigger blocking UI warnings or soft degradation banners by default?

## 4) Multi-Server RTC Sessions
- Should the client allow simultaneous voice sessions across multiple servers, or enforce one global active voice session?
- If simultaneous sessions are allowed later, how should global media controls (mute/deafen) behave?

## 5) Signaling Reliability UX
- On signaling disconnect, should reconnect attempts be automatic with exponential backoff in the renderer store?
- What is the expected UX timeout before we switch from `reconnecting` to `error` state?

## 6) Local Persistence Boundaries
- Should we persist call preferences (last selected devices, mic muted default, deafen default) now, or defer until encrypted settings persistence is finalized?
- If persisted, should preferences be global or server-scoped?

## 7) Test Scope Decisions
- Should WebRTC e2e smoke tests run on every PR or only on protected branches/nightly?
- Do we need additional runtime matrix validation beyond Electron baseline for media behavior?
