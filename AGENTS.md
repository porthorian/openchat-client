# OpenChat Client Planning Document

## 1) Purpose
This document defines the implementation plan for an open-source Electron desktop client that provides a Discord-like user experience while connecting each joined "server" to its own independent backend service.

This repository is **client-only**.

## 2) Scope and Boundaries

### In scope
- Electron desktop app (macOS, Windows, Linux).
- Discord-like UI/UX patterns (layout, navigation model, interaction flows).
- Multi-server client that can connect to different backend hosts per server.
- Frontend state management, transport abstractions, and rendering pipeline.
- Client-side security controls and trust UI.
- Contributor workflows, build/release pipeline, and documentation standards.

### Out of scope
- Backend server implementation.
- Database schema design for backend services.
- Backend deployment infrastructure.
- Auth service implementation details beyond client integration behavior.

## 3) Product Direction

### Core idea
- One app, many communities.
- Every joined server has its own backend endpoint and independent configuration.
- Users interact through a consistent UI regardless of backend differences.

### UX target
- Familiar Discord-like information architecture:
  - Server rail
  - Channel list
  - Main chat pane
  - Member/activity side pane
  - Settings modals and overlays
- Fast keyboard-first navigation.
- Smooth real-time updates with clear connection state handling.

### Product principles
- Consistency: unified client behavior across heterogeneous server backends.
- Safety: explicit trust signals for server endpoints and permissions.
- Transparency: visible server identity, capabilities, and connection state.
- Extensibility: plugin-like feature toggles driven by server capabilities.
- User sovereignty: user profile and identity metadata stay local to the client; servers receive only protocol-required unique user identifiers and proofs.

## 4) Architecture Plan (Client-Only)

### High-level modules
- `electron-main`: window lifecycle, protocol handling, secure process boundaries.
- `renderer-app`: UI shell, routing, feature surfaces.
- `shared-sdk`: typed contracts for transport, events, and domain models.
- `server-connection-layer`: endpoint configuration, session management, reconnect logic.
- `identity-layer`: local identity generation/import, key management, server UID projection.
- `state-layer`: global/app state, server-scoped caches, optimistic updates.
- `design-system`: reusable components and interaction primitives.
- `docs`: architecture records, feature specs, contribution docs.

### Frontend stack decision
- Renderer framework: `Vue 3`.
- UI component layer: `PrimeVue` in **unstyled mode**.
- Styling system: custom design tokens + utility/component CSS to match Discord-like UX.
- Component usage rule: PrimeVue components must be wrapped by local design-system components before broad app usage.
- Goal: use PrimeVue for accessibility and behavior primitives while owning all visual presentation.

### State management decision
- Primary client state store: `Pinia`.
- Data-fetching and request lifecycle logic: service layer first, with optional `@tanstack/vue-query` adoption for cache/sync patterns where it reduces complexity.
- Store design rule: server-scoped domain data must be keyed by `server_id` and never mixed across server contexts.

### Planned Pinia store boundaries
- `useAppUiStore`: global shell state (layout panes, modals, navigation context).
- `useIdentityStore`: local user identity profile, key references, and privacy controls.
- `useSessionStore`: current auth/session metadata and active server context.
- `useServerRegistryStore`: joined servers and server configuration metadata.
- `useChannelStore`: channel trees and per-server channel selection state.
- `useMessageStore`: message timelines, optimistic sends, pagination windows.
- `usePresenceStore`: typing, presence, and ephemeral real-time indicators.
- `useSettingsStore`: user preferences (theme, keybinds, notification settings).

### State persistence and security rules
- Persist only non-sensitive UX settings by default.
- Store credentials/tokens using secure Electron + OS keychain mechanisms, not plain local storage.
- Store local identity/profile data in encrypted local storage controlled by the user.
- Apply TTL and bounded cache limits for message/presence state.
- Clear server-scoped volatile state on sign-out and on server removal.
- Never transmit user profile attributes to servers unless explicitly approved by a future ADR.

