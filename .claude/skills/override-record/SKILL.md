---
name: override-record
description: Compose and post the ADR-0007 override record for an agent PR merged over a `request changes` pre-pass. Files an issue per deferred finding so nothing is lost, and asks the human only for the dispositions that need judgement. Use when a PR carries the record debt the dispatch routine reports, or before merging over a verdict.
---

# Override record — the button

ADR-0007 requires a record when a human merges an agent PR whose final pre-pass said
`request changes`. Writing one by hand is the friction this skill removes. Repo:
`thebristolsound/birdbrain`.

**What is automated: everything except judgement.** Finding the verdict, enumerating the
findings, filing an issue per deferred finding, composing the record, posting it, verifying it
conforms. **What is not: whether a finding is deferred or disputed**, because that is the
maintainer's statement about their own merge and the ADR says so.

The default is **defer**. That is the honest default — it concedes the finding is real and
keeps it alive as a filed issue — and it is the one that needs no prose. Disputing is the
exception and the only thing that costs typing.

## Usage

`/override-record <pr-number>` — or with no argument, find the debt automatically.

## 1. Find the debt

With a PR number, work that one. Without, sweep for every merged `agent-pr` PR lacking a
conforming record, not just the most recent one — the routine's hygiene check only ever looks
at the latest closed PR, so older debt is invisible to it and accumulates silently:

```shell
R=thebristolsound/birdbrain
gh api --paginate "repos/$R/issues?state=closed&labels=agent-pr&per_page=100" \
  --jq '.[] | select(.pull_request) | .number'
```

For each, read the final pre-pass verdict and whether a record exists:

```shell
gh api --paginate "repos/$R/issues/<n>/comments?per_page=100" \
  --jq '[.[] | select((.body|split("\n")[0]) | test("Reviewer pre-pass"))] | last | .body' \
  | head -1                     # verdict text: match `request changes` / `approve for human review`
gh api --paginate "repos/$R/issues/<n>/comments?per_page=100" \
  --jq '[.[] | select((.body|split("\n")[0]) | test("Override record"))] | length'
```

Debt exists when the PR merged, the final verdict is `request changes`, and the record count
is zero. Report anything else and stop — a PR that merged on an approving verdict needs no
record, and one that already has a record needs no second.

## 2. Enumerate the findings

Read the **final** pre-pass in full — not an earlier round's, and not a summary of it. Every
finding in it is outstanding by definition: the pre-pass that requested changes is the one
being overridden, and no fix round followed it or the verdict would have been re-run.

Take findings from the blocking and should-fix sections. Nits are optional; include them if
they are cheap to file, and say which you skipped rather than silently dropping them.

For each finding capture: its number and one-line summary, the `file:line` it cites, and its
severity band.

## 3. Classify against ADR-0007 rule 3 — before anything is filed

**Findings against the evidence gate itself may not be deferred.** That is the Evidence impact
section, the known-answer test, and backward verification of existing packages. Deferring one
would merge an admitted gap in exactly the obligations ADR-0004 and ADR-0005 exist to enforce.

If any finding is of that kind, **stop before filing anything** and put it to the human: it
must be fixed in a follow-up PR or disputed on the merits, and the record cannot be posted
until they say which. Never auto-defer one, and never quietly reclassify it as an ordinary
finding to make the flow proceed.

## 4. Ask the human once, for the whole set

Present the findings as a numbered list with the proposed disposition — **deferred** for every
one, except any rule-3 finding, which has no proposal. Ask a single question: which of these
should be disputed instead, and why.

Do not ask per finding. Do not ask whether to proceed. One question, one answer, then act.

If the answer names none, everything defers.

## 5. File one issue per deferred finding

A deferral is only honest if the finding survives it, and a filed issue is what makes that
true. One issue per deferred finding — not one issue for the batch, because a batch issue is
closed when the easiest item in it is done.

Reuse an existing issue when the finding is already tracked; search before filing. Link rather
than duplicating.

Each issue carries: the finding verbatim (its failure scenario is the valuable part), the
`file:line`, a link to the pre-pass comment, and a line saying it was deferred at the merge of
PR #N. Label `bug` when it describes a defect, and `evidence-affecting` when the touched paths
are on the list in `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` — note that
an evidence-*affecting* finding is not the same as a rule-3 evidence-*gate* finding and may be
deferred normally.

## 6. Compose and post

The record must satisfy the hygiene check mechanically, so these are not stylistic choices:

- **First line contains `Override record`.** The check matches on the first line only.
- **Posted after the final `request changes` pre-pass.** If the merge has already happened the
  record is late — say so in the record itself rather than papering over it. Late discharges
  the debt rule 4 re-reports; it does not satisfy rule 2's timing window, and the record
  should not read as though it did.
- **Every outstanding finding named and dispositioned**, each as `DISPUTED` with a reason or
  `DEFERRED to #N` with the issue link.

Post with `gh pr comment <n> --body-file <path>` — a file, never an inline `--body`, so the
markdown survives.

Then verify it landed and conforms:

```shell
gh api --paginate "repos/$R/issues/<n>/comments?per_page=100" \
  --jq '[.[] | select((.body|split("\n")[0]) | test("Override record"))] | length'
```

## What this skill will not do

- **Post a record for a PR you did not merge.** The record is the merging human's statement.
  Compose it, show it, let them post — or post on their explicit say-so in the same turn.
- **Invent a dispute.** "Disputed" means the finding is wrong. If the human has not said why it
  is wrong, it is not disputed; it is deferred.
- **Defer a rule-3 evidence-gate finding.** See step 3.
- **Make the debt go away by lowering the bar.** If records are needed often, ADR-0007's own
  consequences section names the real fix: a pre-pass producing findings not worth answering is
  a reviewer-quality problem to solve at the source. Say so when the rate is high rather than
  smoothing it over — the friction is a signal, and this skill removes the clerical part of it,
  not the signal.
