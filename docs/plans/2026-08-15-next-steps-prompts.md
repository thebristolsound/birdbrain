# Next-step prompts — 2026-08-15 (rev 2)

Ready-to-run prompts for fresh Claude Code sessions. Each stands alone. Run in the order given.

**State at time of writing (`2026-08-15T22:45Z`).** `origin/main` is `aac92b7` (PR #455 merged).
PR #463 is open, draft, labelled `agent-pr`, and occupies the serial dispatch slot. The local
worktree at `/home/matt/dev/personal/birdbrain` may be behind — pull first in every step.

**What changed since rev 1.** PR #455 merged at `22:24:41Z`, 19 minutes after its round-3
pre-pass returned `request changes`. Its blocking finding was a false claim in a test comment and
the PR body — the behaviour was correct — so that false comment is now on `main`. PR #463
corrects it. Eight issues were filed today: #451, #452, #453, #454, #459, #460, #461, #462.

---

## 1. PR #463 — finish the cycle

The open slot. Small, verified, and needs only CI plus a pre-pass.

```
In /home/matt/dev/personal/birdbrain (git pull first), run one dispatch cycle for PR #463 in
thebristolsound/birdbrain: "docs(test): state what the bridge root-level allowlist actually
gates", branch fix/338-bridge-allowlist-comment, head b04d46b1d4b7d40dcb18fbce5e1a429036691ddf,
draft, labelled agent-pr.

It corrects one comment in tests/preload/bridge.test.ts (lines 96-100) that claimed the
root-level allowlist makes "any new root-level placement a reviewed contract decision". That is
false for events: expectedBridgePath short-circuits on kind === 'event', so a root-placed event
always matches its expected path and the ROOT_LEVEL_LEAVES filter never fires for the ten on*
entries. Documentation-only; no src/ change; the enforcement gap itself is filed as #461 and
deliberately not fixed here.

Wait for all checks to report before doing anything else — gh pr checks 463 — then run a
birdbrain-reviewer pre-pass against b04d46b and post the verdict as a PR comment. Do not merge,
do not mark it ready for review.

Two things the reviewer should be told explicitly. First, per #452, draft:false is not a blocking
finding on its own and the maintainer converting an agent PR out of draft is the ADR-0005 back
gate firing. Second, per #460, CLAUDE.md's claim that tests/ is typechecked by nothing is STALE —
#337 is closed, tsconfig.test.node.json and tsconfig.test.web.json are on main, and pnpm
typecheck runs six projects. Do not repeat that stale premise in the prompt.

Note for the label determination: I applied agent-pr only. The implementer recommended
evidence-affecting on the reasoning that "the label costs nothing", while its own analysis found
the path trigger does not fire (the only changed path is tests/preload/bridge.test.ts, which is
not on the include list in docs/specs/2026-07-31-evidence-affecting-paths-assessment.md). If the
reviewer disagrees with leaving it off, say so rather than silently applying it.
```

---

## 2. Four outstanding ADR-0007 override records

This is now the largest piece of accumulated debt, and one part of it is structural.

```
In /home/matt/dev/personal/birdbrain (git pull first), clear the ADR-0007 override-record debt in
thebristolsound/birdbrain and fix the reason part of it accumulated invisibly.

Four merged agent PRs owe records:
  #455 — merged 2026-08-15T22:24:41Z, round-3 pre-pass request changes (comment 5304450979)
  #442 — merged 2026-08-15T06:28:03Z, tracked as issue #448
  #375 — merged 2026-08-10T22:28:03Z, tracked as issue #454
  #372 — merged 2026-08-10T15:18:33Z, tracked as issue #454
Use the /override-record skill, once per PR. Do not hand-write them; the skill files an issue per
deferred finding, which is what makes a deferral honest rather than a dismissal.

ADR-0007 landed on main at 2026-08-10T05:25:03Z (PR #370), so the six earlier request-changes
merges — #329, #343, #354, #355, #357, #360 — predate the obligation and are NOT debt. They are
the part-two ledger's own evidence. Do not file records for them.

For #455 specifically: its blocking finding was that a test comment and the PR body claimed a
review guarantee the code does not provide for events. The behaviour was correct; the prose was
false. PR #463 corrects the comment, and #461 tracks the enforcement gap — so when you compose
that record, most of its findings already have homes and should be DEFERRED to those numbers
rather than filed afresh. Check before filing anything.

Then fix the structural bug, which is #454's main acceptance criterion. In
.claude/skills/dispatch/SKILL.md section 1, the departed-slot hygiene check queries with
per_page=1 and sort=created&direction=desc, so it reads only the most recently created closed
agent-pr PR. The skill claims that branch is "the only entry point ADR-0007's rule 4 and the
give-up check have" and that a finding "re-fires every free-slot cycle until the record appears".
Both are true only for the newest PR — once a newer agent PR closes in front of an unrecorded
one, the older debt can never surface again. That is exactly how #372 and #375 hid for five days.
Fix it so the text becomes true as written, then demonstrate it: run the check against the
current repo and show it reports every unrecorded PR, not just the newest.

Open a draft PR for the skill change with the standard attribution line. Do not merge it.
```

---

## 3. #459 and #452 — the two agent-instruction defects that keep corrupting verdicts

Do these before the next dispatch cycle. Both produce wrong signals on every PR until fixed.

```
In /home/matt/dev/personal/birdbrain (git pull first), fix issues #452 and #459 in
thebristolsound/birdbrain. They are separate defects in the same machinery and are cheaper
together; use one PR only if the changes touch the same files, otherwise two.

#452 — .claude/agents/birdbrain-reviewer.md:98-101 states the draft-status completion control as
an unconditional invariant ("must report true", "A ready-for-review agent PR is a blocking
finding") while justifying it with "Every agent PR stays in draft until a human approves it". It
therefore reports as a failure the state its own rationale calls correct, and it cannot tell the
cases apart because agent PRs and the maintainer both act under the thebristolsound account. This
fired for real on PR #444 and again on PR #455. The pipeline-side prohibition must NOT change —
the dispatch routine still never marks a PR ready for review.

#459 — CodeRabbit's autofix pushed commit 4fe73059 to PR #455's branch at 2026-08-15T21:25:30Z,
3½ hours after that PR's second pre-pass, changing a shared IPC contract and adding a new
IpcFailure throw. Both posted verdicts then named shas that were no longer head, and nothing in
the routine detected it. ADR-0006's one-writer-per-branch rule is written against a second agent
and does not contemplate a review bot with write access. Read #459 for the full acceptance
criteria; the decision it needs from a human is whether CodeRabbit autofix should be able to push
to agent-pr branches at all.

Note while you are in these files: per #460, CLAUDE.md's Testing section is stale — #337 is
closed and tests/ IS typechecked now. Do not propagate that claim into anything you write. #460
is a separate ticket; fix it there, not here, unless you are already editing the same paragraph.

Open draft PRs with the standard attribution line. Do not merge.
```

---

## 4. #453 and #460 — two stale-claim fixes, both small

```
In /home/matt/dev/personal/birdbrain (git pull first), fix issues #453 and #460 in
thebristolsound/birdbrain. Separate PRs — they touch unrelated files and one is tester-facing.

#453 — website/content/docs/tester-guide.mdx:33 tells testers to take "the build named in your
invitation", but docs/specs/2026-08-15-tester-rollout-brief.md:189-190 (step 3) only requires the
invitation to carry the guide link and the scoped feedback ask; the release link is pinned in the
tester chat at step 4 (:191-193). #453 gives two alternative acceptance criteria — fix the guide
OR amend the brief. Pick one, say why, do not do both. There is an existing candidate patch:
CodeRabbit committed 159b7f747722693336fe8bf68297d45e9c6ea634 to
origin/claude/443-tester-guide-stale-claims AFTER that branch merged, so it is stranded and will
never reach main. Read it (git fetch origin && git show 159b7f74) and judge it on its merits.
Verify with pnpm types:check and pnpm build run from INSIDE website/ — the root toolchain ignores
website/ and no PR check compiles the docs site (#450), so that local build is the only evidence
the MDX compiles.

#460 — CLAUDE.md's Testing section still says "tests/ is typechecked by nothing" and instructs
agents that "a type-level assertion placed in tests/ is inert — reach for a runtime probe
instead". #337 is closed as completed: tsconfig.test.node.json and tsconfig.test.web.json are on
main and pnpm typecheck runs six projects including both. Verify what is still true before
rewriting — in particular whether eslint.config.js still sets no parserOptions.project, since
that half of the paragraph may well still hold. #460 also asks you to correct the same stale
claim where it was repeated in issue #459, and to strip the stale ready-for-agent label from
closed issue #337.

Open draft PRs with the standard attribution line. Do not merge.
```

---

## 5. The round-1 release

Only after 1–4. The gate is written and on `main`; nothing has run it yet.

```
In /home/matt/dev/personal/birdbrain (git pull first), prepare the round-1 tester release for
thebristolsound/birdbrain, following docs/plans/2026-08-15-pre-ship-validation-gate.md.

Read that gate in full first — it is a template, and its "How to run it" section says to copy the
checklist into the release's notes rather than ticking boxes in the document itself.

The blocking constraint is in section 1 and shapes everything else: ci.yml and security.yml run
on push-to-main and pull requests, NOT on tags, and neither declares workflow_dispatch. There is
no way to aim a run at a tag — gh workflow run has no dispatch trigger to fire, and gh run rerun
only replays the commit its original run used. So the tag must be cut at a commit that already
has a green main run. (Adding workflow_dispatch is #445; the gate says explicitly it is not a
prerequisite.)

Before proposing a tag, check these are resolved or consciously accepted:
  #453 — the tester guide still presupposes the invitation names a build
  #451 — the guide's "What we're looking for" asks for feedback the brief says not to collect
  #450 — no PR check compiles the docs site
  #445 — no workflow_dispatch on ci.yml / security.yml
Also confirm the brief's "Running the round" step 2 ("Update the tester guide per the list
above") is actually satisfied. PR #444 fixed the four stale factual claims but explicitly left
the feedback-ask section, which is #451 and is blocked on map #284.

The newest tag is v1.0.1-beta.17 (2026-07-24), which predates both the gate and #413's
pre-migration snapshot, so a fresh tag is required.

Do NOT cut the tag yourself. Report: which commit is eligible, its main CI run status, what
remains open from the list above, and a recommended go/no-go with reasons. Cutting the tag and
running the two-machine smoke pass are mine.
```

---

## Filed today, not scheduled above

- **#461** — the root-level allowlist gates invokes but not events, so a new root `on*` leaf has
  no review signal. Test-only fix proposed and costed in the issue. Real, not urgent.
- **#462** — `ipcHandlers` self-test "server is down" fails when another test binds port 19845.
  Sibling of #446.
- **#446** — `dbSnapshotsIntact` times out under coverage at ~4.6s against a 5s default.
- **#451** — feedback-ask conflict in the tester guide. Blocked on map #284; named in step 5's
  pre-flight because it affects the round even though it cannot be worked yet.
- **#445** — `workflow_dispatch` on `ci.yml` / `security.yml`. The gate says it is not a
  prerequisite.
