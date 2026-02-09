# Security Policy

Security matters for this project because it handles credentials, untrusted server endpoints, and desktop runtime privileges.

## Supported Versions
| Version | Supported |
| --- | --- |
| 0.x (current pre-release line) | Yes |
| older pre-release lines | No |

## Reporting a Vulnerability
1. Do not open public issues for vulnerabilities.
2. Use GitHub Security Advisories for private disclosure when available.
3. If advisories are unavailable, contact maintainers through private channels listed in repository metadata.

Include:
- impact summary
- affected components
- reproduction steps
- proof-of-concept details if available

## Response Targets
- Acknowledge report within 2 business days.
- Initial triage within 5 business days.
- Share remediation plan and expected timeline after triage.

## Security Baselines
- Context isolation enabled in Electron renderer architecture.
- Node integration disabled in renderer by default.
- Strict IPC contract validation.
- Secure storage for credentials via OS keychain mechanisms.
- No token persistence in plain local storage.
- Server-scoped state isolation to prevent data leakage across servers.

## Responsible Disclosure
Please give maintainers reasonable time to patch before public disclosure.
