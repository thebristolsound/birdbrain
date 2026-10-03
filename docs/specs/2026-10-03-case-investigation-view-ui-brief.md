# Case investigation view UI design brief

Date: 2026-10-03
Audience: the designer working in the "Birdbrain UI" design project. Engineering contact: the
maintainer.
Status: draft. This brief depends on the Case investigation engine spec in pull request #1714
(`2026-10-02-case-investigation-engine-design.md`) and on the review comment on that pull
request that begins "Review: changes requested". Where the two disagree, this brief follows the
review. Do not send it to the designer until #1714 settles; the gaps marked **GAP** below are
decisions the spec leaves open.
Source of decisions: the engine spec, the review, and the
[Case retrieval pipeline spec](2026-10-02-case-retrieval-pipeline-design.md). This brief covers
only what a designer needs to draw the surfaces.

## What the feature is

The Operator gives Birdbrain an inquiry about a Case, such as "map the links between Rowan Pike
and the account @tidewright". Birdbrain finds everything in the Case that could be related, by
link analysis, and shows three things:

- **A joint map.** A map of the proposed joints between the people and accounts the inquiry
  names.
- **Claim checks.** A check of each claim against the stored Exhibit it cites.
- **A gap list.** What the Case cannot support yet.

Every joint opens the exact stored span on each side. The Operator accepts, rejects, merges, or
splits joints.

Birdbrain does not write the argument. The Operator writes it, elsewhere, from the joints they
accept.

### Terms

A **joint** is one link between two named people or accounts in a Case, together with the
Exhibit spans that support it and the spans that conflict with it. A joint is proposed until the
Operator accepts it. The term comes from the engine spec and is pending adoption in
[`CONTEXT.md`](../../CONTEXT.md); the review asks for that change.

An **inquiry** is the question the Operator asks, and a **run** is one pass of Birdbrain over the
Case to answer it. A **claim check** is the result of testing one claim against one stored
Exhibit. All three terms are pending as well. Every other term in this brief is the
`CONTEXT.md` term.

## Decisions the mock must honor

These are settled in the spec or the review. Do not redesign them; design around them. "Spec"
is the engine spec in #1714, "Review" is the review comment on it, and "Retrieval" is the
retrieval pipeline spec.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                  | Source                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | A joint is proposed until the Operator accepts it. Proposed and accepted joints differ by line style and by text, never by color alone.                                                                                                                                                                                                                   | Spec, "Visual design"; Review, "Checked and correct"                     |
| 2   | Every joint opens the exact stored span on each side: the Exhibit, its Content Hash, and a locator (text passage, PDF page, mail message and header field, link target, image alt text, or byte range).                                                                                                                                                   | Review, items 2 and 4; Retrieval, "Representations and locators"         |
| 3   | The source inspector shows the stored Exhibit at the exact span with its Content Hash. It never substitutes a search snippet, a preview, or a live page.                                                                                                                                                                                                  | Spec, "Visual design"; Retrieval, "Constraints"                          |
| 4   | A claim check reports two separate things: whether the text is `present`, `absent`, or `cannot-check` in the named Exhibit, and a proposed reading of whether that passage `supports`, `conflicts`, or is `unclear`. The mock shows both.                                                                                                                 | Spec, "What a run produces" and flow step 4; Review, item 10             |
| 5   | A matching phrase does not prove the claim. A check result is never labelled as a verification, and the proposed reading is always labelled as proposed.                                                                                                                                                                                                  | Spec, "Product promise" and "Options and recommendation"                 |
| 6   | The view states how many Exhibits are eligible for the run and how many are excluded.                                                                                                                                                                                                                                                                     | Spec, "Visual design"; Review, "Checked and correct"                     |
| 7   | Staging Pool files and excluded Exhibits never appear as support for a joint.                                                                                                                                                                                                                                                                             | Spec, "Retrieval, analysis, and custody"; Retrieval, "Constraints"       |
| 8   | A Note can supply a claim to check. It never counts as support. A joint whose only basis is a Note, a commercial report, or an AI-origin document is flagged as such.                                                                                                                                                                                     | Spec, flow steps 2 and 5; Retrieval, "Representations and locators"      |
| 9   | Each joint lists its strongest original or contemporaneous source first, then other sources and conflicts. A joint with one weak source stays visibly weak.                                                                                                                                                                                               | Spec, "What a run produces" and flow step 5                              |
| 10  | Two people with the same name stay separate until an Exhibit supports a joint between them.                                                                                                                                                                                                                                                               | Spec, flow step 1                                                        |
| 11  | The default source is the stored Case only, and the first slice offers no other. When external lookup arrives later, it shows its destination, its query or URL, and the Egress it uses before anything is sent. A page found that way is a candidate with its own observation time; it supports nothing until the Operator captures it as a new Exhibit. | Spec, "Visual design" and flow step 6; ADR-0032                          |
| 12  | A cited span whose Exhibit no longer matches its Content Hash is unavailable. The view never shows it as plausible support.                                                                                                                                                                                                                               | Retrieval, "Constraints"                                                 |
| 13  | The inquiry, the exclusions, the Manifest head, and a snapshot of the relevant Notes travel with the run, so a later edit to the Case cannot quietly change what the run was based on.                                                                                                                                                                    | Spec, flow step 1                                                        |
| 14  | The run is read-only. It writes no Manifest Entry and commits no Exhibit.                                                                                                                                                                                                                                                                                 | Spec, "Evaluation and first slice"                                       |
| 15  | The joint map is a new investigation view. It does not silently reuse the Link Map or its 20-node ceiling.                                                                                                                                                                                                                                                | Spec, "Visual design"                                                    |
| 16  | WCAG 2.2 AA is the product target. The joint list is the keyboard and screen-reader equivalent of the map: everything the map shows and every action it offers is reachable from the list. You may propose a different equivalent.                                                                                                                        | Review, item 16; [standards](../agents/osint-investigation-standards.md) |
| 17  | The window minimum is 900 by 600 and the default is 1200 by 800 (`src/main/windowSize.ts`).                                                                                                                                                                                                                                                               | Review, item 14                                                          |
| 18  | On a narrow window the panes become tabs and keep the selected joint and Exhibit. The test: the Operator can reject one tempting but unsupported joint without losing their place in the joint list.                                                                                                                                                      | Spec, "Visual design"                                                    |

