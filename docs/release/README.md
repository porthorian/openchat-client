# Release Documentation

This directory contains release process documentation for OpenChat Client.

## Planned Documents
- Release checklist and approval gates.
- Artifact signing and checksum procedure.
- Versioning and changelog update process.
- Rollback and hotfix process.
- Milestone tracking: `docs/release/milestones.md`

## Current State
Release automation is active via GitHub Actions workflows:
- CI validation: `.github/workflows/client-ci.yml`
- Cross-platform release orchestration: `.github/workflows/release-desktop.yml`
- Platform jobs:
  - `.github/workflows/release-desktop-linux.yml`
  - `.github/workflows/release-desktop-windows.yml`
  - `.github/workflows/release-desktop-macos.yml`
