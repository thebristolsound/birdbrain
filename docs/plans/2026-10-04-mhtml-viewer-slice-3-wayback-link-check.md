# MHTML viewer interactivity, slice 3: check a link's destination in the Wayback Machine

PR #1990 implements the single-link lookup (S1, S2, S3 one link, S5, S6), and PR #1998,
stacked on it, implements the batch (S3 many links, S4). Slice 1 is
[the slice 1 plan](2026-10-02-mhtml-viewer-interactivity.md), merged as PR #1709; its D5 left
"Look up in Wayback" out of the link menu as slice 3. Slice 2 is
[the slice 2 plan](2026-10-04-mhtml-viewer-slice-2-click-through-and-provenance.md).

## Goal

Let the Operator ask archive.org what it holds for a link in a stored page, and see the answer
beside the link: whether the destination was archived, and the snapshot closest to the moment the
stored page was captured. A dead or changed destination is a common finding, and today the
Operator has to copy each address into a browser to check it.

The answer is corroboration in the sense `CONTEXT.md` gives it: gathered after the Capture, about
a different URL, and binding nothing about the captured transaction. It is not stored, anchored
or exported.

Out of scope: pinning a link's snapshot (S5), comparing a link's snapshot with the stored page,
searching archives other than archive.org, and any lookup the Operator did not ask for.

## Decisions

### S1. Which lookup, and against which time?

The existing CDX lookup, `lookupSnapshots` in `src/main/services/waybackMachine.ts`, called with
the link's address and the **source Capture's** timestamp. The question it answers is what the
link pointed at around the time the page that holds the link was captured, so `sort=closest`
ranks against that moment. Reusing the function keeps one archive.org client. Both the Capture
lookup and the link lookup pass it the Egress-following `egressFetch` (ADR-0032), so both follow
the Egress setting and fail closed with it.

The function asks the CDX API for `statuscode:200` rows only and collapses them by digest
(`buildCdxUrl`), and this slice does not change that, so the answer is narrower than "archived":

- An empty result means archive.org returned no successful snapshot. An archived redirect or
  error page is not reported, so a destination whose only records are a 301 and a 404 reads the
  same as one archive.org never saw. The cell says "No successful snapshot" (the Capture panel
  says "No snapshots found" on the same reasoning) and never says "Not archived" for it.
- archive.org collapses only adjacent rows with the same digest (the CDX server's README:
  "only adjacent digest are collapsed, duplicates elsewhere in the cdx are not affected"). Ranked
  by closeness, a page that changed once around the capture alternates A, B, A, B and nothing
  collapses, so the rows are not versions. The cell counts distinct digests among the rows
  returned and says "N different versions" (one: "1 version"), never snapshots.

An unfiltered mode that also returns redirects and errors would be the fuller answer for a dead
destination. It changes `waybackMachine.ts`, which S8 keeps unchanged, so it is left as a
follow-up for the maintainer to rule on.

The answer is phrased with `formatSnapshotDelta` from `src/shared/wayback.ts`, with the reference
point named ("3 days before this page was captured") rather than the function's own "before
capture" wording, because the link's destination was never captured.

A link check asks for a smaller result than the 200 rows of the Capture lookup: 20 is enough to
show the closest version and a count. When archive.org returns 20 rows, more may exist, so the
cell says "at least N different versions". `lookupSnapshots` drops a row it cannot read, so the
main process counts the rows on their way through (`src/main/services/waybackLinkCheck.ts`) and
also says "at least" when a row was dropped; a dropped row never turns the count exact.

### S2. What may be looked up?

Each lookup discloses the address to archive.org, so the main process decides, not only the menu.
Since this plan was drafted, the address rule became shared: `src/shared/localAddress.ts`
classifies the addresses that aim at the Operator's own machine or network, and both the Capture
link menu and the background capture's refusal of a link or redirect (#1726) read it. The lookup
reads the same classification, so the menu, the background capture and the lookup cannot
disagree.

- A new channel, `wayback:lookupLink`, takes `{ captureId, url }`. Main rejects a payload of the
  wrong shape and an unknown Capture id, then applies `captureLinkBlockReason`, and only then
  calls `lookupSnapshots` through the Egress (`egressFetch`, the same `fetchImpl` the Capture
  lookup passes). A refusal returns the function's reason with the code `WAYBACK_LINK_REFUSED`.
- `captureLinkBlockReason` moves from `src/renderer/components/captures/guestLink.ts` into
  `src/shared/localAddress.ts`, beside the classification it reads, so the menu and main call one
  function. Its tests move to `tests/shared/localAddress.test.ts`. It refuses a scheme other than
  `http:` or `https:` ("Not a web address"), and otherwise any address `localAddressKind`
  classifies ("Points at ...").