## Surfaces to draw

Draw each surface in the existing design language of the Birdbrain UI project. Use the theme's
semantic tokens, not raw color values. The surfaces are numbered so the engineering response can
give a verdict per item.

Each surface and state is labelled **first slice** or **later**. Draw the first slice first. The
first slice is local only: an inquiry goes in, the joint map and gap list come out, and each
joint opens its stored span. Its source trail uses only what the Case already holds. External
lookup comes later, after its consent behavior is reviewed (Spec, "Investigation flow", closing
paragraph; Review, item 4). Where one surface mixes the two, the later part is labelled inline.

### 1. Inquiry entry and scope review (first slice, with a later part)

Where the Operator starts a run. Contents:

- **Inquiry field.** Free text, for example "Map the links between Rowan Pike and @tidewright".
- **Subject and starting accounts.** The names and accounts the run starts from, editable before
  the run. If the Case holds two people named Rowan Pike, the Operator sees both, separately
  (decision 10).
- **Exclusions.** The exclusions the run applies, with the resulting counts: for example
  "Eligible 412 Exhibits, excluded 9". **GAP G4:** the spec does not say what exclusion
  categories exist or who may change them. Draw a list region with placeholder rows; do not name
  categories.
- **Sources.** The first slice shows "Stored Case only" as a fixed line (decision 11). _Later:_ a
  toggle whose alternative allows external lookups that each ask first, visible but off by
  default.
- **What the run records.** A short line saying the run keeps the inquiry, the exclusions, and the
  Case state as of now (decision 13).
- **Run** action.

### 2. View header (first slice)

Visible on every arrangement: the Case name, the eligible and excluded counts (decision 6), the
sources setting, and the run's basis ("Case as of 14:02, 3 October"). The excluded count opens
a list of the excluded Exhibits by Exhibit Number.

### 3. The joint map and the joint list (first slice)

The primary surface. The map and the list show the same joints; selecting a joint in either
selects it in both and opens its detail (surface 4).

Each joint shows:

- Its two sides, by name or account.
- Its status: proposed, accepted, or rejected, by line style and text (decision 1).
- Its support at a glance: the count of supporting and conflicting Exhibits, and a visible mark
  when it rests on one weak source or only on a Note, commercial report, or AI-origin document
  (decisions 8 and 9).
- A slot for a strength label. Leave room for it and do not name a label (question 6).

