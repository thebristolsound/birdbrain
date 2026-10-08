# Case investigation view mock feasibility assessment

Date: 2026-10-04
Reviews:
[`docs/design-handoff/2026-10-04-case-investigation-view/`](../design-handoff/2026-10-04-case-investigation-view/),
the Investigate section of its `Birdbrain.dc.html` and the reference drawings in
`Case Investigation.dc.html`.
Contract: the [Case investigation view UI brief](2026-10-03-case-investigation-view-ui-brief.md)
as merged with the 2026-10-04 rulings, and the
[Case investigation engine spec](2026-10-02-case-investigation-engine-design.md).
Format follows the [Shared Case members assessment](2026-09-19-shared-case-members-feasibility-assessment.md):
a verdict, a size, and the constraint behind any Modify. No redesigns; the designer revises the
mock.

The bundle carries no `ENGINEERING_REVIEW.md`, although its `HANDOFF.md` refers to one, so the
items below use the brief's numbering: surfaces 1 to 10, then states 1 to 17. Where the live
prototype and the reference drawings differ, the README makes the live prototype the authority;
this assessment says which file it read for each item.

## What the sizes cover

Sizes cover the renderer work for each item, given an engine that serves it. None of the engine
exists today: the database at schema version 37 has no Subject, Joint, decision, Source Class,
or run tables, and the retrieval spec's first slice (link target and header field records,
fielded search, the exact check) is not built. The engine spec puts that slice first, and the
ADR it lists under "Follow-ups this spec needs" must define the Case data outside the Manifest
and the Case revision before any of it is stored. Engine work is sized when that ADR lands, not
here.

Sizes: XS under half a day, S one or two days, M three to five days, L one to two weeks.

## Summary

| Item | Name                                     | Verdict                                                  | Size |
| ---- | ---------------------------------------- | -------------------------------------------------------- | ---- |
| S1   | Starting a run                           | Modify: Note entry starts a Joint; screening cap missing | M    |
| S2   | View header                              | Modify: add the follow-depth line                        | S    |
| S3   | Joint map and Joint list                 | Modify: real layout, map semantics, Shared Case status   | L    |
| S4   | Joint detail                             | Modify: passage group shows its ceiling                  | L    |
| S5   | Source inspector                         | Modify: four brief items missing                         | M    |
| S6   | Gap list                                 | Modify: add the lost-support group                       | S    |
| S7   | Narrow-window arrangement                | Accept, with the breakpoint measured on the view         | S    |
| S8   | AI analysis settings                     | Modify: disclosure copy; local model needs a disclosure  | M    |
| S9   | The Operator's own identifiers           | Accept                                                   | S    |
| S10  | Choosing between same-name Subjects      | Accept                                                   | M    |
| 1    | Empty Case                               | Accept                                                   | XS   |
| 2    | Run in progress                          | Accept                                                   | S    |
| 3    | No Joints found                          | Accept                                                   | XS   |
| 4    | `cannot-check`                           | Accept                                                   | XS   |
| 5    | Content Hash mismatch or missing file    | Accept                                                   | S    |
| 6    | Withheld Exhibit                         | Modify: withholding puts the run out of date             | XS   |
| 7    | Rejected Joint                           | Accept                                                   | XS   |
| 8    | Same-name Subjects                       | Accept; built with S10                                   | -    |
| 9    | Lookup consent prompt (later)            | Accept as drawn; not built in the first slice            | -    |
| 10   | Run basis out of date                    | Modify: which changes put a run out of date              | XS   |
| 11   | Unreviewed material on an accepted Joint | Accept                                                   | XS   |
| 12   | Contested Joint                          | Modify: the undecided-member half is not drawn           | S    |
| 13   | AI layer on                              | Modify: placeholder model name                           | XS   |
| 14   | Hosted provider disclosure               | Modify: copy, as S8                                      | XS   |
| 15   | Run invalidated                          | Modify: carry it into the live screen                    | S    |
| 16   | AI analysis failed or partial            | Modify: carry it into the live screen                    | S    |
| 17   | Review before sending                    | Modify: withheld limit, hash line, unconnected members   | S    |
| -    | Tokens, type and radii                   | Modify: map onto the existing system                     | XS   |
| -    | Map accessibility                        | Modify: drop `role="application"`                        | XS   |

## Surfaces

### S1. Starting a run: Modify (M)

