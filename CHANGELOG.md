# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Initial planning document in `AGENTS.md`.
- Project documentation scaffold:
  - `README.md`
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `CODE_OF_CONDUCT.md`
  - `SUPPORT.md`
  - architecture and feature documentation directories
- Initial ADR set in `docs/architecture/adrs/`:
  - stack decision (Electron + Vue 3 + PrimeVue unstyled)
  - state architecture decision (Pinia)
  - client-only boundary decision
  - multi-server isolation decision
- Architecture docs:
  - backend contract document
  - design-system architecture document
- MVP feature specs:
  - auth/session UI
  - server join and registry
  - channel navigation
  - message timeline and composer
  - notifications
  - settings and accessibility
- Open-source workflow files:
  - issue templates
  - pull request template
  - `CODEOWNERS`
- Milestone tracking document in `docs/release/milestones.md`
- User-owned identity and privacy boundary updates:
  - UID-only server disclosure model documented
  - backend contract revised for identity binding and profile-local policy
  - identity/session and related feature specs updated for UX disclosure requirements
  - ADR-0005 added to formalize the decision
- Initial implementation scaffold:
  - Electron main/preload runtime with secure defaults and typed IPC
  - Vue 3 renderer wired with Pinia and PrimeVue in unstyled mode
  - initial stores for app UI, identity, server registry, and sessions
  - first-pass Discord-like shell layout with UID disclosure banner
