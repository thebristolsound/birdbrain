# Birdbrain docs

Author-time documentation for the project. All folders are tracked, including `plans/` (working notes, committed for history since July 2026).

## Canonical layout

| Folder       | Purpose                                                                                                                    | Naming convention                                                            | Tracked?            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| _(moved)_    | Long-lived technical documentation now lives in `website/content/docs/` and is published as the docs site. Stable, edited in place as the system evolves. | `<topic>.mdx` + a `meta.json` entry                                          | yes                 |
| `specs/`     | Design specs, design briefs, spikes, and assessments. Decisions captured at design time; treat as immutable once approved. | `YYYY-MM-DD-<slug>-design.md`, `-spike.md`, `-assessment.md`, or `-brief.md` | yes                 |
| `adr/`       | Architecture Decision Records.                                                                                             | `NNNN-<slug>.md`                                                             | yes                 |
| `plans/`     | Implementation plans, migration trackers, and operational checklists. Living documents — checked off as work progresses.   | `YYYY-MM-DD-<slug>.md`                                                       | yes (since 2026-07) |
| `archive/`   | Superseded specs moved out of the active folders.                                                                          | Original filename preserved                                                  | yes                 |
| `superpowers/` | Output from the superpowers agent skill — managed by tooling, do not hand-edit.                                          | Tool-managed                                                                 | yes (frozen)        |

`plans/` has been tracked since July 2026. Plans remain author-time artifacts: they get checked off and go stale, and staleness is expected. Commit them in docs-only commits for history; bundling them into feature PRs creates noise, so keep them out of `src/**` PRs. Durable docs (specs, ADRs, reference) are different: they **may ship in the same PR as the code they describe**, and bundling a doc with the `src/**` change it documents is preferred — see the "Documentation conventions" section in `CLAUDE.md`.

## Conventions

- New design or spec? Drop it in `specs/` with today's date as the prefix.
- New implementation plan? Drop it in `plans/` with today's date as the prefix.
- Superseding an existing doc? Move the old file to `archive/` (keep its original name) before adding the replacement.
- Permanent technical reference (architecture, pipelines, protocols)? Goes in `website/content/docs/` without a date prefix, as `.mdx` with `title`/`description` frontmatter, plus an entry in `website/content/docs/meta.json`. See the "Documentation site" section in `CLAUDE.md` for the MDX constraints (braces, link form, image paths).
- Writing any of the above? See [`agents/writing-guide.md`](agents/writing-guide.md) for audience, claim discipline, tone, and the shape each document type takes.

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
- Existing files remain for git history reference. Canonical copies of any duplicated docs live under `website/content/docs/` and `specs/`.
- When superseding a `superpowers/` doc, move the new version into `specs/` or `plans/` per the convention above.