**GAP G1:** the spec says a joint connects two named people or accounts. It does not say whether
publications, sites, addresses, or dates are also nodes on the map, or appear only as evidence
inside a joint's detail. Draw people and accounts as nodes, and mark where the other kinds would
go if they become nodes.

### 4. Joint detail (first slice)

One joint, opened. Contents:

- **The two sides**, each with the stored span that names it, opening in the source inspector
  (decision 2).
- **Supporting Exhibits**, strongest original or contemporaneous source first (decision 9). Each
  row: Exhibit Number, kind, the span's locator, the dates it carries, and its claim check on
  both axes (decision 4).
- **Conflicting Exhibits**, listed with the same row shape.
- **Dates.** Label which date each one is: the capture time, a date the source states, or a
  trusted timestamp ("stamped at"). Show a missing date as missing.
- **Provenance class.** **GAP G5:** the spec uses the term without defining its values. Leave a
  labelled slot.
- **Actions:** **Accept**, **Reject**, **Merge**, **Split**. **GAP G2:** the spec does not say
  whether merge and split act on joints or on the people at either end, and merging two people
  is itself an identity claim. It also does not say whether these decisions outlast the run.
  Draw accept and reject fully; draw merge and split as entry points only.

### 5. Source inspector (first slice, with later parts)

The stored Exhibit at the exact span (decision 3). Contents:

- Exhibit Number, kind, and Content Hash (short form, expandable).
- The stored representation at the locator, with the span marked: a text passage, a PDF page, a
  mail message with the header field, a link target or alt text shown as its exact stored value,
  or a byte range. A headers-only Exhibit says "Body not acquired".
- **Source trail**, kept visibly apart from the stored Exhibit: the stored URL or document origin
  and any pinned Wayback Snapshot the Case already holds, each with the time it was observed.
  _Later:_ candidates found by external lookup, each with its observation time, whether its
  content matches the stored Exhibit, and a label marking it as a candidate (decision 11).
- _Later:_ **Find the original** action, which opens the lookup consent prompt (state 9).

### 6. Gap list (first slice, with later parts)

What the run could not support. Group the entries by kind:

- Claims with no supporting Exhibit.
- Joints with conflicting Exhibits.
- Joints that rest on one weak source or only on a Note, commercial report, or AI-origin document.
- Missing dates.
- Missing originals: a stored copy whose original source the Case does not hold.
- Searches not yet run, including external lookups the Operator has not allowed.

Each entry opens the joint or claim it belongs to. In the first slice an entry for a search not
yet run is listed without an action. _Later:_ that entry opens the lookup consent prompt.

### 7. Narrow-window arrangement (first slice)

Between the 900-pixel minimum and the 1200-pixel default, the map, the joint detail, and the
source inspector cannot all sit side by side. Draw the tabbed arrangement and show that the
selected joint and Exhibit carry across tabs (decision 18). The width at which panes become tabs
is your call (question 4).

## States to draw

States 1 to 8 and 10 are first slice. State 9 is later.

1. **Empty Case.** No eligible Exhibits. The view says so and does not offer a run.
2. **Run in progress.** Progress at the Case level, with the counts so far. The Operator can
   cancel.
3. **No joints found.** The run finished with nothing to propose. The gap list may still have
   entries.
4. **`cannot-check`.** A claim check that could not run, with the reason (for example, the text
   sits in an image the run cannot read). It is distinct from `absent`.
5. **Content Hash mismatch.** An Exhibit whose stored bytes no longer match. It displays as
   "Changed since capture" (the `CONTEXT.md` display name for this Integrity Status), its spans
   are unavailable, and any joint that relied on it shows the lost support (decision 12).
6. **Excluded Exhibit.** How an Exhibit excluded from the run appears where the Operator might
   expect it: in the excluded list, never as support (decision 7).
7. **Rejected joint.** Still visible, marked rejected by line style and text, and recoverable.
8. **Same-name conflict.** Two people named Rowan Pike on the map as separate nodes, with the
   gap entry that says no Exhibit links them yet (decision 10).
9. **Lookup consent prompt** (later). Before an external lookup: the destination (for example
   `web.archive.org`), the exact query or URL, the Egress it will use, and a plain statement that
   the destination sees the request. Actions: **Send**, **Cancel**. **GAP G7:** the spec has not
   decided which destinations may be approved once per run and which need a prompt every time.
   Draw the per-request prompt.
10. **Run basis out of date.** The Case changed after the run (a new Exhibit, a changed Note).
    The view says the run reflects the Case as of its start and offers a new run (decision 13).
    **GAP G3:** the spec does not say where a run is stored or whether a past run can be
    reopened, so do not draw a run history.