The setup card, its fact grid, the hosted text preview, and **Find more material** pre-filling
it are accepted. Three constraints:

- **The Note entry starts a Joint.** The brief's **Find material for this claim** has the
  Operator select a claim in a Note and name its Subjects; the run records a Joint whose claim
  is that Note text, started by the Operator. The prototype's **Start a Joint from a Note
  claim** writes "Claim from Note N-3: ..." into the inquiry field instead, which runs an
  inquiry and records no Joint. Draw the action in the Notes editor, on a selected passage,
  with the Subject picker, and show the Joint it records ("proposed by you, from N-3").
- **Screening cap.** The AI-layer row "Pairs compared without screening", with its cap and a
  way to raise it, is missing. The header shows the resulting count, so the input has to exist.
- **Withheld rows.** "Clear my flag" is accepted. A change here advances the Case revision like
  any other withholding change (state 6).

### S2. View header: Modify (S)

Accepted except one missing line. The brief asks for how far the run followed identifiers,
"Followed: 2 Joints out from each starting Subject", because the base layer stops at two and
the Operator follows further by running again from a selected Subject. Add it to row 2. The
candidate claims and search terms in row 3, labelled as the provider's wording, answer the
brief's request for a labelled place and are accepted.

### S3. Joint map and Joint list: Modify (L)

The status grammar is accepted: a solid line for accepted, round dots for proposed, a hairline
with a cross and struck text for rejected, a double rule for contested, and the word every time.
Round dots do not read as the Link Map's dashes, which `backlinkMapModel.ts` draws as
`strokeDasharray: '3 3'`. The fold chip, the "showing N of M" disclosure, the complete list,
the path row, and the path beside a rejected or proposed direct Joint (G11) are accepted.
Three constraints:

- **Layout.** The prototype places Subjects at fixed coordinates in a 500-pixel design space.
  Engineering needs a layout it can compute: deterministic, so two runs on the same state draw
  the same map, stable when one Subject is added, and written as a pure model module beside the
  view the way `backlinkMapModel.ts` sits beside `BacklinkMap.tsx`, with no new dependency. The
  designer's part is the rules it follows: where starting Subjects sit, how a path reads left
  to right, and where a single-Subject Joint's tab goes when two hang from one Subject.
- **Shared Case status.** The brief asks that every status in a Shared Case names the members
  behind it ("accepted by NK") and shows when the member looking has not decided yet. The
  prototype names members only on a contested Joint. Draw the label for a Joint one member has
  decided, as each member sees it (state 12).
