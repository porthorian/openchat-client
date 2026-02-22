# Feature: AT Protocol Server Capability Negotiation

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-15
- Related ADRs: `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0007-at-protocol-hybrid-integration.md`
- Related Issues: TBD

## Problem Statement
OpenChat servers can expose different AT Protocol behaviors. The client needs a deterministic capability negotiation model so join, trust, and feature availability are consistent and understandable per server.

## User Stories
- As a user, I want the client to tell me whether AT features are supported before I join a server.
- As a user, I want clear compatibility and trust warnings so that I understand risk and limitations.
- As a user, I want server-specific diagnostics so that I can troubleshoot missing AT features.
- As a maintainer, I want predictable capability fields so that client behavior is stable across backend implementations.

## Scope
### In Scope
- Capability discovery contract extension for AT metadata.
- Join flow compatibility checks and trust/disclosure presentation.
- Server settings diagnostics for AT identity, sync, mentions, read-ack, and moderation-related capabilities.
- Re-probe behavior on reconnect/version change and stale capability handling.
- Per-server feature gating based on capability matrix.

### Out of Scope
- Lexicon schema definitions.
- Message sync reconciliation details beyond capability flags.
- Backend operational runbooks and deployment policy.
- Non-AT server feature negotiation changes unrelated to this work.

## UX Flow
1. User initiates server join with URL/invite.
2. Client probes `GET /v1/client/capabilities` (or legacy `/client/capabilities`).
3. Client evaluates AT support, trust signals, and compatibility requirements.
4. Client shows join summary with enabled/disabled AT features and warnings.
5. After join, server settings include AT diagnostics (including mention/read-ack support) and last probe timestamp.
6. On reconnect/version change, client re-probes and updates feature gating.

## UI States
- Loading: initial and refresh capability probe.
- Empty: no AT metadata present (non-AT server).
- Success: valid AT capability matrix stored for server profile.
- Error: probe failed, malformed capability payload, or incompatible policy.
- Degraded/Offline: previous capability snapshot shown as stale.

## Backend Capability Assumptions
- Discovery payload includes an `atproto` object when AT support exists.
- Expected capability fields (initial draft):
  - `atproto.enabled`
  - `atproto.auth_modes`
  - `atproto.did_methods`
  - `atproto.service_endpoints` (pds/appview/relay references when applicable)
  - `atproto.lexicon_namespaces`
  - `atproto.features` (identity_linking, write_bridge, repo_ingest, labels, mentions_user, mentions_channel, mentions_notifications)
  - `atproto.mentions` (supported tokens like `@here`, `@channel`, policy hints, and max mention targets when applicable)
  - `atproto.read_acks` (channel-level read cursor support, cursor type, and transport mode)
  - `atproto.sync` (firehose support, cursor resume support, lag hints)
  - `atproto.trust` (verification level, certificate/pinning metadata when applicable)
- Capability contract must remain backward-compatible for additive changes.
- Probe responses include `api_version` and cache freshness metadata.

## Client Data Model and State Impact
- Stores touched: `useServerRegistryStore`, `useSessionStore`, `useAppUiStore`.
- Caches affected: per-server capability snapshot with timestamp/version key.
- Persistence requirements:
  - persist non-sensitive capability metadata per `server_id`
  - invalidate stale snapshots on explicit server removal or incompatibility events
  - preserve last-known-good snapshot for degraded/offline UI

## Security and Privacy Considerations
- Join flow must surface insecure transport and trust failures clearly.
- Capability-gated behavior must fail closed for unsupported AT features.
- Capability payloads must not silently override UID-only baseline privacy policy.
- Trust state changes should trigger explicit user-visible warnings.
- Logs should include structured compatibility errors without exposing secrets.

## Accessibility Requirements
- Capability and warning summaries must be keyboard reachable in join/settings UI.
- Status chips and warnings require screen-reader labels with severity context.
- Error and degraded states should preserve focus order and actionable controls.

## Telemetry and Observability
- Events to instrument:
  - `atproto_capability_probe_started`
  - `atproto_capability_probe_succeeded`
  - `atproto_capability_probe_failed`
  - `atproto_capability_incompatible`
- Error logging expectations:
  - include `server_id`, `api_version`, and validation error code
  - exclude any credential/session fields
- Privacy constraints:
  - telemetry should only include server metadata necessary for compatibility analysis

## Testing Strategy
- Unit: capability parsing, validation, and feature-gating logic.
- Component: join summary and server diagnostics rendering.
- Integration: probe flow across AT-enabled, non-AT, malformed, and partial mention/read-ack capability fixtures.
- End-to-end: join flow with compatibility success/failure, mention feature gating, and re-probe on reconnect.
- Manual QA: trust warning clarity and stale snapshot degraded behavior.

## Rollout Plan
- Milestone target: M1 (foundation for all AT feature work).
- Guardrails and fallback behavior:
  - treat unknown required fields as incompatible with actionable messaging
  - preserve non-AT core client functionality when AT fields are absent
- Success metrics:
  - probe success rate
  - compatibility rejection rate by reason
  - stale capability recovery rate after reconnect

## Open Questions
- Which AT fields should be mandatory in the first stable capability contract?
- Should capability probes be user-triggerable in settings for diagnostics?
- How should trust verification levels map to UI severity categories?
- Should mention-related capabilities be considered incompatible when `atproto.features.mentions_*` is present but `atproto.read_acks` is missing?
