# Birdbrain docs

Author-time documentation for the project. All folders are tracked, including `plans/` (working notes, committed for history since July 2026).

## Canonical layout

| Folder       | Purpose                                                                                                                    | Naming convention                                                            | Tracked?            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| `reference/` | Long-lived technical documentation. Stable, edited in place as the system evolves.                                         | `<topic>.md`                                                                 | yes                 |
| `specs/`     | Design specs, design briefs, spikes, and assessments. Decisions captured at design time; treat as immutable once approved. | `YYYY-MM-DD-<slug>-design.md`, `-spike.md`, `-assessment.md`, or `-brief.md` | yes                 |
| `adr/`       | Architecture Decision Records.                                                                                             | `NNNN-<slug>.md`                                                             | yes                 |
| `plans/`     | Implementation plans, migration trackers, and operational checklists. Living documents — checked off as work progresses.   | `YYYY-MM-DD-<slug>.md`                                                       | yes (since 2026-07) |
| `archive/`   | Superseded specs moved out of the active folders.                                                                          | Original filename preserved                                                  | yes                 |
| `superpowers/` | Output from the superpowers agent skill — managed by tooling, do not hand-edit.                                          | Tool-managed                                                                 | yes (frozen)        |

`plans/` has been tracked since July 2026. Plans remain author-time artifacts: they get checked off and go stale, and staleness is expected. Commit them in docs-only commits for history; bundling them into feature PRs creates noise, so keep them out of `src/**` PRs. Tracked durable docs (specs, ADRs, reference) **must be committed in their own PR** — never bundled with a `src/**` change.

## Conventions

- New design or spec? Drop it in `specs/` with today's date as the prefix.
- New implementation plan? Drop it in `plans/` with today's date as the prefix.
- Superseding an existing doc? Move the old file to `archive/` (keep its original name) before adding the replacement.
- Permanent technical reference (architecture, pipelines, protocols)? Goes in `reference/` without a date prefix.

## Tool-specific path overrides

| Tool / skill                | Built-in default                                      | **Override (use this instead)**           |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `superpowers:brainstorming` | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | `docs/specs/YYYY-MM-DD-<topic>-design.md` |
| `superpowers:writing-plans` | `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`      | `docs/plans/YYYY-MM-DD-<feature>.md`      |
| `speckit.*`                 | varies                                                | follow the canonical layout above         |

When a skill says "save to `docs/superpowers/...`", treat that as overridden by this README. Always write to `docs/specs/` or `docs/plans/`.

## Legacy `superpowers/` directory

`docs/superpowers/` is the old default path written by the Superpowers skill before this convention was set. It is **frozen**:

- Do not write new files there.
- Existing files remain for git history reference. Canonical copies of any duplicated docs live under `reference/` and `specs/`.
- When superseding a `superpowers/` doc, move the new version into `specs/` or `plans/` per the convention above.
