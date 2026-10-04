# Case investigation view UI design brief

Date: 2026-10-03
Audience: the designer working in the "Birdbrain UI" design project. Engineering contact: the
maintainer.
Status: draft. Do not send it to the designer until #1714, the Case investigation engine spec
(`2026-10-02-case-investigation-engine-design.md`), settles. #1720, which added this brief's
vocabulary to [`CONTEXT.md`](../../CONTEXT.md) and recorded
[ADR-0039](../adr/0039-ai-analysis-is-an-opt-in-layer-over-a-model-free-base.md), has merged. The
one gap marked **GAP** below is a decision still open.
Source of decisions: the engine spec; the review comment on #1714 that begins "Review: changes
requested"; the [Case retrieval pipeline spec](2026-10-02-case-retrieval-pipeline-design.md); and a
design session with the maintainer on 2026-10-03, recorded in #1720. Where the spec disagrees with
the review or the session, this brief follows the later decision. It covers only what a designer
needs to draw the surfaces.

## What the feature is

The Operator asks Birdbrain a question about a Case: "Who owned the _Marlow Star_ between 2019 and
2022?", "Which sites republished the 12 March article?", or "Are M. Calloway, Jun Sato, and The
Ferryman the same writer?". Birdbrain finds what in the Case it can match to the question and shows
three things:

- **A Joint map.** The Subjects the question touches and the Joints between them.
- **Claim checks.** A check of each claim against the stored Exhibit it cites.
- **A gap list.** What the Case cannot support yet.

Every Joint opens the exact stored span of each Exhibit it cites. The Operator accepts or rejects
Joints, reviews material Birdbrain surfaces for or against them, and can ask for more material on
any Joint or on a claim in a Note.

Birdbrain finds only what it can match. Without the AI layer it matches shared identifiers and
identical text, so a relation stated only in prose, such as a sentence saying a company owned a
vessel, becomes a Joint when the Operator writes the claim in a Note and starts a Joint from it. An
empty result never means there is no connection.

A question about three Subjects, such as whether three pseudonyms are one writer, never becomes a
three-way Joint. Each Joint is about one Subject or between two, with cited spans of its own; the
map shows which pairs have a Joint, which are reached only through a path, and which have nothing
yet.

Investigations differ. Some are about one person and their pseudonyms; others are about companies
and vessels, copied articles, or an event and the documents around it. Draw for all of them.

Birdbrain does not write the argument. The Operator writes it, elsewhere, from the Joints they
accept.

### Terms

These are `CONTEXT.md` terms:

- A **Subject** is anything a Case investigates that a claim can be about: a person, pseudonym,
  organization, account, site, document, place, or event. It has a name and a kind, and the Operator
  can add kinds.
- A **Joint** is one claim about a Subject, or between two Subjects, together with the Exhibit spans
  that support it and the spans that conflict with it.
- A **Source Class** is the Operator's classification of what kind of source an Exhibit is:
  original, contemporaneous report, later copy or retelling, commercial or aggregator report,
  AI-origin, or unclassified.
- **Withheld from analysis** is an Operator flag that keeps an Exhibit out of every analysis in its
  Case.

Four working phrases are not glossary terms: an **inquiry** is the Operator's question, a **run** is
one pass of analysis over the Case, a **claim check** is the result of testing one claim against one
stored Exhibit, and the Operator's **own identifiers** are the accounts and addresses that belong to
the Operator or their Personas, which Birdbrain never follows.

## Decisions the mock must honor

These are settled. Do not redesign them; design around them. "Spec" is the engine spec in #1714,
"Review" is the review comment on it, "Retrieval" is the retrieval pipeline spec, and "Session" is
the 2026-10-03 design session as recorded in #1720.

