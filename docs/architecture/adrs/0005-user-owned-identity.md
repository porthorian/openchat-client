# ADR-0005: User-Owned Identity with UID-Only Server Disclosure

- Status: Accepted
- Date: 2026-02-09
- Deciders: OpenChat Client maintainers
- Related: `AGENTS.md`, `docs/architecture/backend-contract.md`, `docs/features/0001-auth-session-ui.md`

## Context
OpenChat connects to independent server backends. The product direction requires strong user data ownership, where personal identity/profile data should not be stored on servers. Existing planning language allowed traditional server-managed auth interpretations, which creates ambiguity and privacy risk.

## Decision
Adopt a user-owned identity model:
- Identity root and profile metadata are managed locally by the client.
- Servers receive only an opaque unique user identifier (`user_uid`) and protocol-required proofs/tokens.
- UI must disclose data-sharing scope clearly during server join and identity/session flows.

This decision applies across architecture, feature specs, backend contract assumptions, and review policy.

## Alternatives Considered
- Traditional server-managed accounts with profile storage.
- Hybrid model with optional profile upload by default.
- Third-party identity provider dependency as baseline.

## Consequences
### Positive
- Strong privacy boundary aligned with decentralized server model.
- Reduced server-side exposure of personal user data.
- Clear contributor and reviewer rule for data disclosure decisions.

### Negative
- Increased client complexity for identity lifecycle and recovery UX.
- More design work for displaying participant identity when servers store minimal identity data.
- Potential interoperability friction with backends expecting profile-centric auth.

## Implementation Notes
- Capability negotiation must include identity/data-disclosure policies.
- Feature specs must declare UID-only behavior and any exceptions.
- Any expansion beyond UID/proof disclosure requires a new ADR and security review.
