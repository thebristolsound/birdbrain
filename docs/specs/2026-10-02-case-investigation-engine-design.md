# Case investigation engine

**Status:** Draft
**Date:** 2026-10-02
**Audience:** Maintainer and implementers. Every behavior below is proposed unless cited as existing.

## Product promise

An Operator can give Birdbrain a large Case and ask, "Map out this person's identity." Birdbrain should find possible links between names, accounts, publications, domains, and dates; check claims against stored Exhibits; look for an original source when one can be found; and assemble an editable argument whose factual sentences point to the stored material. It should also show broken links, conflicting material, and claims the Case cannot support.

This is the Case's investigation workspace, with retrieval as one component. The [earlier retrieval draft](../archive/2026-10-02-case-retrieval-pipeline-design.md) scoped the product to finding candidate Exhibits and explicitly excluded generated arguments. This design replaces that product recommendation while retaining its exact-span retrieval, exclusion, and local-index constraints. The earlier draft is archived so its reading of the 2026-09-05 workflow brief remains visible. That brief lives outside the repository at `~/handoffs/2026-09-05-case-consolidation-workflow-brief.md`; landing it is a separate handoff.

The worked investigation in that brief is a live Case. Use invented people, sites, and documents for design examples and tests. Its ten-step process supplies the requirements: check Notes against their Captures, find unannotated Exhibits, build identity links as joints, find stronger original sources, and write a cited package.

## What a run produces

| Output            | What it says                                                                                                                                                       | What the Operator can check                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim check       | Whether a phrase or field is present, absent, or cannot be checked in the named Exhibit; a separate proposed reading says whether that passage bears on the claim. | Open the Exhibit at the exact text, page, message, header, link attribute, or byte range and compare its Content Hash. A matching phrase does not prove the claim is true. |
| Identity joint    | A proposed link between two named identities or accounts, with supporting and conflicting Exhibits, provenance class, dates, and a reason for its strength.        | Inspect each side of the link and reject a same-name or inferred association. A joint with only one weak source remains visibly weak.                                      |
| Source trail      | The stored Exhibit, its cited URL or document origin, any pinned Wayback Snapshot, and separately discovered live or archived candidates.                          | See when each version was observed and whether its content matches the stored Exhibit. Availability today does not prove what the source served at capture time.           |
| Editable argument | A draft organized by joints, with factual sentences bound to Exhibit spans and a source index.                                                                     | Edit or remove every sentence. An unsupported sentence stays marked `needs source` and cannot silently appear as a checked finding.                                        |
| Gap list          | Claims with no supporting Exhibit, conflicting accounts, missing originals, and promising searches not yet run.                                                    | Decide what to acquire next and which exclusions still apply.                                                                                                              |

Birdbrain may propose a substantive interpretation, including that two identities belong to one person. It must label that interpretation as proposed. A mechanical check can establish that the stored bytes and a cited passage match their recorded hashes; it cannot establish the truth of the passage or the identity inference. [CONTEXT.md](../../CONTEXT.md), [ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md), and the [anchored-notes design](2026-07-24-anchored-notes-report-authoring-design.md) set those boundaries.

## Investigation flow

1. **Scope the question.** The Operator selects a Case, names the subject or starting accounts, and reviews the search exclusions. If two people share a name, the run keeps them separate until an Exhibit supports a link. The question, exclusions, Manifest head, and a snapshot of the relevant Notes travel with the run so a later edit cannot quietly change its basis.
2. **Inventory and decompose.** Read eligible Exhibits, Notes, Selectors, and existing references. Turn the question and claim-bearing Notes into candidate assertions without treating the Notes as evidence. For "map identity," candidate assertions include "account A belongs to name B" and "publication C used address D."
3. **Find candidate passages.** Search Extracted Text and fielded representations of links, alt text, mail headers, document metadata, PDF pages, and message boundaries. Use exact and proximity search for identifiers; evaluate local semantic retrieval for differently worded passages. Every candidate resolves to an Exhibit, Content Hash, and reproducible locator. A short mail header may need an unannotated-Exhibit discovery view rather than a similarity score. The archived retrieval draft details index and locator options.
4. **Check the stored material.** Reopen the Exhibit, compare its Content Hash, resolve the cited span, and run the claim's literal checks over Extracted Text and the relevant decoded or raw fields. Report `present`, `absent`, or `cannot-check` separately from the proposed interpretation `supports`, `conflicts`, or `unclear`. A missing phrase in Extracted Text alone does not settle a link hidden in an image `href`.
5. **Assemble and challenge joints.** Group proposed identity links into a path a reader can follow. Each joint lists its strongest original or contemporaneous source first, then other sources and contradictions. Show the weakest joint in the path, missing dates, and any link supported only by a Note, commercial report, or AI-origin document. The Operator can merge, split, reject, or reorder joints.
6. **Look for the original source.** First search the Case and pinned Wayback Refs without network contact. If the Operator asks for more, search approved archives and public sources by quoted passage, title, URL, and date. Show each proposed external lookup, destination, query or URL, and Egress before sending it. Rank an original publication ahead of a later copy only when its authorship and dates support that order. A live page, archive result, or search hit is a candidate with its own observation time. The Operator must capture a selected page as a new Exhibit before the written argument cites its content as Case evidence. A changed or unavailable page remains a gap, never a retroactive update to an old Capture. [ADR-0002](../adr/0002-tls-capture-corroboration-only.md), [ADR-0032](../adr/0032-route-app-egress-but-do-not-disguise-the-browser.md).
7. **Compose and review.** Produce an editable argument organized around the accepted or still-proposed joints. Each factual sentence carries typed links to one or more checked Exhibit spans; quoted words must match the stored representation. The draft distinguishes observations, source assertions, and the Operator's inference. The Operator reviews source coverage, contradictions, and the denominator of eligible versus cited Exhibits before promoting any text into a Brief or Evidence Package.