### Joints and their status

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | A Joint is proposed until the Operator accepts or rejects it. Proposed, accepted, rejected, and contested Joints differ by line style and by text, never by color alone.                                                                                                                                                                                                                                                                                                                                                                         | Spec, "Visual design"; Session                             |
| 2   | Acceptance is the Operator's judgement. Nothing in the view calls a Joint proven, verified, or confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Session; Spec, "Product promise"                           |
| 3   | Accepting a Joint never merges its Subjects. Three pseudonyms the Operator believes are one writer stay three Subjects joined by accepted Joints. There is no merge or split action.                                                                                                                                                                                                                                                                                                                                                             | Session                                                    |
| 4   | Joints never derive from other Joints. When one Subject reaches another only through a third, the view shows the path and its Joints in order, never a Joint of its own. A direct Joint between the ends needs Exhibit spans of its own.                                                                                                                                                                                                                                                                                                         | Session                                                    |
| 5   | Two Subjects with the same name are always two Subjects. Birdbrain proposes no Joint between them unless an Exhibit supports one, and a Joint between them connects them without collapsing them.                                                                                                                                                                                                                                                                                                                                                | Spec, flow step 1; Session                                 |
| 6   | Joints and every decision on them are kept with the Case, like Notes. Each decision records the Operator and the time; each Joint records which layer proposed it: the base layer and its rule, or a named AI provider and model. Accepting or rejecting writes no Manifest Entry. Accepting a Joint also asks for the assumptions it rests on, the Operator's confidence in their own words, and the alternative explanations they considered; the view never fills these in, never scores confidence, and shows a blank one as "not recorded". | Session; Spec, "Decisions and surfaced material"; ADR-0004 |
| 7   | In a Shared Case each member's accept or reject is their own. When members disagree, the Joint is contested and shows each member's decision. A proposed Joint is seen only by the member whose run proposed it.                                                                                                                                                                                                                                                                                                                                 | Session; Shared Case members brief, decision 10            |

### Support, strength, and surfaced material

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Source                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 8   | Every Joint opens the exact stored span of each Exhibit it cites: the Exhibit, its Content Hash, and a locator (text passage, PDF page, mail message and header field, link target, image alt text, or byte range).                                                                                                                                                                                                                                                                                                                                    | Review, items 2 and 4; Retrieval, "Representations and locators" |
| 9   | A Joint based on a matching story, where the second telling paraphrases or breaks up the first, is supported by pairs of spans, one fact at a time, each pair noting how distinctive the shared fact is. "Harrow Point ferry" is rare; "age sixteen" is common.                                                                                                                                                                                                                                                                                        | Session                                                          |
| 10  | A claim check reports two separate things: whether the text is `present`, `absent`, or `cannot-check` in the named Exhibit, and a proposed reading of whether the passage `supports`, `conflicts`, or is `unclear`. The mock shows both. A paraphrased match can be `absent` and `supports` at once.                                                                                                                                                                                                                                                   | Spec, flow step 4; Review, item 10; Session                      |
| 11  | A Joint has no strength label or score. Its strength is shown as a summary of its reviewed support: Source Classes, the number of independent sources, distinctive matches, and conflicts, for example "2 contemporaneous sources, 1 rare match, 1 conflict".                                                                                                                                                                                                                                                                                          | Session; Spec, "Strength without a label"                        |
| 12  | A Joint is visibly weak when all its reviewed support is unclassified, commercial, or AI-origin, or when it rests on one source.                                                                                                                                                                                                                                                                                                                                                                                                                       | Session; Spec, flow step 5                                       |
| 13  | The Operator sets each Exhibit's Source Class; it starts as unclassified. The Operator also marks two Exhibits as one source when one copies the other, and can undo that mark; a shared passage alone never makes that mark. The AI layer may suggest either, as unreviewed material.                                                                                                                                                                                                                                                                 | Session                                                          |
| 14  | A Note, or an Exhibit whose Source Class is AI-origin, can supply a claim to check. Neither ever supports a Joint, so AI-origin material is never offered **Add as support**.                                                                                                                                                                                                                                                                                                                                                                          | Spec, flow step 2; Session                                       |
| 15  | Material Birdbrain surfaces for an existing Joint, supporting or conflicting, arrives unreviewed. It counts only once the Operator adds it, and it never changes whether the Joint is accepted. An accepted Joint with unreviewed material is flagged until the Operator adds or dismisses it. The base layer never reads a span as conflicting, so the first slice has only that flag; with the AI layer on, material it reads as conflicting carries a stronger mark. A dismissal is remembered. Every add or dismiss is recorded and can be undone. | Session                                                          |

