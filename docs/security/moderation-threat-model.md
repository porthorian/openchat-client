# Moderation and server actions threat model

Status: implementation design, 2026-09-18. Current channel content is plaintext. Future protected channels use references and opt-in disclosure; encrypted messaging rollout is separate.

| Threat | Required control | Verification |
| --- | --- | --- |
| A caller forges another UID | Ed25519 challenge bound to server, UID, device, nonce, and expiry; server-issued session; reject legacy UID headers outside explicit local development | Impersonation and replay tests |
| A stale session survives a kick or ban | Recheck database membership/sanctions on HTTP, realtime, and RTC; revoke sessions and close affected connections | Cross-client reconnect test |
| A member reads another member's activity | Read-ack endpoints derive UID from session and never accept a target UID | Access-control integration test |
| Report evidence leaks through logs, reads, or retention | Separate plaintext consent, authenticated encryption at rest, staff-only reads, no body logging, delete ciphertext 30 days after closure | Consent, authorization, and deletion tests |
| Staff sanctions a peer or owner | Server-side role rank check at action and vote/enforcement time | Equal/higher-role and owner tests |
| Concurrent voters duplicate enforcement | Unique vote per voter and transactional, idempotent enforcement under row lock | Concurrent vote test |
| A protected channel resumes under an old epoch after removal | Pause protected writes until a successful new epoch transition | Future encrypted-channel test gate |

The owner alone appoints roles and changes policy. The default vote policy is two yes votes, three distinct eligible voters, and 24 hours. An insufficient eligible voter pool blocks proposal creation. A policy edit affects new proposals and leaves existing snapshots unchanged. Audit metadata remains append-only even after evidence deletion.

Failure behavior: a failed session or membership check denies access; a failed notification delivery does not roll back a committed sanction and is retried through a durable outbox. A client with stale capabilities hides moderation controls after a downgrade response. Enable sanctions only after migration, operator recovery, and multi-client checks pass.
