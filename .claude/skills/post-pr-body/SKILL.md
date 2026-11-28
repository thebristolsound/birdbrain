---
name: post-pr-body
description: The single PR body shape for this repository (humans and agents), and the linter that gates `gh pr create` and `gh pr edit`. Preloaded into the implementer; invoke it in any session that opens or edits a PR.
---

# post-pr-body

One PR body shape, the same for a human and an agent. `template.md` in this directory is the
canonical form and `.github/pull_request_template.md` is a copy of it. The reviewer reads the
body against this shape; the pre-pass treats a body defect as blocking (ADR-0018).

## Two layers

A body is a plain-language top layer plus collapsed detail, the way CodeRabbit nests its
review:

- **Top layer.** Line 1, the Merge risk notice, the section headings, the Summary sentences,
  the Screenshots declaration and rows, the Not done, Blast radius and checkbox bullets, the
  Yes/No answer and the attribution line. Plain language for a reader outside the repository: no code spans,
  file names or paths, commit ids, ADR numbers, tool names, or repository terms such as
  pre-pass, preflight, lint, typecheck, worktree, merge base, diff coverage or sha. The linter
  checks those as proxies for jargon.
- **Detail.** Everything else, inside `<details>` blocks: a one-line `<summary>` in plain
  words, a blank line, then the content written however is most effective. The file-group
  bullets, the Evidence impact fields and the preflight block are all detail. Blocks do not
  nest and hold no `##` heading; the `<summary>` text is visible, so it is checked as top layer.

## The shape

The sections follow a fixed order, four of them optional, under a hard cap and one closing
line. The layout follows the maintainer's work template, adapted to this repository's gates:

1. Line 1 is `Closes #N` (or `Closes #N, #M`). A PR with no issue writes
   `No issue: <one clause>` instead.
2. The Merge risk notice, between line 1 and the Summary: a GitHub alert whose colour is the
   level, then the level in bold and one plain sentence on what merging ships.

   ```markdown
   > [!WARNING]
   > **Merge risk: Medium.** The next desktop app release changes how the capture list sorts.
   ```

   The author sets the level; no script prints it. Use the highest that applies:
   - **High** (`[!CAUTION]`): the change is evidence-affecting, or it changes a merge gate,
     a required check, release signing or the update channel.
   - **Medium** (`[!WARNING]`): it changes what a user of the app, the extension or the docs
     site sees or does.
   - **Low** (`[!NOTE]`): it changes code paths users reach without changing what they see,
     or repository tooling that no gate depends on.
   - **Minimal** (`[!TIP]`): it changes only tests, comments, or docs outside the docs site.
3. `## Summary`: at most 5 plain sentences. What changed and why, and one sentence naming any
   handoff (for example, that the dispatch step opens and labels the PR). The merge copies
   this section into the squash-merge commit body, so it is also the permanent record. A
   collapsed `Diagram` block may follow the sentences: when the change alters a flow, a call
   sequence, a state machine or a dependency, it holds a Mermaid diagram of the state after
   the merge, at most about 15 nodes, every edge labelled, with what this PR changed marked by
   the template's `changed` class and no fill colours. The commit stops at that block, so no Summary text may follow it.
4. `## Review findings` (required on an agent-written body): every finding a review raised on
   this PR and what happened to it, sorted by the table in `.claude/skills/ship-unit/SKILL.md`,
   "Sorting a finding". The visible line is `No review findings yet.` until a review reports,
   then `<n> taken, <m> not taken.` above one collapsed `<details>` block holding one row per
   finding, each on one line:
   ``- Taken: <reviewer>, <severity>: <finding>. Fixed in `<commit>`.``
   (`Fixed in the description.` for a finding against the description) or
   `- Not taken, <reason>: <reviewer>, <severity>: <finding>. <why>`, where the reason is
   `out of scope`, `disputed` (with the `file:line` at head that shows it), `test or style only`,
   `needs its own push` or `filed as #N`. The counts match the rows. Rows link no issue, pull
   request or comment, and name no `#N` but the issue a `filed as #N` row was filed as: the
   review fleet loads each as a source it must read and fails when one is gone, empty or in
   another repository. The fleet reads a row as a record of review history and checks only its
   `Fixed in` commit and its filed issue (ADR-0060), so the links go in the thread replies.
   Dispatch also keeps a hidden `<!-- review findings answered through <time> -->` line in the
   section, which its pre-gate reads. The section sits outside the Summary, so the merge commit
   leaves it out. The merge paths check only what every section needs: its place in the order,
   well-formed `<details>` blocks and plain words in its visible lines, so the record never holds up a merge and a PR opened before it existed
   still merges; a human author may leave it out.
