# Birdbrain docs

Author-time documentation for the project. All folders are tracked, including `plans/` (working notes, committed for history since July 2026).

## Canonical layout

| Folder       | Purpose                                                                                                                    | Naming convention                                                            | Tracked?            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| _(moved)_    | Long-lived technical documentation now lives in `website/content/docs/` and is published as the docs site. Stable, edited in place as the system evolves. | `<topic>.mdx` + a `docs.json` navigation entry                               | yes                 |
| `specs/`     | Design specs, design briefs, spikes, and assessments. Decisions captured at design time; treat as immutable once approved. | `YYYY-MM-DD-<slug>-design.md`, `-spike.md`, `-assessment.md`, `-brief.md`, or `-research.md` | yes                 |
| `adr/`       | Architecture Decision Records.                                                                                             | `NNNN-<slug>.md`                                                             | yes                 |
| `plans/`     | Implementation plans, migration trackers, and operational checklists. Living documents — checked off as work progresses.   | `YYYY-MM-DD-<slug>.md`                                                       | yes (since 2026-07) |
| `archive/`   | Superseded specs moved out of the active folders.                                                                          | Original filename preserved                                                  | yes                 |
| `superpowers/` | Output from the superpowers agent skill — managed by tooling, do not hand-edit.                                          | Tool-managed                                                                 | yes (frozen)        |

`plans/` has been tracked since July 2026. Plans remain author-time artifacts: they get checked off and go stale, and staleness is expected.

The rule for whether a doc may ship in the same PR as the code it describes, plans included, lives in one place: the "Documentation conventions" section in `CLAUDE.md`. It covers every folder in the preceding table. Do not restate it here, because a second copy is free to drift out of step with the first (#514).

## Conventions

- New design or spec? Drop it in `specs/` with today's date as the prefix.
- New implementation plan? Drop it in `plans/` with today's date as the prefix.
- Superseding an existing doc? Move the old file to `archive/` (keep its original name) before adding the replacement.
- Permanent technical reference (architecture, pipelines, protocols)? Goes in `website/content/docs/` without a date prefix, as `.mdx` with `title`/`description` frontmatter, plus an entry in `navigation` in `website/content/docs.json`. See `docs/agents/website.md` for the MDX constraints (braces, link form, image paths).
- Writing any of the above? See [`agents/writing-guide.md`](agents/writing-guide.md) for audience, claim discipline, tone, and the shape each document type takes.
- Pointing at code or a workflow? Cite a stable anchor, never a line number. See below.

### Cite by stable anchor, never by line number

A line number is a position, and positions move whenever anything above them changes. Nothing
in this repository checks a `file.ts:123` citation, so it drifts silently: the document keeps
reading as if it were true and the reader discovers otherwise by landing on unrelated code. A
stale citation is worse than none, because the reader has to work out which of the two files
is wrong before they can carry on (#575).

Cite the thing, not where it currently sits:

| Target | Write this | Not this |
| --- | --- | --- |
| A workflow step | `.github/workflows/ci.yml`, `test` job, step `Diff coverage` | `ci.yml:187` |
| A source symbol | `runSelfCheck()` in `src/verifier/cli.ts` | `src/verifier/cli.ts:117` |
| A whole file | `src/main/services/db/migrations.ts` | `migrations.ts:1-40` |

Anchors survive edits above them, and a renamed job or symbol fails a `grep` instead of
resolving to the wrong place.

**The one exception is a document that records a point-in-time reading.** A phase-1 findings
document, a review verdict, or an intake ruling quotes what it read at a stated commit; its
citations are evidence of that reading, not pointers the project maintains. Those pin their
frame of reference — the sha in the header, or failing that the date in the filename — and are
left alone. Do not rewrite them to match today's tree: that falsifies the record, and where the
cited file has since been deleted there is nothing to rewrite it to.

The rule binds hardest on the documents that lack that excuse. Anything marked **Active** — a
runbook or checklist re-run over time, read under time pressure — carries no line citations at
all.

## Tool-specific path overrides

| Tool / skill                | Built-in default                                      | **Override (use this instead)**           |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `superpowers:brainstorming` | varies (plugin default)                               | `docs/specs/YYYY-MM-DD-<topic>-design.md` |
| `superpowers:writing-plans` | varies (plugin default)                               | `docs/plans/YYYY-MM-DD-<feature>.md`      |
| `speckit.*`                 | varies                                                | follow the canonical layout above         |

## Prose linting

`.vale.ini` at the repo root is the project's Vale config; it overrides any global one for files under this repo. Project vocabulary lives in `.vale/styles/config/vocabularies/Birdbrain/accept.txt` so Birdbrain terms are not accepted in unrelated projects. Run `vale sync` once per clone to fetch the Google package (ignored by git). Only `*.md` is linted; `.mdx` needs `mdx2vast`, which is not installed. A doc you write should pass `vale <file>` with zero errors; residual warnings for this project's own vocabulary are expected.
