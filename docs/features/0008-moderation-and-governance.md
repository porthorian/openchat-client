# Feature: Moderation and Governance under E2EE

- Status: Draft
- Owners: Maintainers
- Last Updated: 2026-02-11
- Related ADRs: `docs/architecture/adrs/0004-multi-server-isolation.md`, `docs/architecture/adrs/0005-user-owned-identity.md`, `docs/architecture/adrs/0006-webrtc-sfu-media-architecture.md`
- Related Issues: TBD

## Problem Statement
OpenChat needs moderation controls that preserve strong E2EE guarantees. Moderators may not be able to decrypt all historical messages, so governance and evidence flows must be explicit, fair, and auditable.

## User Stories
- As a member, I want to report harmful content so moderators can act even in encrypted channels.
- As a moderator, I want immediate safety controls (kick/timeout/lock) so I can stop active abuse quickly.
- As a moderator, I want permanent sanctions (ban) to require votes so high-impact actions are not unilateral.
- As a user, I want clear policy and case visibility so moderation actions are understandable and contestable.

## Scope
### In Scope
- Moderation policy display in server settings:
  - emergency actions allowed by role
  - vote-required actions and thresholds
  - case voting window
- Message reporting and moderation case creation UI.
- Moderator case queue and action timeline.
- Vote workflow for permanent sanctions.
- Membership revocation UX and connection/state updates after kick/ban.
- Client rendering of moderation capability flags and degraded/fallback states.

### Out of Scope
- Automated content classification or trust/safety ML pipelines.
- Legal/compliance workflows external to OpenChat server policy.
- Universal cross-server moderation federation.
- Decryption backdoors for moderators.

## UX Flow
1. Member reports a message or user from channel UI.
2. Client builds a report bundle:
   - message ids and ciphertext references
   - reporter-supplied reason/category
   - optional plaintext disclosure from reporter for messages they can decrypt
3. Backend creates moderation case and routes it to eligible moderators.
4. Moderator can apply immediate actions (if policy allows) or propose a vote-required action.
5. For vote-required sanctions (for example `ban`), moderators cast votes within configured time window.
6. If threshold/quorum is met, backend enforces action and emits moderation events.
7. Client updates channel/server state and shows case outcome.

## UI States
- Loading: moderation policy or case queue fetch.
- Empty: no open moderation cases.
- Success: case list, votes, actions, and audit timeline visible.
- Error: insufficient permissions, vote conflict, policy mismatch, network failures.
- Degraded/Offline: cached case summaries only, actions disabled until reconnect.

## Backend Capability Assumptions
- Capability discovery includes moderation contract fields, for example:
  - `moderation.enabled`
  - `moderation.actions.immediate` (kick/timeout/lock)
  - `moderation.actions.vote_required` (ban/remove-role)
  - `moderation.vote_policy` (`threshold`, `quorum`, `window_seconds`)
  - `moderation.evidence_policy` (`plaintext_disclosure_optional`, `report_bundle_required`)
- Backend exposes moderation endpoints:
  - case create/read/update
  - vote submit/read
  - emergency action apply
  - audit feed retrieval
- Backend emits realtime moderation events for case updates and enforcement outcomes.

## Client Data Model and State Impact
- Stores touched:
  - `useServerRegistryStore` (moderation capability snapshot per `server_id`)
  - `useSessionStore` (role/permission context)
  - `useAppUiStore` (modals, drawers, case view routing)
  - planned `useModerationStore` (cases, votes, policies, pending actions)
- Caches affected:
  - per-server moderation policy cache
  - per-server moderation case list with cursor pagination
- Persistence requirements:
  - persist non-sensitive moderation UI preferences only (filters/sort/view mode)
  - do not persist plaintext report evidence unless explicitly disclosed and user-approved

## Security and Privacy Considerations
- Preserve E2EE boundaries: moderators do not gain implicit decryption of unavailable history.
- Require explicit user consent for any plaintext disclosure included in a report.
- Redact sensitive evidence payloads from logs and diagnostics.
- Show action provenance (who proposed, voted, enforced) to reduce opaque abuse of power.
- On ban/kick enforcement, clear active channel/session state and rotate membership context.

## Accessibility Requirements
- Full keyboard support for report submission, case review, and voting controls.
- Screen-reader announcements for case status changes and vote outcomes.
- Distinct focus and contrast states for destructive actions.
- Non-color-only status indicators for open/pending/enforced/closed cases.

## Telemetry and Observability
- Events:
  - `moderation_case_created`
  - `moderation_vote_cast`
  - `moderation_action_enforced`
  - `moderation_action_rejected`
- Diagnostics:
  - case resolution latency
  - vote timeout rate
  - emergency action frequency
- Privacy constraints:
  - no collection of plaintext message content in telemetry
  - only moderation metadata required for reliability and abuse auditing

## Testing Strategy
- Unit:
  - moderation policy parsing and capability gating
  - vote state transitions and threshold evaluation display
  - permissions and action eligibility checks
- Component:
  - report composer and disclosure controls
  - case list and vote panel behavior
  - destructive action confirmation dialogs
- Integration:
  - report -> case creation -> vote -> enforcement lifecycle
  - realtime case update handling
  - kick/ban session invalidation behavior
- End-to-end:
  - submit report
  - perform emergency kick
  - execute vote-based ban
  - verify user removal and policy-driven UI updates
- Manual QA:
  - keyboard-only moderation workflow
  - screen-reader verification for status changes
  - policy mismatch/degraded backend handling

## Rollout Plan
- Milestone target: M3 hardening window after baseline messaging and channel flows.
- Guardrails:
  - hide/disable actions not allowed by server policy
  - block permanent sanctions when vote requirements are unmet
  - keep moderation state strictly server-scoped
- Success metrics:
  - moderation case handling completion rate
  - vote-based action success vs timeout distribution
  - false-positive/appeal indicators from server feedback

## Open Questions
- Should vote thresholds vary by action severity (ban vs role removal)?
- Should plaintext evidence disclosure default to off in all servers?
- What minimum audit visibility should regular members see for moderation outcomes?
