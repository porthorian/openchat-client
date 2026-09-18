# Profile publication security review

- Status: Awaiting security reviewer signoff
- Date: 2026-09-18
- Decision: ADR-0009

## Data flow and trust boundary

Local profile editing writes to the existing local identity store. A server capability probe provides `profile.enabled` and `profile.scope`. Before calling the existing profile update API, the chat store checks the publication gate, capability, backend endpoint, and locally persisted consent. The client sends display name and avatar only to that backend on an explicit opt-in or later edits while the same grant remains valid.

## Threats and controls

| Threat | Control | Evidence to review |
| --- | --- | --- |
| Profile upload during hydration without consent | Central guard in `chat.syncLocalProfile`; publication gate defaults closed | Electron network test must observe zero profile writes before opt-in |
| Consent silently broadens when backend changes scope | Scope and normalized endpoint are part of the consent key | Consent scope unit tests and UI copy for `global` |
| Corrupt consent authorizes a write | Versioned parser rejects invalid grants; write errors prevent granting | Consent parser unit tests and storage failure test |
| Revocation cannot rewrite local storage | Client tries to remove the entire consent record; if even removal fails it clears in-memory grants and keeps publication gated | Storage failure component test; verify durable failure handling before gate approval |
| Another server receives a profile | Per-server operation uses target endpoint and server UID; global consent is limited to one backend | Multi-server network test |
| Revocation is mistaken for deletion | UI states only future client writes stop, and prior backend copies may remain | UI review |
| Remote content injects profile attributes | No profile update based on a remote profile or message | Code review |

## Required signoff before enabling the gate

- [ ] Security reviewer approves ADR-0009 and this data flow.
- [ ] Run an Electron network test proving no profile update before consent, after corrupt consent, or after revocation.
- [ ] Prove durable fail-closed behavior if both consent rewrite and removal fail across a full process restart.
- [ ] Verify server-scoped and global audience copy against the actual backend profile capability contract.
- [ ] Confirm no new profile data in join, auth, logs, or telemetry requests.
- [ ] Change `PROFILE_PUBLICATION_APPROVED` to `true` in the reviewed release change.

Until these checks are complete, the settings screen explains that sharing is unavailable and the sync call returns before the API request.

The current Playwright Electron smoke test observes zero profile writes before consent and after loading a stored grant while the review gate is closed. It does not substitute for the required post-approval granted/revoked network matrix.
