# Birdbrain docs

Local working notes. The whole `docs/` tree is gitignored — these are author-time artifacts, not a published docs site.

## Canonical layout

This is the project-wide standard. Agentic tooling (Superpowers, speckit, custom skills) **MUST** write here. User preferences override any tool's built-in default path — the locations below are those preferences.

| Folder       | Purpose                                                                                                                    | Naming convention                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `reference/` | Long-lived technical documentation. Stable, edited in place as the system evolves.                                         | `<topic>.md`                                                                 |
| `specs/`     | Design specs, design briefs, spikes, and assessments. Decisions captured at design time; treat as immutable once approved. | `YYYY-MM-DD-<slug>-design.md`, `-spike.md`, `-assessment.md`, or `-brief.md` |
| `plans/`     | Implementation plans, migration trackers, and operational checklists. Living documents — checked off as work progresses.   | `YYYY-MM-DD-<slug>.md`                                                       |
| `archive/`   | Superseded specs and plans moved out of the active folders.                                                                | Original filename preserved                                                  |

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
