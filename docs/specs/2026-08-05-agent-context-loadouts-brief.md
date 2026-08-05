# Agent context loadouts — brief

An idea captured early, before any design work: give agents preconfigured sets of context they "equip" before working in a particular zone of the codebase, the way a game character equips a loadout — a preconfigured inventory chosen for the mission ahead — instead of starting every dispatch from one shared repo-wide map and chasing pointers on demand.

This is idea capture only. No mechanism, file format, or rollout is proposed here.

## The idea

When an agent is dispatched into a zone of work — the DB layer, the renderer query layer, the extension, the evidence path, the docs site — it should be able to pick up a curated bundle assembled for that zone: the docs that matter there, the conventions that gate a diff there, the path lists, the vocabulary, the known traps. Equipping the loadout is the first move of the task; everything in it was chosen deliberately, once, by someone who knew the zone — rather than being rediscovered per session or inherited as one undifferentiated pile.

The loadout metaphor carries more than "a list of files":

- A loadout is **picked to match the mission**, not carried everywhere. Different zones, different kit.
- A loadout is **assembled ahead of time** by someone who knows what the mission needs, then reused.
- A loadout is **inspectable** — you can look at what a character is carrying. Likewise you could review what context an agent was equipped with, and ask whether a failure traces back to missing kit.

## What context gathering looks like today

Agent context in this repo is shared-map-first — every task starts from the same repo-wide map, with extra pointers followed on demand:

- Both agent definitions open the same way. `.claude/agents/birdbrain-implementer.md`: "Read CLAUDE.md first — it is the authoritative map of the codebase". `.claude/agents/birdbrain-reviewer.md`: "Read CLAUDE.md first for the codebase map." `CLAUDE.md` is 273 lines covering every subsystem, whatever the task.
- Beyond that, context arrives as inline prose in the agent files plus ad-hoc path pointers the agent is expected to follow on demand: `docs/agents/triage-labels.md`, `docs/agents/github-access.md`, `docs/adr/0005-unattended-agents-on-the-evidence-path.md`, `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`.
- `docs/agents/domain.md` declares the repo "single-context": one `CONTEXT.md` glossary plus `docs/adr/` at the root, read before exploring, for every task.

Nothing selects context per task or per area. The costs of that: every agent pays the full-context tax regardless of how narrow its task is; curation exists but is implicit, scattered across agent-file prose; and adding zone-specific knowledge means either growing `CLAUDE.md` for everyone or adding another pointer an agent may or may not follow.

## Why the framing is interesting

"Loadout" names a unit of curation that sits between the two options the repo has today — one global map that everyone reads, or an agent re-exploring from scratch each session. A per-zone bundle would be:

- **Scoped** — an agent fixing a selector-lifecycle bug does not need the docs-site MDX constraints, and vice versa.
- **Composable** — a task touching two zones equips two loadouts; shared baseline kit (glossary, ADRs) could be part of every loadout.
- **Reviewable** — the bundle is an artifact. It can be diffed, improved after a failed run, and audited when asking why an agent missed a convention.

## Tension with the single-context stance

This idea cuts against a decision the repo already made: `docs/agents/domain.md` deliberately declares a single-context layout. That declaration is flagged here per that doc's own "Flag ADR conflicts" convention — surface a contradiction explicitly rather than silently overriding it. A real proposal would need to either supersede that stance or scope loadouts as a layer on top of it — for example, keeping `CONTEXT.md` + `docs/adr/` as the shared baseline every loadout includes. Worth noting: the single-context stance was set when the repo's agent surface was small; the pointer lists accumulating inside the agent definitions suggest per-zone curation is already happening informally.

## Open questions

Captured, not answered:

- **What is a loadout physically?** A markdown file per zone? Frontmatter in the agent definitions? An argument the dispatch skill passes at spawn time?
- **What is the partition key?** Zone of the codebase is the image here, but task type (implement vs. review vs. triage) is a competing axis — today's split between the implementer and reviewer agent files is already a task-type partition.
- **Who maintains loadouts, and how do they go stale?** A stale loadout is worse than none if the agent trusts it over exploration. Staleness in `docs/plans/` is accepted (`docs/README.md`: plans "get checked off and go stale, and staleness is expected"); staleness in equipped context may not be acceptable.
- **How does this interact with the ADR-0005 gates?** Evidence-affecting work carries its own obligations — the gates in `docs/adr/0005-unattended-agents-on-the-evidence-path.md`, with `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` as the path-list backstop the implementer agent is pointed at. Is that a loadout, or a layer that must be present regardless of loadout?
- **Does equipping replace or supplement reading `CLAUDE.md`?** Full replacement risks an agent missing cross-cutting rules (Node 20, code style); supplement risks the loadout being additive cost instead of a savings.

## Status

Raw idea, uncommitted to. Next step if it earns one: a design spec proposing a concrete mechanism, which would need to resolve the single-context tension explicitly.
