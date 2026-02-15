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
- `0001-auth-session-ui.md` (Implemented baseline)
- `0002-server-join-registry.md` (Implemented baseline)
- `0003-channel-navigation.md` (Implemented M2 baseline)
- `0004-message-timeline-composer.md` (Implemented M2 baseline)
- `0005-notifications.md` (Implemented M2 baseline)
- `0006-settings-accessibility.md` (Draft)
- `0007-voice-video-webrtc.md` (Draft)
- `0008-moderation-and-governance.md` (Draft)
- `0009-server-context-menu-todo.md` (Draft TODO)
- `0010-atproto-identity-linking.md` (Draft)
- `0011-atproto-server-capabilities.md` (Draft)
- `0012-atproto-message-sync.md` (Draft)

Identity baseline for all MVP specs: servers should only receive `user_uid` and required protocol proofs unless explicitly approved by ADR.