## Open gaps

The spec leaves these open. Each one is marked where it falls above; draw the placeholder that
the marked text describes, and do not settle the decision in the mock.

| Gap | What is undecided                                                                                   | Where it is decided          |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| G1  | Whether publications, sites, addresses, and dates are nodes on the map or only evidence in a joint. | Engine spec; Review, item 9  |
| G2  | What merge and split act on, and whether accept, reject, merge, and split outlast the run.          | Engine spec; Review, item 7  |
| G3  | Where a run is stored, what Case delete does to it, and whether a past run can be reopened.         | Engine spec; Review, item 7  |
| G4  | Which exclusion categories exist, including AI-origin material, and who may change them.            | Engine spec, open decision 2 |
| G5  | The values of a joint's provenance class.                                                           | Engine spec                  |
| G6  | Whether the first slice uses a model, and if so how the view names it.                              | Engine spec; Review, item 4  |
| G7  | Which lookup destinations may be approved once per run and which need a prompt every time.          | Engine spec, open decision 3 |

## Copy constraints

The repo's claim-discipline rules apply to every string in the mock
(`docs/agents/writing-guide.md`, "Claim discipline"):

- Never write _verified_, _confirmed_, _proven_, or _same person_ for a joint or a check.
  `present` says the text is in the stored Exhibit; `supports` is a proposed reading. Neither
  says the claim is true.
- Label every interpretation Birdbrain offers as proposed, including that two names belong to
  one person.
- Do not write _AI-powered_. **GAP G6:** the review asks whether the first slice needs a model at
  all. If it does, the view names the model and says the analysis runs on this machine; leave
  room in the header for that line.
- Say where a request goes. The consent prompt names the destination and what is sent.
- Use the project's terms: Case, Exhibit, Exhibit Number, Content Hash, Note, Operator, Staging
  Pool, Egress, Wayback Snapshot. In a Shared Case an Exhibit Number carries its Member Code
  (`NK-12`).
- "Account" in this view means an account belonging to the subject of the inquiry. Do not call it
  a Persona; a Persona is the Operator's own browser identity.
- Avoid _entity_, _hit_, _evidence_ (for a Note), _link_ (for a Mention), and _workspace_.
- Use invented names, sites, and documents in every example, as this brief does. The worked
  investigation behind the spec is a live Case.

## Questions for the designer

The designer's calls, not settled by the spec or the review:

1. What a node and an edge look like, and how the map stays readable for a Case of about 1,000
   Exhibits. The Link Map caps itself at 20 nodes and discloses "showing N of M"; this view does
   not inherit that cap (decision 15), but any truncation it does apply must be disclosed.
2. How the joint map and the Link Map on the Case Overview avoid colliding visually. They are
   separate views (decision 15), but the Link Map already uses dashed edges for authored
   references, so the proposed-versus-accepted line style must not read as that convention, and
   the Operator must be able to tell at a glance which map they are looking at.
3. Where the view lives in the app and how the Operator reaches it. The Case sidebar today has
   five sections: Overview, Captures, Notes, Signals, and Data.
4. At what width, between 900 and 1200 pixels, three panes become tabs.
5. How the two claim-check axes read at a glance, so `absent` and `conflicts` are never mistaken
   for each other.
6. How a weak joint stays visibly weak. Strength labels are undecided (open decision 5 in the
   spec), so leave room for a label and do not name one.
7. How two people with the same name are told apart on the map and in the list.

## Not in scope

Do not draw these:

- A generated argument, draft, or editable cited argument, or a pane for one. Birdbrain does not
  write the argument (Review, item 1).
- Promoting anything from this view into a Brief or an Evidence Package.
- Model or runtime selection, and any hosted-model path, including the read-only MCP server
  route the spec mentions.
- The Case search changes and the unannotated-Capture review view from the retrieval spec. They
  are a prerequisite of this view and are drawn separately.
- Any change to the Link Map on the Case Overview.

## Deliverable

A mock in the "Birdbrain UI" design project covering the seven surfaces and ten states above,
with the first-slice parts drawn first, delivered through the design handoff round trip described in the current bundle's
`ENGINEERING_REVIEW.md` under `docs/design-handoff/`. Engineering answers with a verdict, a size,
and the constraint behind each numbered surface and state, as the Shared Case members feasibility
assessment did.