- `localAddressKind` refuses, from the address alone: the host `localhost` or a name under
  `.localhost`; a literal IPv4 or IPv6 address in a loopback, private, link-local or other
  non-public range; and, under ruling 3, a web host with no dot (`wiki`, `intranet`) or a name
  under `.local`, `.internal` or `.home.arpa`, as "a private network". Every trailing dot is
  stripped first, so `wiki..` is `wiki`. Because the background capture reads the same
  classification, every flow through the recapture queue refuses such a name ("Points at a
  private network" at enqueue, "Redirects to a private network" at a hop); ruling 3 lists them.
- A dotted name that resolves to a private address still passes, for the lookup, the menu and the
  background capture alike: checking it means resolving it, which is itself a disclosure to the
  resolver. That gap stays open and is named here rather than papered over.
- Main does not check that the URL appears in the Capture's link list. The list is derived data
  with ceilings, and a link past the row ceiling is still a link the Operator can see in the page.

### S3. Where does the Operator start a lookup?

- **One link.** "Look up in Wayback" in the link menu, for a web link, in both the Page tab and
  the Links tab. Turned off with the reason when S2 refuses the address. The item carries the
  existing disclosure hint, `WAYBACK_DISCLOSURE_HINT`, reworded for a link: "Looking up this link
  discloses it to archive.org."
- **Many links.** "Look up all in Wayback" in the Links tab toolbar, over the rows the current
  search and "External only" filter show. The addresses are de-duplicated first: the link list
  (`src/main/services/captureLinks.ts`) collapses a link into one row only when its text, frame
  and document URL also match, so one destination can sit in several rows, and one request
  serves them all. The confirmation lists every address that
  will be sent, after S2's refusals, the de-duplication and S4's cap, and lists the refused
  addresses with their reasons, so the Operator reads the exact list rather than a count. This
  follows step 6 of
  [the Case investigation engine design](../specs/2026-10-02-case-investigation-engine-design.md),
  which asks that each external lookup show its destination and its exact query or URL before it
  is sent. The dialog names the destination (archive.org) and says that the requests leave from
  the Operator's own address or the configured proxy, as the Egress setting says.

No lookup ever runs without one of these two actions, matching the existing rule that a Wayback
lookup is user-initiated.

### S4. How does a batch run?

- In main, one lookup at a time, with a fixed pause between requests. archive.org throttles the
  CDX API, and its published limit is not something this plan can cite, so the implementer
  measures a safe pause and records it beside the constant.
- An HTTP 429 or 503 stops the batch, keeps the answers already received, and reports how many
  were not checked.
- The Operator can cancel a running batch from the Links tab. A cancel stops before the next
  request.
- A batch is capped at a fixed number of addresses after de-duplication; above it, the
  confirmation lists the first N and says the rest are not checked. The cap is for the
  implementer to measure against the pause, so a full batch finishes in a few minutes.
- Progress arrives as events on one channel, keyed by Capture id and address, so the rows update
  as answers land; an answer updates every row that holds its address.

### S5. Can a link's snapshot be pinned?

No. A Wayback Ref is a snapshot pinned to a Capture, of that Capture's own URL (`CONTEXT.md`), and
`isPersistableSnapshot` checks that the snapshot's original URL is well formed, not that it is
the Capture's. Pinning a snapshot of a different URL to the source Capture would make every
surface that shows Wayback Refs (the panel, the export dialog, the report's corroboration block)
present it as corroboration of the source page. A link's snapshot gets these actions instead:

- **Open at archive.org** and **Copy snapshot URL**, as the snapshot menu has today.
- **Capture snapshot**, which queues a background Capture of the snapshot's replay URL into the
  source Capture's Case through the same `recapture:enqueue` path as Capture link. The result is a
  Capture of an archive.org page, with its own Manifest Entry. This is how a candidate becomes
  evidence, as the Case investigation engine design puts it: "It supports nothing until the
  Operator captures it as a new Exhibit." The replay page is captured with archive.org's
  toolbar, not in the `id_` form, because the toolbar states the snapshot's time and source in
  the stored page itself (ruling 1).

### S6. Where do answers show, and how long do they last?

- **Links tab.** Each web row gains a Wayback cell with one of five states: not checked, checking,
  no successful snapshot, a result such as "3 different versions, closest 3d before this page was
  captured" (the S1 wording, "at least" at the limit), or the error. The count is of distinct
  digests, because archive.org collapses only adjacent identical rows (S1). The cell is a control of its own beside the row's link
  button (the slice 2 plan, A5), so opening the snapshot actions in S5 never activates the row.
- **Page tab.** The menu's "Look up in Wayback" shows the answer as a toast with an "Open at
  archive.org" action. The hover bubble does not show Wayback answers.
- Answers live in the React Query cache, keyed by Capture id and address, with the same five
  minute `staleTime` as the Capture lookup, and are not written to the database. Closing the Links
  tab keeps them for that time; restarting the app drops them. Nothing is anchored, and no
  Manifest Entry is written.

### S7. Tests

- **Unit.** The `wayback:lookupLink` handler: an allowed address calls `lookupSnapshots` with the
  source Capture's timestamp and the smaller limit; a refused address never calls it; an unknown
  Capture id is rejected. The moved `captureLinkBlockReason` keeps every existing case, and gains
  the host-name cases if ruling 3 accepts them. The batch runner with a fake fetch: one request
  at a time, the pause, stop on 429 with the partial answers kept, cancel between requests, the
  cap, and one request for an address that several rows hold. The delta wording with the named
  reference point.
- **Component (jsdom).** `entityMenu` entries: the item for a web link, turned off with the reason
  for a refused address, absent for other schemes. `LinksTab`: each Wayback cell state, the
  confirmation's address list and its refusals, the progress update reaching every row that
  holds the address, activating the Wayback cell without activating the row, cancel. No test
  reaches archive.org.
- **E2E.** None that reaches archive.org. If the implementer adds one, the CDX base URL must be
  injectable so the spec points it at a local sentinel server.

### S8. Evidence impact

`src/main/services/waybackMachine.ts` is blocking tier in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` ("Corroboration lookups pinned as
evidence references"), so a PR that changes it is `evidence-affecting`. S1 is designed so that it
need not change: the handler calls `lookupSnapshots` with a `limit` option it already accepts, and
S1 and S6 word the answer as the 200-only, digest-collapsed result it is. If
the batch runner lives beside it rather than in a new `src/main/services/waybackLinkCheck.ts`, the
PR becomes evidence-affecting. The runner goes in the new file. `LinksTab.tsx` becomes blocking tier
when issue #1728 lands, and from then on this slice's PR is `evidence-affecting` whichever file
the runner is in.

S5's "Capture snapshot" writes a Capture through the existing recapture path with no new field.
If slice 2 Part B has landed, a snapshot Capture does not carry `linkedFromCaptureId`: the
snapshot's address is not the address the page linked to.

### S9. Files expected to change

`src/shared/ipc.ts`, `src/main/ipcHandlers.ts`, a new `src/main/services/waybackLinkCheck.ts`,
`src/preload/index.ts`, `src/shared/birdbrainApi.ts`, `src/renderer/lib/api/wayback.ts` (and
`keys.ts`), `src/shared/localAddress.ts`, which takes `captureLinkBlockReason` (S2),
`src/renderer/components/captures/guestLink.ts`, `useLinkMenuTarget.ts`, `LinksTab.tsx`,
`linksTabModel.ts`, `src/renderer/components/contextmenu/entityMenu.ts`, `src/shared/wayback.ts`,
and tests. About fourteen files, so under ADR-0016 the implementation needs the maintainer's plan
approval. A natural split is two PRs: the single-link lookup first (S1 to S3 single, S5, S6), then
the batch (S3 many, S4).

## Rulings, 2026-10-04

The maintainer accepted each recommendation the first draft of this plan made.

1. **Capture snapshot (S5).** Offered, and the replay page is captured with the archive.org
   toolbar, because the toolbar states the snapshot's time and source in the stored page itself.
2. **Batch lookups (S3, S4).** Shipped in this slice as the second PR, because checking a page's
   outbound links one by one is the manual work this slice exists to remove.
3. **Host-name refusals (S2).** Added 2026-10-06 after the pre-pass review of PR #1734. Ruled
   2026-10-26: refuse for both. The shared rule refuses a host with no dot (`wiki`, `intranet`)
   and a name under `.local`, `.internal` or `.home.arpa`, with the reason "Points at a private
   network", for the Wayback lookup and the Capture link menu alike. A dotted name that resolves
   to a private address still passes, and S2 names that gap. A second ruling the same day kept
   one rule everywhere: the names are refused inside `localAddressKind`, so every flow through
   the recapture queue refuses them too. Those are Recapture of one Capture, batch Recapture,
   Recapture from the capture health panel, the Add URLs box and Capture link, each refused at
   enqueue, and a redirect or navigation during a background capture, which ends the job as a
   refusal. Captures the extension sends are unaffected, because the capture server does not
   read the rule, so the app cannot recapture an extension Capture of such a host.

## Sequencing

Independent of slice 2. The `captureLinkBlockReason` move (S2) is a small first commit that slice
2 and issue #1726 can also build on.

## Revisions

2026-10-06, after the pre-pass review of PR #1734: S1 and S6 describe the answer the reused
function returns, 200-only and digest-collapsed, in its own terms; S2 states what
`captureLinkBlockReason` refuses today and recommends the host-name extension; S3 lists every
address in the confirmation and de-duplicates first; S6 keeps the Wayback cell out of the row's
button. Review findings adopted into the plan, not rulings, except that the S2 extension waits on
ruling 3.
