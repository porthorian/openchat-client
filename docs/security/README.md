# Security Documentation

This directory contains security-specific design and operational documents for the client.

## Planned Documents
- Threat model for Electron client runtime and renderer boundaries.
- Credential handling and secure storage strategy.
- Server trust and certificate warning UX.
- User-owned identity and UID-only disclosure boundary controls.
- Incident response playbook references.

## Policy Reference
See root `SECURITY.md` for vulnerability reporting and disclosure policy.

## macOS Signing and Entitlements
- Release signing/notarization uses Developer ID distribution with App Store Connect API key credentials.
- The workflow expects: `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- `electron-builder.yml` points to `build/entitlements.mac.plist` for hardened runtime signing.

### Media and Network Entitlement Clarification
- The entitlements file includes:
  - `com.apple.security.device.audio-input`
  - `com.apple.security.device.camera`
  - `com.apple.security.network.client`
  - `com.apple.security.network.server`
- In the current non-App-Store Developer ID flow (App Sandbox disabled), network access is not gated by sandbox entitlements.
- `electron-builder.yml` sets `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, and `NSScreenCaptureDescription` via `mac.extendInfo` so macOS can present runtime privacy prompts in notarized builds.
