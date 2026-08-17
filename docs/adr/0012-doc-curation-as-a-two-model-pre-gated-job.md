# Doc curation as a two-model, pre-gated weekly job

**Status:** Accepted

**Date:** 2026-08-16

## Context

`website/content/docs/` is edited in place as the system evolves, and nothing enforces that it
does. Feature PRs may bundle their docs, but drift accumulates between the pages and the code
they describe. The existing agent fleet (`birdbrain-implementer`, `birdbrain-reviewer`,
`/dispatch`) is not used for prose because the maintainer's experience is that Claude models
do not hold to the repo's verbosity rules by instruction alone.

That was tested rather than assumed. On 2026-08-16 an identical doc-update task (one section
of `capture-pipeline.mdx`, a realistic merged change, the writing guide's "Prose" rules) was
run three times each on Codex `gpt-5.6-sol`, Claude Opus and Claude Fable, then repeated with
hard numeric limits added (net ≤ +40 words, untouched lines byte-identical, no
ordering-restating sentences).

- Prose rules only: Codex +37..39 words but restyled the whole section unasked (heading case,
  dashes, fence tags, deleted line references); Claude stayed in scope but padded (+41..68)
  and Opus once added an unsupported claim.
- With hard limits: Codex +31..32 and zero out-of-scope edits; Claude +38..52, still one
  padding sentence per run, and Opus again invented a claim. Fable never did.

Two conclusions: instructions with numbers move behaviour where adjectives do not, and no
model produced the minimal diff unprompted — Claude pads prose, Codex pads the diff.

The pipeline was then run end-to-end on a real week of `main` (97 merges, dominated by #427)
with each candidate as author, the same policy, and the same tool-armed Fable reviewer:

| author | pass 1 | pass 2 (reasons fed back) | outcome |
|---|---|---|---|
| Codex `gpt-5.6-sol` | 2 false claims (`not-set` on the signing key; enum names for rendered labels) | fixed; deleted a half-shipped roadmap item, restyled untouched sentences | discard |
| Fable | 1 near-miss (enum-vs-label) + 1 padding sentence | clean | approve |
| Opus | 0 false claims, 2 padding phrases | clean | approve |

Opus was the only author that never wrote a false claim; Fable was ~3× faster as author. The
single-section A/B had pointed at Codex; the real task did not.

## Decision

A weekly GitHub Actions job (`.github/workflows/doc-curator.yml`) reconciles
`website/content/docs/**.mdx` with merges to `main` since a stored marker.

1. **Opus authors** (`claude-opus-5`, `claude -p` with edit tools) under the hard limits in
   `docs/agents/doc-curator.md`; `scripts/doc-budget.mjs` re-checks the limits mechanically.
2. **Fable reviews** (`claude-fable-5`) before any PR exists, on four adversarial lenses:
   unsupported claim, shorter-loses-nothing, scope, vocabulary. The reviewer gets read-only
   tools on the checkout and must cite `file:line` for every claim it verifies or refutes —
   not an in-prompt diff, which for a busy week is megabytes and, truncated, hides exactly the
   hunk a claim needs (the first local run approved a false `not-set` claim for that reason;
   the tool-enabled run rejected it). Reject → one retry with the reasons → reject again →
   discard. A rejected edit never becomes a PR.
3. Scope is `website/content/docs/*.mdx`, update-only. Never `meta.json`/`docs.json`,
   never a new page, never `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md`, never `docs/**`.
4. Output is a PR (`docs/curate-YYYY-MM-DD`, labels `agent-pr` + `docs`), human-merged. Never
   a push to `main` — `docs.yml` publishes every push there.
5. The site must build on the edit; a build failure files an issue and discards the edit.
6. Curator PRs are exempt from the ADR-0005 one-open-agent-PR slot; the curator keeps itself
   serial by commenting on an open curator PR instead of opening a second.

## Consequences

- One vendor, one secret (`CLAUDE_CODE_OAUTH_TOKEN` from the maintainer's subscription via `claude setup-token`; it expires and must be re-minted), one CLI. Independence comes from a different model in each role
  with no shared context: in the end-to-end run the Fable reviewer rejected a Fable-authored
  first pass, so same-family review is not a rubber stamp.
- Cost per run at 2026-08 prices: author ≈ $6 + $3–6 on retry, reviewer ≈ $4.60 per pass.
- Limits are enforced twice (prompt and script). The script cannot judge whether an in-section
  change was required; that stays a reviewer lens.
- A discarded run leaves the marker, so a window is retried until it produces a PR, a comment,
  or a clean no-op. A window that repeatedly fails review needs a human to look at the run
  summaries — there is no auto-escalation in v1.
- New pages, IA changes, and agent-facing docs remain manual. Extending scope to any of them
  is a new decision, not a config change.
- `doc-budget.mjs` gates only the curator in v1. Applying it to human PRs touching
  `website/content/docs/**` is a one-line `ci.yml` change and a separate decision.

## Alternatives rejected

**Codex authors, Claude reviews.** The original choice, from the single-section A/B. Built and
run end-to-end; on the real week Codex was the only author discarded after its retry (scope
creep and an over-deleted roadmap item), while both Claude authors reached approve. A second
vendor bought a secret, an install, and an unverified Linux sandbox without buying accuracy.

**One model for both roles, or no reviewer.** Every author, including Opus, needed the
reviewer's first rejection to reach a mergeable edit; no author's first pass was approvable.

**Per-merge trigger.** Most merges touch no documented behaviour; per-merge runs are mostly
no-ops that can each open a junk PR, and split one feature across several half-stories.

**Detect-and-file-issue only.** Cheaper and safer, but converts drift into review-queue debt
for the maintainer, which is the failure the job exists to remove.