### Process model
- Keep privileged operations in Electron main process.
- Use preload scripts and context isolation for safe IPC.
- Renderer receives only least-privilege APIs.

### Multi-server model
- Each server profile includes:
  - display name
  - backend base URL
  - transport config (WebSocket/SSE/fallback)
  - identity handshake metadata
  - user identifier policy
  - capability flags
  - trust status
- Client keeps isolated server-scoped state to avoid cross-server leakage.
- Connection manager tracks health independently per server.
- Client identity persists across servers while disclosing only server-allowed UID/proof material.

## 5) Server Configuration Model

### Server profile fields (planned)
- `server_id` (client-local stable identifier)
- `display_name`
- `backend_url`
- `icon_url` (optional)
- `identity_handshake_strategy` (challenge-signature/token-proof/etc.)
- `user_identifier_policy` (server-scoped UID vs global UID acceptance)
- `capabilities` (feature matrix returned by backend)
- `tls_fingerprint` (optional pinning metadata)
- `connection_policy` (timeouts/retries/backoff)
- `data_policy` (retention/cache behavior for client)

### Join flow
1. User enters invite or backend URL.
2. Client validates URL and performs capability probe.
3. Client displays trust, security warnings, and identity disclosure summary.
4. User confirms join.
5. Server profile is stored locally and rendered in server rail.

### Trust and warnings
- Distinguish verified vs unverified servers.
- Prominent warning for insecure transport or certificate mismatch.
- Explain exactly what data permissions the server requests.
- Explicitly show that only unique user identifier/proof data is shared by default.

## 6) Planned Feature Matrix

### Foundation features (MVP)
- User-owned identity and session UI.
- Server switching and server profile management.
- Channel list and channel navigation.
- Message timeline rendering (text, basic embeds, attachments list).
- Composer with markdown-lite and mentions.
- Presence/typing indicators.
- Notifications (desktop + in-app).
- Basic settings: appearance, keybinds, audio notifications, accessibility.

### Post-MVP features
- Voice/video surfaces (UI and device controls).
- Threading and forum-style channels.
- Message search and local indexing hooks.
- Rich media preview system.
- Permissions inspector UI.
- Server capability dashboard for advanced diagnostics.

### Cross-cutting feature requirements
- Offline/poor-network behavior states.
- Per-feature error boundaries.
- Accessibility (keyboard, screen reader semantics, contrast).
- Internationalization readiness.
- Telemetry opt-in with privacy-first defaults.
- Privacy disclosure UX in identity/join flows (clear "what leaves device" messaging).

## 7) Documentation Strategy (Open Source)

### Documentation goals
- Every planned feature has a dedicated spec before implementation.
- Decisions are captured in ADRs (Architecture Decision Records).
- Contributor path from first issue to merged PR is explicit and short.

### Documentation structure (planned)
- `README.md` (project overview, quickstart, status, links)
- `docs/architecture/` (system design, ADRs, diagrams)
- `docs/features/` (one spec per feature)
- `docs/security/` (threat model, reporting, hardening)
- `docs/contributing/` (setup, workflows, coding standards)
- `docs/release/` (versioning, changelog, release checklist)

### Feature spec template (required for each feature)
- Problem statement.
- User stories and UX flows.
- API/capability assumptions from backend.
- UI states (loading, empty, error, degraded).
- Data model and client state impact.
- Security/privacy considerations.
- Accessibility requirements.
- Test strategy (unit/integration/e2e/manual).
- Rollout plan and success criteria.

## 8) Build and Release Pipeline Plan

### Tooling direction
- Package manager standardized on `yarn` (repository default, `node-modules` linker).
- Scripts standardized via root config.
- Renderer build tooling centered on `Vite` + `Vue`.
- Linting, type checks, unit tests, and UI tests in CI.
- Electron packaging for macOS/Windows/Linux artifacts.

### UI library standards (PrimeVue unstyled)
- Keep PrimeVue in unstyled mode globally.
- Theme through local tokens only (colors, spacing, radius, typography, motion).
- Disallow direct app-wide use of PrimeVue default presets.
- Document each wrapped PrimeVue component in `docs/features/` or `docs/architecture/design-system.md`.