5. `## Proof`: one `<details>` block holding `Head: <sha>. Merge gate: <link or pending>.` and
   the `| Acceptance criterion | Proof | Result |` table, one row per acceptance criterion of
   the closed issue (or per Summary claim when there is none): the test, check or run that
   proves it at head, and its result. A criterion nothing proves is a Not done bullet, never a
   row with an empty or hopeful result. A push that moves the head updates the line and every
   row it touches. Command output stays in Verification.
6. `## Screenshots`: the visual-change declaration and, for Yes, the before and after rows,
   as "Screenshots for visual changes" below states. Inline images, Markdown or `<img>`,
   appear here and nowhere else in the body.
7. `## Not done` (optional): one bullet per gap or skipped test. A review finding not fixed here
   is a Review findings row instead.
8. `## Blast radius`: two bullets, `- On merge: <what ships>` (the next desktop app release,
   the extension, the docs site, or repository tooling only) and
   `- If wrong: <what breaks, how to back it out>`.
9. `## Before merge` and `## After merge` (optional): one `- [ ] <step, owner>` checkbox per
   step beyond review and a green merge gate, or owed once the PR merges.
10. `## Changes`: a `<details>` block holding the `| Area | What changed | Why |` table (or one
   bullet per file group), and optionally a second `Decisions` block holding the
   `| Decision | Grade | Source |` table, one row per choice a reviewer could question,
   graded "in production here", "vendor-documented pattern" or "own judgment". No prose or
   test output outside the blocks.
11. `## Evidence-affecting`: `Yes` or `No` on its own line. When Yes, a `<details>` block holding
   the `### Evidence impact` subsection with the four fields from the template. The definition
   and the tiered path list are in `CONTEXT.md` and
   `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`.
12. `## Verification`: the block `pnpm preflight` wrote to `.preflight/verification.md`,
   pasted verbatim including its `<!-- preflight ... -->` marker, generated at the head sha
   under review (ADR-0018). When the new head only merged the base in and the diff against the
   base is byte-identical, `pnpm preflight --carry` writes the earlier block for the new head,
   marked `source=carried`, without running a step (ADR-0021). No check ran on the merged tree
   for such a block, so the required checks at the new head must be green before it is relied
   on. The writer already wraps the step list in a `<details>` block
   under a plain summary line (`All pre-merge checks passed` or `A pre-merge check failed`).
   Test output and coverage figures appear there and nowhere else. A PR nobody preflighted
   locally (dependabot, a human author) gets its block from
   `scripts/verification-from-ci.sh <n>`, which reads the required checks at head and marks
   the block `source=ci`; it refuses while any of them is not green.
13. The last authored line is the attribution: exactly
   `Pull request description generated by Claude Code`, or the maintainer's global byline
   `Created with <model name> in <harness> (<app>)`, where ` in <harness>` and ` (<app>)`
   drop out when unknown. A `claude[bot]` platform footer appended after it is tolerated: the
   linter drops that one line. A human-written body omits the attribution line;
   `check.sh --any-author` (what `merge-pr` runs under `gh`) accepts both forms, and still
   wants the line last when present.

Everything above `## Verification` fits in 40 non-blank top-layer lines; collapsed lines and the
Review findings section do not count. The body has no other `##` sections: no acceptance-criteria walkthroughs and no reviewer
notes. Fenced blocks appear only inside a `<details>` block. Claims name only actions you took
and states you observed after taking them; a label another actor applies or a check CI will
run is named as a handoff, never asserted.