### Sources, exclusion, and the AI layer

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 16  | The source inspector shows the stored Exhibit at the exact span with its Content Hash. It never substitutes a search snippet, a preview, or a live page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Spec, "Visual design"; Retrieval, "Constraints"                      |
| 17  | A cited span whose Exhibit no longer matches its Content Hash, or whose stored file is missing, is unavailable. The view never shows it as plausible support.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Retrieval, "Constraints"                                             |
| 18  | The Operator can mark any Exhibit **Withheld from analysis**, and clear their own flag at any time; the next run reflects it. A withheld Exhibit, or a Staging Pool file, never appears as support or as surfaced material. In a Shared Case each member's flag is their own: the Exhibit is withheld for every member while any member's flag is set, and the view names who holds one.                                                                                                                                                                                                                                                         | Session; Spec, "Withheld from analysis" and "Shared Cases"; ADR-0024 |
| 19  | The view states how many Exhibits a run read and how many were withheld.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Spec, "Visual design"; Review, "Checked and correct"                 |
| 20  | The base layer uses no model, and the view is complete with AI off. It proposes Joints from shared identifiers and exact text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ADR-0039                                                             |
| 21  | AI analysis is a separate layer, off by default. The Operator enables it in Settings for the installation, then per Case and per provider. A hosted provider's disclosure names the provider, the model and its version, the region that processes the text, the kinds of text it receives (shortlisted passages from eligible Exhibits, the inquiry, and Note passages the Operator selected, never withheld material), and the Egress the request uses. A failed local model never hands work to a hosted one.                                                                                                                                 | ADR-0039; ADR-0032                                                   |
| 22  | With AI off, the view says which kinds of Joint it cannot find, such as a paraphrased retelling or a relation stated only in prose, so "no Joints found" never reads as "no connection".                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ADR-0039                                                             |
| 23  | The default source is the stored Case only, and the first slice offers no other. When external lookup arrives later, it shows its destination, its query or URL, and the Egress it uses before anything is sent. While the Egress is Direct and no VPN is seen, the first contact with a site in the Case is preceded by the privacy warning ADR-0032 requires, offering to continue, to set up a proxy, or to stop warning on this network. A page found that way is a candidate with its own observation time; it supports nothing until the Operator captures it as a new Exhibit, and it is not compared with the stored Exhibit until then. | Spec, "Visual design" and flow step 6; ADR-0032                      |
| 24  | The inquiry, the starting Subjects, the withheld Exhibits, the Case state, and a snapshot of the relevant Notes travel with each run, so a later edit cannot quietly change what the run was based on. If the Case changes while a run reads it, the run stops and reports nothing; a canceled run also reports nothing.                                                                                                                                                                                                                                                                                                                         | Spec, flow step 1                                                    |

### Layout and access

| #   | Decision                                                                                                                                                                                                                                                                                                                              | Source                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 25  | The Joint map is a new investigation view. It does not silently reuse the Link Map or its 20-node ceiling.                                                                                                                                                                                                                            | Spec, "Visual design"                                                    |
| 26  | WCAG 2.2 AA is the product target. The Joint list is the keyboard and screen-reader equivalent of the map: everything the map shows, including Subjects with no Joint, and every action it offers, including selecting two Subjects to see the path between them, is reachable from the list. You may propose a different equivalent. | Review, item 16; [standards](../agents/osint-investigation-standards.md) |
| 27  | The window minimum is 900 by 600 and the default is 1200 by 800 (`src/main/windowSize.ts`).                                                                                                                                                                                                                                           | Review, item 14                                                          |
| 28  | On a narrow window the panes become tabs and keep the selected Joint and Exhibit. The test: the Operator can reject one tempting but unsupported Joint without losing their place in the Joint list.                                                                                                                                  | Spec, "Visual design"                                                    |

## Surfaces to draw

Draw each surface in the existing design language of the Birdbrain UI project. Use the theme's
semantic tokens, not raw color values. The surfaces are numbered so the engineering response can
give a verdict per item.

Each surface and state carries one of three labels. Draw them in this order:

- **First slice.** Local, with no model: an inquiry goes in, the Joint map and gap list come out,
  and each Joint opens its stored spans (Spec, "Investigation flow", closing paragraph; Review, item
  4; ADR-0039).
- **AI layer.** What appears only when the Operator has enabled AI analysis for the installation and
  the Case.
- **Later.** External lookup, after its consent behavior is reviewed.