The first complete slice includes steps 1–5 and 7 on a synthetic Case, with a local-only source trail for step 6. This delivers the prompt-to-argument experience early. External lookup follows after its consent and provenance behavior is reviewed.

## Visual design

The Case workspace should open on the question and keep the argument, the joint map, and the source visible together. This screen sketch describes information and interaction, not a new visual language:

```text
┌ Case: Synthetic identity investigation ── eligible 84 / excluded 6 ── Local analysis ┐
│ Ask the Case  [ Map the links between Name A and Account B             ] [ Analyze ]  │
│ Sources: Stored Case only  ·  External lookup: Ask before each destination            │
├ Joints and gaps ──────────────┬ Editable cited argument ───────────┬ Source inspector ┤
│ ● Name A → Account B          │ Name A used Account B in 1992.    │ Exhibit 14        │
│   2 supporting · 1 conflict  │ [Exhibit 14: header] [Exhibit 27] │ Content Hash …    │
│   Proposed · strong? Review  │                                    │ Stored bytes/text │
│                              │ A later profile names both.       │ Matched span      │
│ ○ Account B → Site C          │ [Exhibit 31: paragraph 4]         │ From: …           │
│   1 hostile source · gap      │                                    │                  │
│                              │ Name A owned Site C.              │ Original source  │
│ ! Same-name conflict         │ [Needs source] [Find candidates]  │ Stored URL        │
│                              │                                    │ Archive: candidate│
│ [Joint map] [Gap list]        │ [Review citations] [Save draft]   │ Live: not checked │
└──────────────────────────────┴────────────────────────────────────┴──────────────────┘
```

Selecting a joint filters the argument and highlights both supporting and conflicting Exhibits. Selecting a citation opens its exact stored span in the inspector; the inspector never substitutes a search snippet or live page for the stored Exhibit. A source lookup action shows the destination and disclosure before the request. The map's line style and text both distinguish proposed links from Operator-accepted ones, so color alone does not carry the status. The joint map is a new investigation view: the existing [Link Map research](2026-08-12-maltego-graph-node-research.md) describes a bounded projection of Note references with a 20-node display ceiling. This design does not silently reuse that graph or its limits.

On a narrow window, the same three surfaces become tabs. They preserve the selected joint and Exhibit. The main review test is whether an Operator can reject one tempting but unsupported identity link without losing their place in the argument.

## Retrieval, analysis, and custody

**Recommend a local analysis model for the built-in experience.** Pair it with exact and fielded retrieval. The model proposes claims, joints, search terms, and draft wording. Each proposed sentence carries typed citations or a `needs source` marker. A validation layer resolves every cited Exhibit identifier, Content Hash, and locator against stored bytes before displaying the draft as sourced. It rejects invented citations and preserves sentences without citations as visible gaps. Editing a sentence makes its support check stale until the Operator rechecks it. The validator cannot prove that a passage entails an identity claim; that remains an Operator review task. Model and runtime selection needs a separate assessment of maintenance, platform support, offline behavior, and known-answer performance before implementation. This draft names no unverified model or library.