### CI stages (proposed)
1. `validate`:
   - `yarn install --immutable`
   - lint
   - format check
   - type check
2. `test`:
   - unit tests
   - integration tests
   - renderer smoke tests
3. `build`:
   - production bundle
   - Electron package
4. `security`:
   - dependency audit
   - secret scanning
   - static analysis
5. `release`:
   - signed artifacts
   - checksums
   - changelog + release notes

### Branch and release strategy
- Trunk-based development with short-lived branches.
- Protected `main` branch with required checks.
- Semantic versioning.
- Nightly builds (optional) and stable tagged releases.

## 9) Contributing Plan

### Contributor experience
- One-command local startup.
- First-time contributor guide with issue labels:
  - `good first issue`
  - `help wanted`
  - `area:*`
- PR template requiring:
  - user-facing behavior summary
  - screenshots/video for UI changes
  - test coverage notes
  - docs update confirmation

### Review policy
- At least one maintainer approval.
- Required status checks green.
- No merge without corresponding docs for behavior changes.
- Security-impacting changes require security reviewer signoff.

### Governance
- CODEOWNERS for key surfaces.
- RFC process for major architecture/product changes.
- Decision records linked from PRs.

## 10) Security Plan

### Security objectives
- Minimize Electron attack surface.
- Prevent cross-server data contamination.
- Protect tokens/session data at rest and in transit.
- Preserve user-owned identity data as local-only by default.

### Baseline controls
- Context isolation enabled.
- Node integration disabled in renderer by default.
- Strict IPC contract validation.
- CSP policy for renderer content.
- Secure credential storage via OS keychain APIs.
- Redaction rules for logs.
- UID-only disclosure boundary for server communication unless explicitly expanded by ADR.

### Supply chain and dependency posture
- Locked dependencies.
- Automated vulnerability scanning.
- SBOM generation at release.
- Dependency update cadence and triage SLA.

### Vulnerability handling
- `SECURITY.md` with private disclosure channel.
- Defined severity triage and response timelines.
- Patch release process for critical vulnerabilities.

## 11) README and Repo Docs Plan

### Root README sections
- What OpenChat Client is (and is not).
- Feature status matrix (planned/in progress/stable).
- Screenshots and UX principles.
- Local development quickstart.
- Contribution links.
- Security disclosure link.
- License and governance links.

### Supporting top-level files
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `SUPPORT.md`
- `LICENSE`
- `CHANGELOG.md`

## 12) Quality and Testing Strategy

### Testing layers
- Unit tests for pure logic and state transitions.
- Component tests for UI behavior.
- Integration tests for server-connection flows.
- E2E smoke tests for critical paths:
  - login
  - join server
  - channel switch
  - send message
  - reconnect behavior

### Quality gates
- All CI checks required on pull requests.
- No unchecked accessibility regressions.
- No undocumented user-facing changes.
- No undocumented expansion of user data disclosure to backend services.

## 13) Initial Milestones

### Milestone 0: Project foundation
- Repo bootstrap, toolchain, lint/test scaffolding.
- Core docs (`README`, `CONTRIBUTING`, `SECURITY`, ADR index).

### Milestone 1: Multi-server shell
- App shell, server rail, server profile storage.
- Connection manager with status indicators.

### Milestone 2: Core messaging UX
- Channel list, message timeline, composer.
- Basic notifications and unread states.

### Milestone 3: Hardening and open-source readiness
- Security baseline controls complete.
- CI/CD release pipeline stable.
- Contributor and feature documentation complete.

## 14) Explicit Repository Constraints
- This repository must contain **no backend service code**.
- Any backend assumptions must be documented as interface contracts only.
- All server-specific behavior must be mediated through client capability negotiation and configuration.

## 15) Definition of Done (Planning Stage)
- Planning documents exist for all MVP features.
- Build/release/contribution/security plans are documented and versioned.
- Repository documentation skeleton is complete and internally linked.
- Scope boundaries are explicit and enforceable in reviews.
