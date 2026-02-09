# Design System Architecture

This document defines how the renderer UI is built with Vue 3, PrimeVue (unstyled), and local design-system wrappers.

## 1) Goals
- Deliver a Discord-like interaction model with a fully custom visual language.
- Keep accessibility and interaction behavior predictable.
- Prevent direct dependency on component-library default styling.
- Make privacy boundaries visible in UX, especially UID-only disclosure during server join and identity flows.

## 2) Layering Model
- `tokens`: color, spacing, typography, radii, elevation, motion.
- `primitives`: wrapped PrimeVue components and low-level custom controls.
- `composites`: reusable app patterns (channel row, server item, message bubble).
- `screens`: feature-specific assembly of composites.

## 3) PrimeVue Usage Rules
- PrimeVue runs in unstyled mode globally.
- Product features should consume local wrappers, not raw PrimeVue components.
- Wrapper components own:
  - ARIA and keyboard defaults
  - class hooks for tokens
  - event normalization for app usage

## 4) Token System

### Token groups
- Color tokens: surface, text, semantic states, brand accents.
- Spacing tokens: stack, inline, panel, and density scales.
- Typography tokens: font family, size scale, weight, line height.
- Shape tokens: radius and border widths.
- Motion tokens: durations and easing curves.

### Token requirements
- Tokens are named semantically, not by raw color value.
- All major surfaces and states must use tokens.
- Any hard-coded style exception requires review note.

## 5) Component Ownership

### Core wrappers (initial set)
- Button
- Input/Textarea
- Dialog/Popover
- Menu/Dropdown
- Tooltip
- VirtualScroller wrappers for timeline lists

### Product composites (initial set)
- Server rail item
- Channel tree item
- Message row
- Composer shell
- Notification toast
- Data disclosure panel (what is shared with server)

## 6) Accessibility Baseline
- Keyboard traversal and focus ring visibility on all interactive components.
- ARIA attributes mapped by wrapper defaults.
- Minimum contrast targets documented per token set.
- Reduced motion support for key animations.

## 7) Responsiveness and Density
- Desktop-first layouts with constrained mobile and narrow-window behavior.
- Density modes should be token-driven.
- No fixed dimensions for primary text surfaces.

## 8) Testing Requirements
- Component tests for wrapper behavior and state classes.
- Visual regression snapshots for core composites.
- Accessibility checks for keyboard/focus/screen-reader semantics.

## 9) Documentation Requirements
- Every new wrapper must be documented with:
  - intended use
  - props/events contract
  - accessibility behaviors
  - style token dependencies

## 10) Governance
- Design-system changes require:
  - doc update in architecture or feature spec
  - review from maintainers responsible for UI consistency
