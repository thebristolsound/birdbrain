# Redesign program: `ultracode` session prep (wave 1)

Prepared 2026-08-19. Parent specification: #382. Feasibility: `docs/specs/2026-08-11-design-handoff-feasibility-assessment.md`. Pixel truth: the `prototype/design-handoff-2026-08` branch, `design_handoff_birdbrain_prototype/` (`Birdbrain.dc.html` inline styles; `README.md` for behavior).

## Program state

Done: #383 (scoping docs), #384 (stage 0 tokens), #385 (density setting), #386 (capture-UI suppression), #388 (references-index spike), #394 (batch operations backend), #421 and #425 (density fixes).

Open feature tickets: #387, #389 to #393, #395 to #406. Redesign bugs riding along: #534 (`ready-for-agent`), #563, #622 (`evidence-affecting`).

Each ticket's "Blocked by" section is now encoded as native GitHub issue dependencies (17 edges, created 2026-08-19). `issue_dependencies_summary.blocked_by` counts open blockers only, so the frontier is a live query: a ticket showing `blocked_by=0` is workable now.

## Wave 1: the current frontier

Every open ticket with zero open blockers:

| Ticket | Area | Evidence-affecting |
| --- | --- | --- |
| #387 popup case select and ignore pre-filter | extension | no |
| #389 Mention schema and references index | `noteDoc`, new db repository and migration, IPC, `caseArchive` | yes; ruled by Matt 2026-08-19, label applied (Case Archive schema bump) |
| #395 selector origin | migration, `selectorRepo`, creation paths, archive round-trip | no |
| #396 multi-select UI and floating bar | `appStore`, `captures/` list, e2e | no (backend #394 already carried the manifest work) |
| #397 three-column layout rework | `captures/` viewer and panels | no |
| #400 per-case auto-capture exclusions | migration, `captureServer`, Signals UI, extension mirror | yes; label applied |
| #403 cross-case recent-activity feed | repository-layer query, `dashboard/` | no |
| #563 wizard description input on wrong background token | `dashboard/cases/NewCaseWizard` | no |
| #622 diagnostics: surface unreconciled deletion entries | `diagnosticsRepo`, diagnostics panel | yes; label already on the issue |

The two redesign bugs join the wave by maintainer ruling (2026-08-19). Both have zero blockers, and their diffs overlap nothing else in the wave.

Not in wave 1 despite earlier drafts: #401 (the archive.org compare panel) is blocked by #398. Everything else waits on #389, #387, or the export chain (#396 -> #398 -> #399 -> #401 and #405).

## Conflict map: what can run in parallel

- `src/main/services/db/migrations.ts` is the hot spot. #389, #395, and #400 each append an `if (version < N)` block and bump `LATEST_SCHEMA_VERSION` in `core.ts`. Three parallel agents will conflict three ways. Either run these three serially, or have each agent write its migration block last against a refreshed tree, merging in a fixed order: #389, then #395, then #400. #389 goes first because it is the load-bearing schema and the declared schedule risk.
- `captures/`: #396 and #397 both rework the capture list and viewer area. Same agent or strict sequence, #396 first; #397's resize and collapse work wraps what #396 edited.
- `selectors/` UI: #395 (row detail) and #400 (Signals exclusion section) edit the same screen lightly. Tolerable in parallel; the second to land resolves against the first.
- Extension: #387 and #400's mirror-feedback part both edit `extension/src`. #387 owns the popup; keep #400's extension delta minimal.
- Independent: #403 (dashboard plus one repository query) conflicts with nothing.

## Session process rules

- Identity per the #561 decision: agent-written diffs open as `birdbrain-agent`, draft, labelled `agent-authored` (off-slot, so they do not consume the `agent-pr` serial slot). The reviewer pre-pass applies to every one.
- Evidence-affecting PRs in the wave (#389, #400, #622; later #392, #398, #399; all labels applied 2026-08-19) carry the label plus an Evidence impact section, get human review, and never auto-merge (ADR-0004 and ADR-0005).
- Verify loop per PR: `pnpm lint`, `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`, `pnpm build`, plus `pnpm build:extension` when `extension/` changed, plus `pnpm test:coverage` and `pnpm coverage:diff` (CI fails under 90 percent changed-line coverage; re-run both after any edit).
- Definition of done per screen, from the handoff: pixel-match at compact density, hover, empty, and keyboard states per the bundle's Interactions section, tokens only, legible at all three density steps.
- Anything infeasible as designed: send back the constraint, never a redesign; the prototype gets revised.

## Suggested workflow shape

One Workflow call per phase, with Matt reading results between phases:

1. Understand. Parallel readers: prototype bundle sections per ticket, current component tree per area, the #388 spike verdict for #389. Output: per-ticket implementation notes with file lists, which sharpen the conflict map.
2. Implement. One agent per ticket with `isolation: 'worktree'`, migration tickets serialized per the conflict map's merge order. Each ends with the full verify loop and a draft `agent-authored` PR.
3. Review. Adversarial verify per PR: pixel and acceptance-criteria conformance against the prototype, evidence-gate compliance for #389, #400, and #622, test-seam coverage per the specification's Testing Decisions section.

Wave 2 opens the day #389 merges: `blocked_by` drops to zero on #390, #392, and #402 automatically.

## Open items

None. Both prior items were ruled 2026-08-19: #389 is evidence-affecting (label applied, ruling recorded on the issue), and the redesign bugs #563 and #622 ride in wave 1.
