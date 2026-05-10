# Birdbrain docs

Author-time documentation for the project. Some folders are tracked (durable design decisions and conventions); `plans/` is gitignored (ephemeral working notes).

## Layout

| Folder       | Purpose                                                                                                                    | Naming convention                                                            | Tracked?            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| `reference/` | Long-lived technical documentation. Stable, edited in place as the system evolves.                                         | `<topic>.md`                                                                 | yes                 |
| `specs/`     | Design specs, design briefs, spikes, and assessments. Decisions captured at design time; treat as immutable once approved. | `YYYY-MM-DD-<slug>-design.md`, `-spike.md`, `-assessment.md`, or `-brief.md` | yes                 |
| `adr/`       | Architecture Decision Records.                                                                                             | `NNNN-<slug>.md`                                                             | yes                 |
| `plans/`     | Implementation plans, migration trackers, and operational checklists. Living documents — checked off as work progresses.   | `YYYY-MM-DD-<slug>.md`                                                       | **no — gitignored** |
| `archive/`   | Superseded specs moved out of the active folders.                                                                          | Original filename preserved                                                  | yes                 |
| `superpowers/` | Output from the superpowers agent skill — managed by tooling, do not hand-edit.                                          | Tool-managed                                                                 | yes (frozen)        |

`plans/` is intentionally gitignored: implementation checklists are author-time artifacts, they get checked off and rot, and bundling them into feature PRs creates noise. Write them, refer to them locally, and let them disappear with the working tree. Tracked durable docs (specs, ADRs, reference) **must be committed in their own PR** — never bundled with a `src/**` change.

## Conventions

- New design or spec? Drop it in `specs/` with today's date as the prefix.
- New implementation plan? Drop it in `plans/` with today's date as the prefix (will not be tracked).
- Superseding an existing doc? Move the old file to `archive/` (keep its original name) before adding the replacement.
- Permanent technical reference (architecture, pipelines, protocols)? Goes in `reference/` without a date prefix.

## Note on `superpowers/`

`superpowers/plans/` and `superpowers/specs/` are populated by the superpowers agent skill. Historical duplicates of the following files exist there and are intentionally not removed:

- `capture-pipeline.md`
- `hunchly-import-assessment.md`
- `ui-ux-audit-design-brief.md`
- `2026-04-09-settings-enforcement-design.md`

The canonical copies for hand-editing live under `reference/` and `specs/` in this directory.
