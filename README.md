![OpenChat Logo](logo_sideways.png)

OpenChat Client is an open-source Electron desktop app with a Discord-like UX where each joined server maps to an independent backend endpoint.

![OpenChat Client](image.png)

## What This Repository Is
- A desktop client built with `Electron`, `Vue 3`, `Pinia`, and `PrimeVue` (unstyled).
- A multi-server client with isolated server-scoped state and trust boundaries.
- A frontend-first open-source project with ADRs, feature specs, and milestone tracking.

## What This Repository Is Not
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
| Voice channel join + audio relay controls | In progress |
| Settings/accessibility deep pass | Planned |
| Moderation/governance UX | Planned |

## Quickstart (Development)
Prerequisites:
- Node.js `>= 20`
- Corepack enabled (`corepack enable`)

Install and run:
```bash
corepack prepare yarn@4 --activate
corepack yarn install --immutable
corepack yarn dev
```

Quality checks:
```bash
corepack yarn typecheck
corepack yarn build
```

## Backend Connection for Local Testing
- Default backend URL: `http://localhost:8080`
- Override with env var: `VITE_OPENCHAT_BACKEND_URL`
- Server directory endpoint expected by client: `/v1/servers`

## Troubleshooting
### App shows `Unknown Server` / fails to fetch server list
- Verify backend is running and reachable at `VITE_OPENCHAT_BACKEND_URL` (default `http://localhost:8080`).
- Confirm `GET /v1/servers` returns a valid response.
- If browser works but Electron does not, check CSP settings for local HTTP dev endpoints.

### Electron reports preload/runtime bridge errors
- Symptom: preload load failure, `Cannot use import statement outside a module`, or runtime bridge unavailable.
- Rebuild and restart dev runtime:
```bash
corepack yarn build
corepack yarn dev
```
- Ensure preload output format and Electron preload path are aligned with current build config.

### Electron blocks backend calls with CSP error
- Symptom: `Refused to connect to 'http://localhost:8080' ... connect-src ...`
- Update renderer CSP to allow your local backend origin during development.
- Keep production CSP strict and only relax dev origins intentionally.

### Add-server action fails in Electron
- Symptom: UI action throws on `prompt()` or similar browser-only behavior.
- Use in-app modal/dialog based flows instead of browser global prompts.

### No audio when joining voice
- Check OS microphone permission for the app.
- Confirm input device is selected in Input Options.
- Verify output device and output volume are set correctly.
- If output device switching is unsupported in your runtime, use system default output.

### Others cannot hear your mic
- Ensure mic is unmuted in the call controls.
- Confirm input volume is above `0`.
- Speak and verify speaking indicator (green ring) appears.
- Re-select input device to restart capture if hardware changed while connected.

### macOS installer says app is damaged / cannot be opened
- This usually indicates unsigned/unnotarized artifacts.
- For distribution, use signed + notarized release artifacts from CI.
- For local/dev artifacts, Gatekeeper warnings are expected unless signing is configured.

### Windows shows SmartScreen/untrusted publisher warning
- Unsigned builds trigger reputation/publisher warnings.
- Use code-signed release artifacts for normal end-user install experience.

## Production Builds and Installers
For end users, use release artifacts from GitHub Releases.

Maintainer local packaging:
```bash
corepack yarn pack   # unpacked app output
corepack yarn dist   # platform installer artifacts in release/
```

Release pipeline:
- Tag format: `client-vX.X.X`
- Workflow: `.github/workflows/release-desktop.yml`
- Targets: macOS, Windows, Linux installers + release asset publish

Signing/notarization secrets (optional but recommended):
- macOS: `APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD`

Unsigned builds still generate artifacts, but OS trust warnings are expected.

## Documentation Map
- Planning and constraints: `AGENTS.md`
- Contributing: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Support: `SUPPORT.md`
- Architecture index: `docs/architecture/README.md`
- ADR index: `docs/architecture/adrs/README.md`
- Backend contract: `docs/architecture/backend-contract.md`
- Design system notes: `docs/architecture/design-system.md`
- Feature specs: `docs/features/README.md`
- Release milestones: `docs/release/milestones.md`

## Contributing
Contributions are welcome.

Start here:
1. Read `CONTRIBUTING.md`.
2. Check open milestones and feature specs.
3. Open an issue/proposal for major behavior changes.

## Security
For vulnerability reporting and policy, see `SECURITY.md`.

## License
License will be finalized before first public release candidate.