Where one surface mixes labels, the parts are labelled inline.

### 1. Starting a run (first slice, with AI layer and later parts)

Three entry points open the same run setup:

- The view itself, with a free-text inquiry.
- A Joint's **Find more material** action (surface 4), which looks for support and conflicts for
  that Joint.
- A claim in a Note, with a **Find material for this claim** action. The run proposes a Joint for
  the claim, with the material it finds as unreviewed support and conflicts.

The setup shows:

- **Inquiry or claim.** The text the run works from.
- **Starting Subjects.** The Subjects the run starts from, editable, with a way to add a Subject by
  hand. If the Case holds two Subjects named Rowan Pike, the Operator sees both, separately
  (decision 5).
- **Withheld from analysis.** The count and the list of withheld Exhibits, with a way to change the
  list (decision 18).
- **Sources.** "Stored Case only", as a fixed line (decision 23). _Later:_ a toggle that allows
  external lookups, each asking first, off by default.
- **AI analysis.** _First slice:_ "AI analysis is off", with the line from decision 22. _AI layer:_
  the providers enabled for this Case, each named, with a hosted provider marked as sending text off
  this machine.
- **What the run records.** A short line saying the run keeps the inquiry, the starting Subjects,
  the withheld list, and the Case state as of now (decision 24).
- _AI layer:_ **Text a hosted provider will receive.** Before the first request, the inquiry and the
  Note passages that will be sent, so the Operator sees exactly what leaves the machine (decision
  21).
- **Run** action.

### 2. View header (first slice, with an AI layer part)

Visible on every arrangement: the Case name, the inquiry, the counts of Exhibits read and withheld
(decision 19), the sources setting, and the run's basis with its time zone and year ("Case as of
14:02 UTC, 3 October 2026"). _AI layer:_ the providers and models the run used. When the run used a
screening stage, its counts too, for example "3,140 passage pairs screened, 46 compared in full", so
the Operator sees how much was not examined closely.

### 3. The Joint map and the Joint list (first slice)

The primary surface. The map and the list show the same Subjects and Joints; selecting a Joint in
either selects it in both and opens its detail (surface 4). The list includes Subjects that have no
Joint yet, such as the second Rowan Pike, and lets the Operator select two Subjects to see the path
between them (decision 26).

On the map, Subjects are nodes and show their kind. A Joint between two Subjects joins them; a Joint
about one Subject belongs to that Subject (question 8). Each Joint shows:

- The claim, in short.
- Its status by line style and text: proposed, accepted, rejected, or contested (decision 1).
- Its strength summary, and a visible weak mark when decision 12 applies.
- A mark when it has unreviewed material (decision 15). _AI layer:_ a stronger mark when the AI
  layer reads that material as conflicting with an accepted Joint.
- _AI layer:_ a mark when an AI provider proposed it, naming the provider and model (question 11).

Selecting two Subjects that have no direct Joint shows the path between them, if one exists: "M.
Calloway reaches The Ferryman through Jun Sato", with each Joint on the path and its strength
summary (decision 4).

### 4. Joint detail (first slice, with an AI layer part)

One Joint, opened. Contents:

- **The claim** and the Subject or Subjects it is about.
- **Supporting Exhibits**, in this Source Class order: original, contemporaneous report, later copy
  or retelling, commercial or aggregator report, unclassified, then AI-origin (listed only when an
  Exhibit was reclassified after its span was added, and not counted). Each row: Exhibit Number,
  Source Class, the span's locator, the dates it carries, its claim check on both axes (decision
  10), who added it, and a mark when the Operator has recorded it as a copy of another source
  (decision 13).
- **Conflicting Exhibits**, with the same row shape.
- _AI layer:_ **Matched facts.** For a Joint based on a matching story, the fact pairs: each fact,
  its span in each Exhibit, and how distinctive it is (decision 9). The Operator can reject one pair
  without rejecting the Joint.
- **Unreviewed material**, kept apart from the reviewed lists: each item with **Add as support**,
  **Add as conflict**, and **Dismiss**, with an optional reason (decision 15). An AI-origin item has
  no **Add as support** (decision 14).
- **Undo.** Each reviewed row has an action that returns it to unreviewed, and dismissed items sit
  in a collapsed list with a **Restore** action. Each reversal is recorded in the history (decision
  15).
