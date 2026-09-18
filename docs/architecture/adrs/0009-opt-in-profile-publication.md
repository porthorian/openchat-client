# ADR-0009: Opt-in local profile publication

- Status: Proposed (security reviewer approval required before publication is enabled)
- Date: 2026-09-18
- Supersedes: The UID/proof-only disclosure rule in ADR-0005 only for the profile capability described here, after acceptance
- Related: `docs/features/0006-settings-accessibility.md`, `docs/security/profile-publication-review.md`

## Context

ADR-0005 keeps identity and profile attributes local and requires a new decision and security review before sharing them. The existing optional profile API can accept a display name and avatar. Automatic publication during server hydration was inconsistent with ADR-0005.

## Proposed decision

The client may publish only the locally edited display name and avatar after all of these conditions hold:

1. The server advertises an enabled profile capability with a valid `server_scoped` or `global` scope.
2. The user sees the specific audience and explicitly grants consent for that capability scope and backend endpoint. Consent starts off.
3. The versioned consent record persists successfully. Invalid records fail closed.
   Profile sharing requires HTTPS, except for local loopback development endpoints.
4. A security reviewer signs off this ADR and the review checklist, then the publication gate is enabled in the same reviewed change.

For `server_scoped`, consent binds to the server ID and endpoint. For `global`, consent binds to the backend endpoint and the UI says the profile may appear across that backend's communities. A scope or endpoint change therefore requires fresh consent. Local edits sync while valid consent remains active. Revocation stops future client writes; the UI explains that previous copies may remain on the backend. The client makes no promise that revocation deletes backend data.

No profile attribute is added to the identity handshake or capability probe. No backend endpoint or backend code is added.

## Consequences

- The UI and sync path are implemented behind `PROFILE_PUBLICATION_APPROVED = false` until security signoff.
- Profile consent is stored separately from `openchat.settings.v1` under `openchat.profile-consent.v1`.
- Identity backup, encryption, and key rotation remain separate work.
- An accepted ADR, security reviewer signoff, and verification of no pre-consent upload are release gates.