Every sentence is one the review fleet can settle from its inputs: the diff and the repository
at head, and the issues, pull requests, comments and reviews of this repository that the body
names as a bare `#N` outside a code span or links by URL
(`.github/scripts/review-fleet/inputs.mjs`). A statement about
anything else, such as a chat, an agent thread or an earlier review round, stays unchecked, and
one unchecked item fails `review/fleet` (ADR-0057). The one exception is who raised each finding
in the Review findings rows, which the fleet reads as a record (ADR-0060). Link the source, move the sentence to a PR
comment, or leave it out. No linter checks this: read each sentence for it before you post.

## Screenshots for visual changes

Every body declares its visual effect in `## Screenshots`. Use `- Visual changes: Yes` with
the screenshot rows below, or `- Visual changes: No. <reason>` explaining why the rendered
result stays the same. The
reviewer checks this decision against the diff. A disappearing bar, a new error notice and
a changed confirmation value are visual changes even when layout stays the same.

A PR whose change shows on screen carries before and after screenshots. That covers the
desktop app's renderer, the extension's popup and pages, and docs site pages, including copy,
layout, theme and state changes. The implementer captures them before opening the draft or
handing its body to the dispatcher. A change with no visual effect carries none.

1. **Capture.** Take the before shot from a build of `origin/main`, ideally before editing,
   and the after shot at the head under review. Use the same route, window size, theme and
   seed data, so the pair differs only by the change. Save both in a folder of your own,
   `/tmp/birdbrain-shots/<branch>/`, not the shared `/tmp/birdbrain-shots/`, so agents
   running at once cannot overwrite each other's files before the upload.
   - The app: the `run-birdbrain` skill's `size` and `ss` commands, with
     `SCREENSHOT_DIR=/tmp/birdbrain-shots/<branch>` set when the driver starts.
   - A docs site page: headless Chromium,
     `chromium --headless --window-size=1440,900 --screenshot=<png> <url>`, against
     `https://docs.birdbrain.cc` for the before shot (Mintlify deploys `main`) and against
     the local preview `pnpm dlx mint dev` serves for the after shot.
   - The extension's popup and pages: use the browser screenshot tools available in the
     session. If capture tooling is unavailable, follow step 4.
   Seed error paths and unusual states with test data or existing test helpers, then capture
   the running UI. A state that needs a forced error still needs its screenshot pair.
2. **Reference.** In the body file, reference each PNG by its absolute path under
   `## Screenshots`, one bullet per image and one before and after pair per changed screen:

   ```markdown
   ## Screenshots

   - Visual changes: Yes
   - Before, capture viewer: ![before](/tmp/birdbrain-shots/fix-viewer/viewer-before.png)
   - After, capture viewer: ![after](/tmp/birdbrain-shots/fix-viewer/viewer-after.png)
   ```

3. **Upload.** One route serves opening a PR and every later update, under the maintainer's
   `gh` and the dispatcher's `agh` alike. It avoids `gh pr edit`, which fails under the
   machine token (the `dispatch` skill, "GitHub access"). The PR must exist first.
   1. Post the pair as a PR comment:
      `gh pr comment <n> --body-file <comment> --attach <png> --attach <png>` (GitHub CLI 2.99
      or later). The comment file holds the step 2 bullets inside its own `<details>` block,
      under a `Taken at <head sha>.` line, and passes the `post-comment` check first. GitHub
      CLI uploads each file and rewrites every reference to its absolute path as a
      `https://github.com/user-attachments/assets/<id>` link. It prints the comment's URL.
      When some uploads fail it posts the comment with the rest and exits non-zero; when all
      fail it posts nothing.
   2. Read the comment back: the id ends its URL (`#issuecomment-<id>`), and
      `gh api repos/thebristolsound/birdbrain/issues/comments/<id> --jq .body` returns the
      links. A file whose local path is still in the comment did not upload.
   3. Put each link in the body file in place of its local path, then write the body over
      REST, as the `dispatch` skill's "GitHub access" states:
      `jq -n --rawfile body <file> '{body: $body}' > <json>`, then
      `gh api -X PATCH repos/thebristolsound/birdbrain/pulls/<n> --input <json>`. Read the
      body back and confirm every image link is a `user-attachments` URL.

   A fix round that changes a screen again takes a new after shot at the new head and runs
   step 3 for it; the before shot stays.