- **Strength summary** (decision 11).
- **Dates.** Label which date each one is: the capture time, a date the source states, or a trusted
  timestamp ("stamped at"). Show a missing date as missing.
- **History.** Who proposed the Joint (the base layer and its rule, or a named provider and model),
  and each decision with its Operator and time. In a Shared Case, each member's decision (decision
  7).
- **Acceptance context.** The assumptions, confidence, and alternatives recorded when the Joint was
  accepted, with "not recorded" for any left blank (decision 6).
- **Actions:** **Accept**, which opens the acceptance context fields, **Reject**, **Find more
  material**.

### 5. Source inspector (first slice, with AI layer and later parts)

The stored Exhibit at the exact span (decision 16). Contents:

- Exhibit Number, kind, and Content Hash (short form, expandable).
- The stored representation at the locator, with the span marked: a text passage, a PDF page, a mail
  message with the header field, a link target or alt text shown as its exact stored value, or a
  byte range. A headers-only Exhibit says "Body not acquired".
- **Source Class**, which the Operator sets here (decision 13). _AI layer:_ a suggested class,
  marked as a suggestion until the Operator takes it.
- **Withheld from analysis**, which the Operator can set here (decision 18). In a Shared Case, the
  members whose flags keep it withheld.
- **Copy of another source.** An action to mark this Exhibit as a copy of another Exhibit, chosen
  from the Case, and the existing mark with a way to remove it (decision 13). _AI layer:_ a
  suggested copy pair, marked as a suggestion until the Operator takes it.
- **Source trail**, kept visibly apart from the stored Exhibit: the stored URL or document origin
  and any pinned Wayback Snapshot the Case already holds, each with the time it was observed.
  _Later:_ candidates found by external lookup, each with its observation time and a label marking
  it as a candidate, and a **Capture** action that hands its URL to the existing background capture
  so it becomes a new Exhibit (decision 23). A candidate is not compared with the stored Exhibit
  until it is captured; then the two Content Hashes show side by side.
- _Later:_ **Find the original** action, which opens the lookup consent prompt (state 9).

### 6. Gap list (first slice, with a later part)

What the Case cannot support yet. Group the entries by kind:

- Claims with no supporting Exhibit, including claims from Notes and AI-origin Exhibits.
- Accepted Joints with unreviewed material.
- Contested Joints, in a Shared Case.
- Weak Joints (decision 12).
- Subjects reached only through another Subject (decision 4).
- Missing dates.
- Missing originals: a stored copy whose original source the Case does not hold.
- Searches not yet run, including external lookups the Operator has not allowed.

Each entry opens what it belongs to: a Joint or claim opens in Joint detail, and an entry about one
Exhibit, such as a missing date or a missing original, opens that Exhibit in the source inspector at
the relevant field. In the first slice an entry for a search not yet run is listed without an
action. _Later:_ that entry opens the lookup consent prompt.

### 7. Narrow-window arrangement (first slice)

Between the 900-pixel minimum and the 1200-pixel default, the map, the Joint detail, and the source
inspector cannot all sit side by side. Draw the tabbed arrangement and show that the selected Joint
and Exhibit carry across tabs (decision 28). The width at which panes become tabs is your call
(question 4).

### 8. AI analysis settings (AI layer)

Two levels (decision 21):

- **In Settings, for the installation.** One control that enables AI analysis at all. While it is
  off, no AI control appears anywhere in the app. Below it, the configured providers, each with what
  it is (a local model, or a hosted service with its name) and where its text goes.
- **In the Case, per provider.** For each configured provider, an on or off control for this Case,
  off by default. Turning on a hosted provider shows its disclosure first: the provider's name, the
  model and its version, the region that processes the text, the kinds of text it receives (decision
  21), and the Egress the requests use. Actions: **Turn on for this Case**, **Cancel**.

### 9. The Operator's own identifiers (first slice)

A list of the accounts and addresses that belong to the Operator or their Personas, which the
Operator can add to and remove from. Birdbrain never follows them. The source inspector offers
**Mark as my own** on an identifier in a stored span, so a Persona's account seen in a captured
page's header can be added from where the Operator finds it. Where the list lives is your call
(question 12).

## States to draw

States 1 to 8, 10, 11, 12, and 15 are first slice. State 9 is later; states 13, 14, and 16 are AI
layer.

