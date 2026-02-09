# Contributing to OpenChat Client

Thanks for contributing. This project is in early planning and documentation-first execution.

## Repository Scope
- This repository is strictly for the client UI and client runtime integration.
- Do not add backend service implementations here.
- Backend assumptions should be documented as interface contracts only.

## Contribution Workflow
1. Open or reference an issue.
2. For user-facing features, add or update a feature spec first.
3. For architecture changes, add or update an ADR.
4. Submit a pull request with tests and documentation updates.

## Ground Rules
- Keep changes scoped and reviewable.
- Prefer explicit decisions over implicit behavior.
- Preserve multi-server isolation requirements.
- Follow security baseline requirements in `SECURITY.md`.
- Preserve UID-only identity disclosure policy unless a new ADR explicitly approves changes.

## Pull Request Expectations
- Clear summary of user-visible behavior changes.
- Rationale for technical approach.
- Updated documentation when behavior, architecture, or policy changes.
- Screenshots or short recordings for UI changes.
- Notes on test coverage and known risks.

## Branching and Reviews
- Work from short-lived branches.
- Keep `main` protected with required checks.
- Require at least one maintainer approval.
- Security-impacting changes require security review.

## Documentation Requirements
- Use `docs/features/FEATURE_TEMPLATE.md` for feature specs.
- Add architecture decisions to `docs/architecture/adrs/`.
- Keep links and indices updated when adding files.
- Update milestone status in `docs/release/milestones.md` when scope or target milestone changes.

## Issue and PR Templates
- Use the templates in `.github/ISSUE_TEMPLATE/` for new issues.
- Use `.github/pull_request_template.md` when opening pull requests.

## Code of Conduct
All participants must follow `CODE_OF_CONDUCT.md`.
