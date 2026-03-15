<!--
Sync Impact Report
==================
Version change: 0.0.0 → 1.0.0 (initial ratification)
Modified principles: N/A (first version)
Added sections:
  - Core Principles (5): Local-First, Data Integrity, Type Safety,
    Simplicity, Extensibility
  - Technology Stack
  - Development Workflow
  - Governance
Removed sections: N/A
Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ no changes needed
    (Constitution Check section is generic, references this file)
  - .specify/templates/spec-template.md: ✅ no changes needed
    (spec template is principle-agnostic)
  - .specify/templates/tasks-template.md: ✅ no changes needed
    (task template is principle-agnostic)
Follow-up TODOs: none
-->

# Birdbrain Constitution

## Core Principles

### I. Local-First & Privacy

All user data MUST remain on the user's machine by default. The
application MUST NOT transmit captured data, browsing history, or
investigation metadata to any remote service unless the user
explicitly initiates the action (e.g., choosing to send content to
an AI provider via OpenRouter). No telemetry, analytics, or
phone-home behavior is permitted. External API calls (e.g., AI
analysis) MUST be opt-in and MUST clearly disclose what data leaves
the device.

### II. Data Integrity

Every capture MUST be verified with SHA-256 hashing to establish
provenance and chain of custody. Stored captures MUST be immutable
once written; modification of captured content is prohibited.
Export artifacts (PDF, HTML reports) MUST include integrity
metadata so recipients can independently verify authenticity.
Database operations MUST use WAL mode and atomic transactions to
prevent corruption.

### III. Type Safety

TypeScript strict mode MUST be enabled across all packages. IPC
channels between Electron processes MUST be fully typed via the
shared type definitions in `src/shared/`. Use of `any` is
prohibited except where interfacing with untyped third-party
libraries, and such usage MUST be isolated behind typed wrappers.
All new code MUST pass `pnpm lint` without errors.

### IV. Simplicity / YAGNI

Features MUST solve a current, demonstrated need — not a
hypothetical future one. Prefer inline logic over premature
abstractions; three similar lines of code are better than a
one-use helper. New files MUST be justified by clear integration
into the existing architecture. Configuration surfaces MUST be
minimal; sensible defaults over knobs. Avoid backwards-
compatibility shims — if something is unused, remove it.

### V. Extensibility

The architecture MUST support extension points without modifying
core code. The Chrome extension communicates with the Electron app
via the Hono capture server, keeping both sides independently
deployable. New capture sources (browser extensions, CLI tools,
importers) MUST integrate through the existing HTTP capture API.
AI analysis pipelines MUST be composable (entity extraction,
relationship mapping, pattern detection) so new stages can be
added without rewriting the queue infrastructure.

## Technology Stack

- **Runtime**: Electron (main + renderer + preload process model)
- **UI**: React 19, Tailwind CSS v4, Zustand for state management
- **Database**: SQLite via better-sqlite3, WAL mode, migration via
  `user_version` pragma
- **Capture Server**: Hono HTTP server in the main process
- **AI**: OpenRouter API (BYOK), async job queue
- **Browser Extension**: Chrome Manifest V3 (content script +
  background + popup)
- **Build**: electron-vite, pnpm
- **Testing**: Vitest (unit), Playwright (E2E)
- **Language**: TypeScript (strict mode), React JSX transform
- **Code Style**: No semicolons, single quotes, no trailing commas,
  100-char print width, 2-space indent

Additions or replacements to the stack MUST be documented in this
section and approved through the governance amendment process.

## Development Workflow

- **Branching**: Feature branches off `master`; PRs required for
  non-trivial changes.
- **Testing**: All new services and IPC handlers MUST have
  corresponding Vitest unit tests. E2E tests (Playwright) MUST
  cover critical user flows. Tests MUST pass before merge
  (`pnpm test`).
- **Linting & Formatting**: `pnpm lint` and `pnpm format` MUST
  pass. CI SHOULD enforce this automatically.
- **Commits**: Conventional commit messages encouraged
  (feat/fix/docs/refactor). Commits MUST NOT include secrets,
  credentials, or API keys.
- **Code Review**: Changes to shared types (`src/shared/`),
  database schema, or IPC channels require careful review for
  backward compatibility.
- **Native Deps**: After changing native dependencies
  (better-sqlite3), run `pnpm rebuild:electron`.

## Governance

This constitution is the authoritative source for project-wide
non-negotiable rules. All contributions — whether from human
developers or AI agents — MUST comply with these principles.

**Amendment Process**:
1. Propose the change with rationale in a PR or discussion.
2. Update this file with the new or modified principle.
3. Increment the version using semantic versioning:
   - MAJOR: Principle removed or fundamentally redefined.
   - MINOR: New principle or section added, or material expansion.
   - PATCH: Clarification, wording fix, or non-semantic refinement.
4. Update `LAST_AMENDED_DATE` to the date of the change.
5. Run the consistency propagation checklist: verify that
   plan, spec, and task templates remain aligned.

**Compliance**: All PRs and code reviews SHOULD verify adherence
to these principles. Violations MUST be justified in writing
(e.g., in the Complexity Tracking table of a plan document) or
resolved before merge.

**Version**: 1.0.0 | **Ratified**: 2026-03-15 | **Last Amended**: 2026-03-15