1. **Empty Case.** No Exhibits to read. The view says so and does not offer a run.
2. **Run in progress.** Progress at the Case level, with the counts so far. The Operator can cancel.
   A canceled run reports nothing: its partial results are discarded, and the view returns to the
   previous run's results, if any, with a line saying the run was canceled (decision 24).
3. **No Joints found.** The run finished with nothing to propose. The gap list may still have
   entries. With AI off, the line from decision 22 appears here.
4. **`cannot-check`.** A claim check that could not run, with the reason (for example, the text sits
   in an image the run cannot read). It is distinct from `absent`.
5. **Content Hash mismatch or missing file.** An Exhibit whose stored bytes no longer match displays
   as "Changed since capture" (the `CONTEXT.md` display name for this Integrity Status); one whose
   stored file is missing shows the `missing` Integrity Status. In both cases its spans are
   unavailable, nothing falls back to a preview, and any Joint that relied on it shows the lost
   support (decision 17).
6. **Withheld Exhibit.** How a withheld Exhibit appears where the Operator might expect it: in the
   withheld list and in the source inspector, never as support or surfaced material (decision 18).
7. **Rejected Joint.** Still visible, marked rejected by line style and text, and recoverable.
8. **Same-name Subjects.** Two Subjects named Rowan Pike on the map as separate nodes, with the gap
   entry that says no Exhibit joins them yet (decision 5).
9. **Lookup consent prompt** (later). Before an external lookup: the destination (for example
   `web.archive.org`), the exact query or URL, the Egress it will use, and a plain statement that
   the destination sees the request. Actions: **Send**, **Cancel**. When the Egress is Direct and no
   VPN is seen, the first contact with a site in the Case shows the privacy warning first, with
   **Continue**, **Set up a proxy**, and **Stop warning on this network** (decision 23). **GAP G7:**
   the spec has not decided which destinations may be approved once per run and which need a prompt
   every time. Draw the per-request prompt.
10. **Run basis out of date.** The Case changed after the run (a new Exhibit, a changed Note). The
    view says the run reflects the Case as of its start and offers a new run (decision 24). Accepted
    and rejected Joints stay as they are (decision 6).
11. **Unreviewed material on an accepted Joint.** "Calloway is Sato" is accepted, and a new run
    surfaces a profile placing Calloway in Lisbon on the day Sato gave an interview in Toronto. The
    Joint stays accepted, carries the unreviewed-material mark, and appears in the gap list
    (decision 15). Only the Operator can read the profile as a conflict. _AI layer:_ when the AI
    layer reads it as conflicting, the stronger conflict mark.
12. **Contested Joint.** In a Shared Case, accepted by NK and rejected by MB (decision 7).
13. **AI layer on.** The same Case with a local model enabled: a narrative-match Joint with its fact
    pairs, and the header's screening counts.
14. **Hosted provider disclosure.** The prompt from surface 8 for a hosted provider.
15. **Run invalidated.** The Case changed while the run was reading it. The run stops, reports
    nothing, and offers a restart (decision 24).
16. **AI analysis failed or partial.** An enabled provider failed partway. The view names the
    provider and model, says which stages finished (for example "screening finished, comparison
    stopped after 12 of 46"), keeps the base layer's results, and offers a retry. It never reads as
    a finished run that found no AI-proposed Joints, and a failed local model never hands its work
    to a hosted one (decision 21).

## Open gaps

| Gap | Status                                                                                                          | Where it was decided or will be |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| G1  | Closed. Nodes are Subjects of any kind (decision 3; Terms).                                                     | Session                         |
| G2  | Closed. There is no merge or split; Joints and decisions are kept with the Case (decisions 3, 6).               | Session                         |
| G3  | Narrowed. Joints persist. Whether a past run's record can be reopened is still open; do not draw a run history. | Engine spec; Review, item 7     |
| G4  | Closed. Withheld from analysis, set by the Operator at any time (decision 18).                                  | Session                         |
| G5  | Closed. Source Class (decision 13).                                                                             | Session                         |
| G6  | Closed. The first slice uses no model; the AI layer names its providers (decisions 20, 21).                     | ADR-0039                        |
| G7  | Open. Which lookup destinations may be approved once per run and which need a prompt every time.                | Engine spec, open decision 3    |

## Copy constraints

The repo's claim-discipline rules apply to every string in the mock (`docs/agents/writing-guide.md`,
"Claim discipline"):