- **Type.** Map text at 9.5 and 11.5 pixels comes onto the agreed type scale (see "Tokens,
  type and radii").

### S4. Joint detail: Modify (L)

Accepted in full except the passage group, which has to show the ceiling above which a passage
becomes a group (Spec, "Distinctiveness and noise"); the prototype shows only the count ("Footer
repeated in 9 Exhibits"). The Accept-unavailable reasons, including the side-named G9 reason,
the lost-side notice, member cards grouped by member, the optional Reject reason, and **Restore
to proposed** are accepted. Sized L because each reversal writes history and each row derives
from the Case revision, not because the drawing is unclear.

### S5. Source inspector: Modify (M)

The stored-span treatment, the Wayback Ref with its three labelled times, the candidate row,
and **Mark as my own** are accepted. Four brief items are missing:

- A headers-only Exhibit's "Body not acquired" line.
- "unattested" beside a claim check whose stored text the Manifest never hashed (decision 17).
- How many Exhibits hold the marked identifier, for example "in 3 of 994 Exhibits".
- In a Shared Case, two members' different Source Classes before they sync: both values, each
  with its member, an action that chooses one, and the rule that the Exhibit counts as
  unclassified, or supports nothing when either value is AI-origin.

The AI suggestions also need the dismiss action the brief asks for beside **Take suggestion**,
and the dismissal goes to history.

The Withheld from analysis checkbox is labelled as not putting the run out of date. That is the
inverse of the spec; see state 6.

### S6. Gap list: Modify (S)

The grouping and the entry routing are accepted. Add the group the merged brief added:
accepted Joints that have lost their last available support, and accepted two-Subject Joints
that have lost one side. The prototype shows a lost side on the Joint row but lists it in no gap
group. The prototype's entries are fixed demonstration text; engineering derives each group
from Case state, which needs nothing more from the drawing.

### S7. Narrow-window arrangement: Accept (S)

The 1150-pixel answer to question 4 is accepted with one constraint: measure the view's own
width, not the window. The prototype reads `window.innerWidth`, but the app's sidebar rail is 48
pixels (`w-12` in `Sidebar.tsx`). The three panes need 500 + 340 + a detail pane of at least 300
pixels, so tabs start when the view is narrower than about 1140 pixels. At the default 1200-pixel
window the view is 1152 pixels wide, so the default shows three panes.

### S8. AI analysis settings: Modify (M)

The two levels and the per-Case toggles are accepted. Two constraints:

- **Hosted disclosure copy.** The **Receives** row reads "...; never withheld material". The
  brief forbids that promise (decision 21 and the copy constraints) because Birdbrain cannot
  detect a short, edited, or paraphrased quotation of a withheld Exhibit in an inquiry or a Note.
  Use decision 21's limit: a withheld Exhibit's own text and a Note anchored to it are never
  sent; inquiry or Note text that repeats a run of words from one is blocked; a shorter or
  edited quotation or a paraphrase is not detected. The same row appears in the reference
  drawing of state 14.
- **Local model disclosure.** The local provider turns on with no disclosure. The brief gives a
  local model its own disclosure, naming the model and its version, before the Operator turns
  it on. Draw it, shorter than the hosted one: no region and no Egress, and a line saying its
  text stays on this machine.

### S9. The Operator's own identifiers: Accept (S)

Settings beside Personas, with each Case showing synced entries read-only as "marked by NK",
answers question 12 and is accepted. Adding or removing an entry advances the Case revision, so
the next view of an earlier run shows state 10.

### S10. Choosing between same-name Subjects: Accept (M)

Subject detail with **About this Rowan Pike**, **About neither**, the placed rows, and their undo
is accepted, and so is reaching it from a Subject with no Joints on the map and in the list.

## States

### 1. Empty Case: Accept (XS)

**Import a Case file** points at the existing Case Archive import (`ImportCaseDialog.tsx`); the
prototype's toast saying it is not in this slice is a prototype gap only.

### 2. Run in progress: Accept (S)

Including the cancel line and the hosted line that says sent text cannot be recalled.

### 3. No Joints found: Accept (XS)

### 4. `cannot-check`: Accept (XS)

The rule that a `cannot-check` span offers no **Add as support** is accepted.

### 5. Content Hash mismatch or missing file: Accept (S)

"Changed since capture" and "Missing" are the app's existing Integrity Status labels
(`ProvenanceBadge.tsx`, `getProvenanceColor.ts`).

### 6. Withheld Exhibit: Modify (XS)

The drawing is accepted. The rule behind it is not: `HANDOFF.md` records "withholding no longer
stales the run", read from G12. G12 covers only the Operator's decisions on a run's proposals.
The spec's "Investigation flow", step 1, advances the Case revision on any change to Withheld
from analysis, Source Class, copy marks, the Operator's own identifiers, Subjects, Joints, Notes,
or Extracted Data rows, and only decisions on the run's own proposals are exempt. Withholding an
Exhibit after a run therefore puts the run out of date. Remove "does not stale the run" from the
inspector.

### 7. Rejected Joint: Accept (XS)

### 8. Same-name Subjects: Accept

Built with S10; no separate size.

### 9. Lookup consent prompt: Accept as drawn (later)

The per-request prompt and the Direct-connection warning before it are accepted for the later
phase. Not built in the first slice, which has no external lookup; G7 stays open.

### 10. Run basis out of date: Modify (XS)

The banner is accepted. The trigger is the one in state 6: a new Exhibit, a changed Note, and
every other run-input change put the run out of date; the Operator's decisions on its proposals
do not.

### 11. Unreviewed material on an accepted Joint: Accept (XS)

### 12. Contested Joint: Modify (S)

The NK-accepted, MB-rejected drawing is accepted. The merged brief also asks for a Joint NK
accepted and MB has not decided, as MB sees it. It is not drawn; see S3.

### 13. AI layer on: Modify (XS)

Accepted except the model name. "Ollama · llama3.1" names a real runtime and model, and the
spec has not chosen one (open decision 1), which is why the brief asks for a placeholder. Use a
name that cannot be read as a choice, such as "Local model (placeholder)".

### 14. Hosted provider disclosure: Modify (XS)

The copy change in S8.

### 15. Run invalidated: Modify (S)

The reference drawing is accepted. The live screen does not reach this state; carry it in, with
the Shared Case trigger the brief adds: a withholding flag that arrives by sync is such a
change.

### 16. AI analysis failed or partial: Modify (S)

The reference drawing is accepted. The live screen does not reach this state; carry it in, with
the line naming the hosted provider and model when text had already gone to it before the
failure.

### 17. Review before sending: Modify (S)

The dialog shape is accepted. Three constraints from the merged brief:

- Replace "Birdbrain blocks Note text that repeats a withheld Exhibit (E-07). It cannot detect a
  short or reworded quotation." with decision 21's limit, which covers inquiry text as well as
  Note text and ends with the Operator's reading of the list being the remaining check.
- Add the line that no passage is sent before its hash checks pass, and one that fails is never
  sent.
- In a Shared Case, name each member this installation is not connected to and when it last
  synced, in this dialog. The prototype puts that note in the progress card and the header
  only.

## Cross-cutting

### Tokens, type and radii: Modify (XS)

- **Status colors.** The proposed `--bb-ok`, `--bb-warn`, and `--bb-alert` duplicate tokens
  `globals.css` already has: `--color-success-fg`, `--color-warning-fg`, and
  `--color-danger-fg`. The dark values match; the light warning and danger values differ
  (`#b45309` against `#92400e`, `#dc2626` against `#b91c1c`). Use the existing tokens. `--bb-sel`
  can be `--color-accent-subtle` unless the designer shows why it must differ.
- **Type.** The Investigate screen also uses 9, 9.5, 10.5, 11.5, 13, 15, and 16 pixels. The
  agreed scale is 10 / 11 / 12 / 14 / 18. Snap each to the scale.
- **Radii.** 3-pixel chips and 8-pixel dialogs come onto 2 / 4 / 6, with dialogs at 6 as the
  agreed system sets for overlays.

### Map accessibility: Modify (XS)

The map's keyboard handling (arrows through Joints in list order, Enter, Escape) is accepted.
Its `role="application"` is not: it turns off a screen reader's normal reading keys inside the
map, and the brief already makes the Joint list the screen-reader equivalent. Use a labelled
group with the same keyboard handling, and keep the list as the equivalent.

## What the mock answered

The designer's calls on the brief's twelve questions are accepted where no item above modifies
them: Subjects as kind-labelled cards with a fold above 8 Subjects (1); round dots and the "Joint
map" label to keep apart from the Link Map (2); a sixth Case section, **Investigate**, between
Signals and Data (3); tabs below about 1150 pixels, measured on the view (4); the text axis as a
code chip and the reading as prose (5); one sentence of counts and a bordered weak chip (6); a
distinguishing detail on same-name Subjects (7); a tab under the Subject for a single-Subject
Joint (8); a path as haloed Joints plus a sentence, never a line (9); a double rule with both
Member Codes (10, extended by state 12); "proposed by" in one place for the base layer and a
provider (11); and own identifiers in Settings beside Personas (12).

## Revision received 2026-10-06

The designer revised the mock against this assessment. The accepted revision is
[`docs/design-handoff/2026-10-06-case-investigation-view/`](../design-handoff/2026-10-06-case-investigation-view/),
and it supersedes the 2026-10-04 bundle. Engineering read the revised source against the
Modify items above and against
[ADR-0042](../adr/0042-investigation-records-are-case-data-outside-the-manifest.md), but did
not click through the prototype in a browser.

An earlier revision that day left three gaps, which the accepted revision closes:

- **Decisions on Joints the run did not create.** Each Joint now records the run that created
  it, and a decision on a Joint from another run puts the shown run out of date, as ADR-0042
  requires.
- **Adding an own identifier.** Adding an identifier in Settings now puts the run out of date,
  as removing one already did (S9).
- **The README rules.** The README's rule on which changes put a run out of date now matches
  ADR-0042, and its token names, model placeholder and narrow-window width match the prototype.

Two differences remain, and the build follows ADR-0042 and state 13 rather than the mock:

- Editing a Note outside the Investigate section leaves the shown run current in the prototype.
  ADR-0042 lists a changed Note among the changes that put a run out of date.
- The reference drawings in `Case Investigation.dc.html` still name a specific local model. The
  live prototype uses `Local model (placeholder)`.
