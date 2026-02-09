# Feature Specifications

All user-facing features must have a feature spec before implementation.

## How to Add a Feature Spec
1. Copy `FEATURE_TEMPLATE.md` to a new file.
2. Name the file with a sortable prefix and short slug.
3. Link relevant ADRs and backend contract assumptions.
4. Mark unknowns clearly so reviewers can resolve them early.

## Naming Convention
- Format: `NNNN-feature-name.md`
- Example: `0001-server-join-flow.md`

## MVP Specs
- `0001-auth-session-ui.md` (Draft)
- `0002-server-join-registry.md` (Draft)
- `0003-channel-navigation.md` (Draft)
- `0004-message-timeline-composer.md` (Draft)
- `0005-notifications.md` (Draft)
- `0006-settings-accessibility.md` (Draft)

Identity baseline for all MVP specs: servers should only receive `user_uid` and required protocol proofs unless explicitly approved by ADR.