- Never write _verified_, _confirmed_, _proven_, or _same person_ for a Joint or a check. `present`
  says the text is in the stored Exhibit; `supports` is a proposed reading. Neither says the claim
  is true.
- Label every interpretation Birdbrain offers as proposed, including that two pseudonyms belong to
  one writer.
- Do not write _strong_, _moderate_, or any other strength word. Show the strength summary.
- Do not write _AI-powered_. Name the provider and say where its text goes.
- Write **Withheld from analysis**, never _excluded_, for that flag. "Excluded" already means two
  other things in Birdbrain: the URL exclusion policy and a Shared Case exclusion from export.
- Use the project's terms: Case, Subject, Joint, Source Class, Exhibit, Exhibit Number, Content
  Hash, Note, Operator, Staging Pool, Egress, Wayback Snapshot. In a Shared Case an Exhibit Number
  carries its Member Code (`NK-12`).
- A Subject of kind "account" is an account belonging to someone under investigation. Do not call it
  a Persona; a Persona is the Operator's own browser identity.
- Avoid _entity_, _node_ (in the interface), _hit_, _evidence_ (for a Note), _link_ (for a Joint or
  a Mention), and _workspace_.
- Use invented names, sites, and documents in every example, as this brief does. The worked
  investigation behind the spec is a live Case.

## Questions for the designer

The designer's calls, not settled by the spec, the review, or the session:

1. What a Subject and a Joint look like, and how the map stays readable for a Case of about 1,000
   Exhibits. The Link Map caps itself at 20 nodes and discloses "showing N of M"; this view does not
   inherit that cap (decision 25), but any truncation it does apply must be disclosed.
2. How the Joint map and the Link Map on the Case Overview avoid colliding visually. They are
   separate views (decision 25), but the Link Map already uses dashed edges for authored references,
   so the Joint status line styles must not read as that convention, and the Operator must be able
   to tell at a glance which map they are looking at.
3. Where the view lives in the app and how the Operator reaches it. The Case sidebar today has five
   sections: Overview, Captures, Notes, Signals, and Data.
4. At what width, between 900 and 1200 pixels, three panes become tabs.
5. How the two claim-check axes read at a glance, so `absent` and `conflicts` are never mistaken for
   each other, and `absent` with `supports` reads as a paraphrase rather than an error.
6. How the strength summary and the weak mark read at a glance, without becoming a grade.
7. How two Subjects with the same name are told apart on the map and in the list.
8. How a Joint about one Subject appears on the map, beside Joints between two.
9. How a path through other Subjects is shown, so it never looks like a Joint of its own.
10. How a contested Joint reads, and how much of each member's decision shows on the map.
11. How a Joint proposed by an AI provider is told apart from a base-layer Joint, without color
    alone, and without implying either is more reliable.
12. Where the list of the Operator's own identifiers lives (surface 9): in the Case, in Settings
    beside the Personas, or both.

## Not in scope

Do not draw these:

- A generated argument, draft, or editable cited argument, or a pane for one. Birdbrain does not
  write the argument (Review, item 1).
- Merging or splitting Subjects (decision 3).
- A strength label, grade, or score (decision 11).
- Promoting anything from this view into a Brief or an Evidence Package.
- Choosing, installing, or configuring a model beyond turning a configured provider on or off, and
  the read-only MCP server route the spec mentions.
- The Case search changes and the unannotated-Capture review view from the retrieval spec. They are
  a prerequisite of this view and are drawn separately.
- Any change to the Link Map on the Case Overview.

## Deliverable

A mock in the "Birdbrain UI" design project covering the nine surfaces and sixteen states above,
first-slice parts first, then the AI layer, then later parts. Deliver it the way the Shared Case
members mock came back: a dated bundle under `docs/design-handoff/` with an `ENGINEERING_REVIEW.md`,
following
[that bundle's review file](../design-handoff/2026-09-19-shared-case-members/ENGINEERING_REVIEW.md).
Engineering answers with a verdict, a size, and the constraint behind each numbered surface and
state, as the Shared Case members feasibility assessment did.