The existing [read-only MCP server](../adr/0038-a-read-only-mcp-server-reads-a-case-from-a-separate-process.md) offers an early way to test this workflow with an external agent. Its tools read a Case without writing the Manifest. If the MCP client uses a hosted model, the Case material returned to that client reaches its provider; the UI and docs must not describe that path as local analysis. The built-in path should keep Case text and model input on the Operator's machine by default. Remote model use would require a separate product decision, disclosure, and compliance with Egress; failure of a local model never silently switches to a remote one.

Search caches remain disposable and outside the Manifest, as the archived retrieval draft recommends. A model run records the input Case state, excluded classes, model identity and version, search/extraction versions, candidate locators, and validation outcomes in local working state. That record explains the draft; it is not a new Exhibit or evidence attestation. Staging Pool files stay in their own search view and cannot support a Case-wide argument until committed. AI-origin Exhibits need an explicit classification and exclusion rule before they can enter candidate rankings. [ADR-0023](../adr/0023-exhibits-are-the-unit-of-evidence.md), [ADR-0024](../adr/0024-a-staging-pool-outside-the-chain.md).

The [anchored-notes design](2026-07-24-anchored-notes-report-authoring-design.md) treats the Brief's narrative as Operator-authored and its evidence references as typed. This proposal adds a distinct model-proposed draft that the Operator may edit and accept. Promotion must retain its model origin and the Operator's acceptance; labelling accepted model text simply `operator-authored` would hide its history. The existing Brief provenance model needs an explicit extension before model text enters an Evidence Package. [#548](https://github.com/thebristolsound/birdbrain/issues/548) must settle actor attribution before an agent can commit an Exhibit, write a Manifest Entry, or export. A read-only run and an unsaved draft do none of those.

## Options and recommendation

| Approach                                            | What it gives the Operator                                                                 | Main limitation                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Exact search and manual Brief                       | Reliable identifier lookup and direct review of stored material.                           | The Operator must know what to search for and assemble every joint and paragraph.                                                    |
| Model-assisted Case investigation, local by default | Candidate joints, claim checks, gap hunting, and an editable cited argument over the Case. | Adds model packaging, evaluation, review time, and a risk of persuasive but wrong interpretation.                                    |
| Hosted model over the MCP reads                     | A near-term research workflow using the existing read-only tools.                          | Case text sent through the client may reach its model provider, and the result is outside Birdbrain's authoring and export controls. |

Choose the second approach as the product target. Use the third as an explicitly disclosed evaluation path where the Operator elects it. Keep exact retrieval and mechanical byte checks under either path. Do not call a model's proposed support verdict a verification result.

## Evaluation and first slice

Build a synthetic Case with an unannotated account-bearing 1992-style header, a fact present only in an image link target, a Note unsupported by its target Capture, a same-name decoy, conflicting publication dates, a false citation in an AI-origin document, a dead original URL with an archived copy, a staged file, and an excluded Exhibit. No names or bytes from the live investigation enter the repository.

The first end-to-end test asks the exact kind of open question the Operator intends to use: "Map the links between Name A and Account B." A useful result contains the relevant joints and an editable cited argument, identifies the unsupported and conflicting links, and leaves the original-source request pending until approved. Evaluate joint recall, false identity merges, source ranking, time to review, and whether each cited span resolves at the stated Content Hash. Any invented citation, excluded-content leak, or unapproved network request fails the safety gate. Record unsupported factual sentences before and after validation; the export path must admit none as checked findings.

The first implementation slice should cover one Case, existing committed Exhibits, read-only analysis, exact span checks, a joint review surface, and a disposable editable draft. It should include the complete prompt-to-draft path, not stop at a search-results list. The analysis writes no Manifest Entry. This design PR adds no code, dependency, schema change, or model selection; the model assessment, attribution decision, and known-answer tests precede implementation.

## Open decisions

1. Which model and runtime meet the offline, platform, maintenance, and evaluation bar for the built-in experience?
2. What marks an Exhibit as excluded or AI-origin, and how does a later exclusion remove it from existing search caches and drafts?
3. When external lookup is enabled, which destinations may be searched after one approval, and which need confirmation each time? The 2026-09-05 workflow brief asks for per-call confirmation when a request could reach the subject's infrastructure.
4. What provenance fields and acceptance action let model-proposed text enter a Brief without presenting it as solely Operator-authored?
5. Which strength labels should the Operator use for joints, and what minimum source mix allows a proposed identity link to appear in a package?

The decisions require a new ADR for model-assisted analysis and draft provenance, an amendment or superseding record for the Brief provenance design if its block model changes, and the exclusion policy left open by ADR-0023. ADR-0038 remains read-only. Any agent-triggered chain write waits for the actor ruling in #548; any remote Case-text processing must account for ADR-0032 and disclosure.
