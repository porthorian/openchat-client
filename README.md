![OpenChat Logo](logo_sideways.png)

OpenChat Client is an open-source Electron desktop app with a Discord-like UX where each joined server maps to an independent backend endpoint.

![OpenChat Client](docs/images/screen.png)

## Release Stage
- Project maturity: `Pre-Alpha`
- Stability expectation: interfaces and behavior may change without backward compatibility until Beta.

## Project Snapshot
What this repository is:
- A desktop client built with `Electron`, `Vue 3`, `Pinia`, and `PrimeVue` (unstyled).
- A multi-server client with isolated server-scoped state and trust boundaries.
- A frontend-first open-source project with ADRs, feature specs, and milestone tracking.

What this repository is not:
- Not a backend service repository.
- Not a deployment/infrastructure repo for backend runtime.
- Not a place for server-side business logic implementation.

## Current Project Status
- Milestone `M0` (Project Foundation): `done`
- Milestone `M1` (Multi-Server Shell): `done`
- Milestone `M2` (Core Messaging UX): `done`
- Milestone `M3` (Hardening and Open-Source Readiness): `in_progress`

Details: `docs/release/milestones.md`

## Feature Snapshot
| Area | Status |
| --- | --- |
| Server discovery/join + trust probe | Implemented |
| Multi-server switching/isolation | Implemented |
| Text channels + message timeline/composer | Implemented |
| Realtime messaging + typing + presence | Implemented |
| Voice channel join + audio relay controls | Implemented baseline (hardening in progress) |
| Video/screenshare surfaces | Implemented baseline (hardening in progress) |
| Client update checks + install flow | Implemented baseline |
| Settings/accessibility deep pass | In progress |
| Moderation/governance UX | Planned |

## Getting Started
Prerequisites:
- Node.js `>= 23.9.0` (Node `24` recommended, matches CI)
- Corepack (`corepack enable`)

Install dependencies and run the app:
```bash
corepack enable
corepack prepare yarn@4.12.0 --activate
corepack yarn install --immutable
corepack yarn dev
```

Run quality checks:
```bash
corepack yarn test:security
corepack yarn typecheck
corepack yarn build
```

## Backend Setup (Local or Remote)
Companion backend repository:
- GitHub: [openchat-backend](https://github.com/porthorian/openchat-backend)

Stand up a local backend:
1. Clone/open `openchat-backend`.
2. Follow the backend repository README to boot the API locally.
3. Confirm the backend is serving `GET /v1/servers`.
4. Start this client against that backend URL (example below).

Optional RTC debug logging:
```bash
VITE_OPENCHAT_RTC_DEBUG=1 corepack yarn dev
```

The client performs capability probing before join and warns when transport/security expectations are not met.

## Scripts Reference
| Script | Purpose |
| --- | --- |
| `corepack yarn dev` | Start Electron + renderer in development mode |
| `corepack yarn typecheck` | Run `vue-tsc` + TypeScript checks |
| `corepack yarn test:security` | Run message-formatting security tests |
| `corepack yarn build` | Build production bundles |
| `corepack yarn pack` | Produce unpacked desktop bundles |
| `corepack yarn dist` | Produce installable release artifacts in `release/` |

## Production Builds and Installers
For end users, use release artifacts from GitHub Releases.

Maintainer local packaging:
```bash
corepack yarn pack
corepack yarn dist
```

Release pipeline:
- Tag format: `vX.X.X`
- Workflows:
  - `.github/workflows/release-desktop.yml`
  - `.github/workflows/release-desktop-linux.yml`
  - `.github/workflows/release-desktop-windows.yml`
  - `.github/workflows/release-desktop-macos.yml`
- Targets: macOS, Windows, Linux installers + release asset publish

Signing/notarization secrets (optional but recommended):
- macOS (Developer ID + App Store Connect API key): `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
- Windows: `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD`

Unsigned builds still generate artifacts, but OS trust warnings are expected.

macOS entitlement note:
- `build/entitlements.mac.plist` includes media keys (`com.apple.security.device.audio-input`, `com.apple.security.device.camera`) and network keys (`com.apple.security.network.client`, `com.apple.security.network.server`).
- `electron-builder.yml` sets `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, and `NSScreenCaptureDescription` so notarized builds can display required runtime privacy prompts.
- For the current non-App-Store Developer ID flow (App Sandbox disabled), network access is already allowed; network entitlements are relevant if App Sandbox is enabled later.

## Open Source Project Docs
Core governance and community docs:
- Project overview and onboarding: `README.md`
- Companion backend server: [openchat-backend](https://github.com/porthorian/openchat-backend)
- Contributing: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- Support: `SUPPORT.md`
- Changelog: `CHANGELOG.md`
- License: `LICENSE.md`

Architecture and feature planning docs:
- Planning and constraints: `AGENTS.md`
- Architecture index: `docs/architecture/README.md`
- ADR index: `docs/architecture/adrs/README.md`
- Backend contract: `docs/architecture/backend-contract.md`
- Design system notes: `docs/architecture/design-system.md`
- Feature specs: `docs/features/README.md`
- Release milestones: `docs/release/milestones.md`

## Contributor Expectations
- Keep changes client-only (no backend implementation code in this repo).
- Preserve multi-server data isolation by `server_id`.
- Preserve UID-only disclosure boundaries unless explicitly expanded by ADR.
- For user-facing behavior changes, update docs and include tests/evidence in PRs.

## Contributing
Contributions are welcome.

Start here:
1. Read `CONTRIBUTING.md`.
2. Review open issues/discussions and relevant feature specs.
3. For major behavior or architecture changes, propose updates early via issue + ADR/feature spec.

Issue and PR templates:
- `.github/ISSUE_TEMPLATE/`
- `.github/pull_request_template.md`

CI and validation workflow:
- `.github/workflows/client-ci.yml`

## Security
For vulnerability reporting and policy, see `SECURITY.md`.

## Support
For usage questions and bug reporting flow, see `SUPPORT.md`.

## License
This project is licensed under GNU General Public License v2.0 only (`GPL-2.0-only`).
See `LICENSE.md` for the full license text.
