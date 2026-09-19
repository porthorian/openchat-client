# ADR-0010: Server actions and moderation privacy

- Status: Accepted for implementation
- Date: 2026-09-18
- Related: ADR-0005, ADR-0009, `docs/features/0008-moderation-and-governance.md`, `docs/features/0009-server-context-menu-todo.md`

## Decision

Server action availability comes from the active backend's versioned capability response. A client hides an action when the corresponding endpoint or enforcement is unavailable and treats a `403` or capability downgrade as authoritative. UI role hints do not grant permissions. All server state remains keyed by `server_id` and cleared after removal or loss of membership.

Channel mute, hide-muted filtering, and notification policy are local preferences. Presence visibility and mention permissions are server-enforced preferences. A member's read-ack cursors are private to that member. No DM controls are presented while DMs do not exist.

A per-server display name/avatar override is optional and requires a separate, explicit server-scoped consent action. The backend does not receive a global profile automatically. The override resolves before the global profile and UID fallback. The client sends an expected version for edits and offers a remove action. ADR-0009 continues to govern global profile publication and its review gate.

Reports contain target references and a reason. The report form requires a second, unchecked consent action before attaching plaintext evidence. The client never caches disclosed plaintext in durable settings. Reporters see their case status; affected targets see sanctions; eligible staff see case evidence, votes, and audit details. Future encrypted channels use the same explicit disclosure decision and require an epoch transition after removal; this decision does not enable encrypted messaging.

The client stores signing keys and session tokens through an OS-backed main-process service. Renderer storage may hold non-sensitive UI preferences only. Existing UIDs require a separately verified key binding; possession of a legacy UID value or header is insufficient.

## Consequences

Capabilities remain off until backend persistence, verified sessions, and cross-transport enforcement are proven. Release moves through persistence/auth, server actions, then moderation. Reconnection rechecks session and capability state before restoring access.
