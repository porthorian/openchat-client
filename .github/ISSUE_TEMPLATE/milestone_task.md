---
name: Work Item
about: Track an implementation task from milestones, specs, ADRs, or maintenance work.
title: "[Task] "
labels: ["type:task", "needs-triage"]
assignees: ""
---

## Summary

<!-- One or two sentences describing what should be done. -->

## Source Context (optional)

- Source type: <!-- milestone / feature spec / ADR / maintenance / other -->
- Source file or link: <!-- e.g. docs/release/milestones.md -->
- Source item/reference:
  - [ ] <!-- copy a checklist item, requirement, or reference link -->

## Problem / Goal

<!-- What problem does this solve, or what goal does it support? -->

## Scope

### In scope

- 

### Out of scope

- 

## Proposed Approach

<!-- High-level implementation notes and impacted areas. -->

## Acceptance Criteria

- [ ] Goal is implemented and verifiable
- [ ] States handled: loading, empty, error, degraded (if applicable)
- [ ] Security/privacy constraints are respected (if applicable)
- [ ] No cross-server data leakage (`server_id` scoped) where relevant
- [ ] User-facing behavior/docs updated where relevant

## Test Plan

- [ ] Unit tests (if applicable)
- [ ] Component/integration tests (if applicable)
- [ ] Manual verification steps documented

### Manual verification

1. 
2. 
3. 

## Dependencies / Related

<!-- Link related issues/PRs and any sequencing constraints or blockers. -->

## Definition of Done

- [ ] Acceptance criteria complete
- [ ] Tests pass locally/CI (if applicable)
- [ ] Docs are updated (if needed)
- [ ] Ready for review