4. **When capture or upload is blocked.** Report the attempted command, its error and the
   missing screen. A capture blocker stops the PR-opening handoff; an upload blocker leaves
   the existing PR in draft. Resolve the blocker and supply the pair before marking the work
   ready for review. Handing missing screenshots to the maintainer does not satisfy this step.

Never commit the images, and never link another image host. A dispatched implementer returns
the PNG paths with its handoff, and the dispatcher runs step 3 with `agh`. A missing or stale
pair, including a placeholder handed to the maintainer, is a `gate` finding in the reviewer's
"Screenshots" control (`birdbrain-reviewer`).

The upload comment from step 3 is only the route to an attachment link. Screenshots that sit
in a comment and not in the body do not count: a Yes declaration without its pairs in the body
fails the check. No check can tell a false No declaration: only a reviewer reading the diff
catches one, such as the review fleet on a PR the maintainer or the machine account opens.

`scripts/check.sh <body-file>` requires the declaration on every body and checks a Yes
decision for complete Before/After rows with matching screen names. Each image must be a
readable local PNG at an absolute path or a GitHub attachment; the local form allows capture
before the PR exists. Both merge paths (`merge-pr` and the `merge` label workflow) add
`--posted`, which accepts GitHub attachment links only, so a Yes body whose screenshots are
missing, local, or only in a comment cannot merge. A row may use the Markdown image form or
the `<img src="...">` tag GitHub's web editor writes. Image syntax quoted in a code span is
text, not an image. Dependabot bodies skip the check at the label merge.

## How to open a PR

1. Write the body to a file.
2. Run `${CLAUDE_SKILL_DIR}/scripts/check.sh <file>` and fix the file until it exits 0.
3. Open with `gh pr create --draft --body-file <file> ...` (or hand the path to the
   dispatcher, which opens the PR). Never `--body`: the hook blocks it.

## The hook

`scripts/check.sh` runs as a `PreToolUse` hook on `Bash`, registered in `.claude/settings.json`
so it sees every session on every spawn path. It acts only when the hook payload's `agent_type`
is in the `bound=` list at the top of the script (`birdbrain-implementer` today), or when
`BIRDBRAIN_DISPATCH=1`, which `.github/scripts/dispatch/run.sh` sets for every session of a
scheduled cycle; an interactive session or an unbound agent passes through. Agent frontmatter
`hooks:` are not used: sessions that supply the agent roster through the SDK (t3code) drop
them, verified 2026-08-29.
It acts on `gh pr create`, `gh pr edit`, their `agh` forms, and `gh api` calls on a `/pulls`
endpoint that write (`-X POST|PATCH|PUT`, or any `-f`/`-F`/`--input` field, which makes `gh api`
POST implicitly):

- `--body-file <file>` (or `-F <file>`, or `--input <json>` with a `body` field): the file is
  linted by `scripts/lint-body.mjs`; a failure blocks the command and returns the findings.
- `--body <text>` or `-b <text>`, or a `body` field on the command line (`-f body=`,
  `--raw-field body=`, `-F body=@file`): blocked with an instruction to use a file.
- `gh pr create` without `--body-file` (`--fill`, `--template`, `--web`, an editor body):
  blocked; none of those bodies can be linted first.
- An edit that carries no body flag (labels, title, reviewers): allowed.

`scripts/layers.mjs` holds the `<details>` parser and the plain-language check; the comment
linter in `../post-comment/` imports it, so both surfaces read the same rule.
`scripts/test-check.sh` runs the fixtures under `scripts/fixtures/` through both paths.
`fail-1117-walkthrough.md` is the body of PR #1117 as it shipped, kept as the example of what
the cap and the section rule exclude, `fail-payload.json` is a body with no sections, and
`pass-optional-sections.md` adds every optional section. Each other fixture is `pass-filled.md`
or `pass-optional-sections.md` with one change, and the suite checks the finding each fixture
for a rule this layout added must raise.
