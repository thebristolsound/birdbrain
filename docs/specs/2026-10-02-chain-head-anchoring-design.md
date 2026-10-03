# Chain head anchoring: design

Date: 2026-10-02
Status: design, not implemented. Nothing below ships today.
Issue: #586 (review recommendation R3). Complements #588, which hardens the signing key.

Three decisions came from the maintainer on 2026-10-02: anchor with the RFC 3161 Timestamp
Authority Birdbrain already uses (option A below), anchor on the timestamp worker's existing
cycle plus at export, and record the timestamping switch in the chain. Everything else here
follows from those three.

## Problem

Each capture's content can carry an RFC 3161 token, which proves those bytes existed by the
stamped time. Nothing proves when the chain itself existed. The chain lives on the operator's
machine, signed by an installation-local key, so an operator holding that key can rebuild it
before export. A rebuilt chain can drop a `deletion` entry, reorder captures, or omit a capture
entirely, and it verifies as cleanly as the original. The threat model states this limit; this
design narrows it.

The property wanted: a verifier can establish that this chain, up to entry N, existed no later
than time T, per a party the operator does not control. Then a rewrite of anything up to N fails
verification for as long as the package still carries that anchor. An operator who removes the
anchor removes the proof with it; "What A gives up" states what follows from that.

## Decision: which party anchors the chain

Three options were weighed in trust-model terms.

| Option | Who vouches | What a rewrite costs the operator | Who learns what |
| --- | --- | --- | --- |
| A. RFC 3161 TSA (DigiCert, the configured `tsaUrl`) | The TSA's signature, chaining to a publicly trusted root | Rewriting anything an anchor covers needs a back-dated token, which the TSA will not issue, or dropping that anchor | The TSA receives a hash, the request time, and the egress IP. Nothing is public |
| B. Sigstore Rekor | Rekor's signed tree head and inclusion proof | As A, and a verifier can also search the log by key for anchors the package omits | Anyone: the installation's public key, each anchor's hash and time, forever |
| C. OpenTimestamps | Bitcoin block headers; no trusted party | As A, once the proof confirms (hours) | Calendar servers receive a hash; the chain holds an aggregated digest |

**A is chosen.** It adds no third party, no network destination and no proof format: the
token is the one the content axis already uses, verified by the same `openssl ts -verify`
step against the same root. The chain schema already carries the needed form. Schema 4 added
`subject: 'entry'` to the `timestamp` entry so a `merge` entry's hash can be stamped
(`src/shared/schemas.ts`, `ManifestTimestampEntrySchema`); an anchor is that entry pointed at
the chain head. No schema bump.

What A gives up, stated so no declaration over-claims it:

- **Dropped anchors are not detectable.** Anchor tokens live in the chain they anchor. An
  operator who rewrites the chain and deletes every anchor entry produces a chain that reads
  as unanchored, not tampered. Nothing outside the operator's control says whether the chain
  ever had anchors: the build version each entry records and the `timestamping` records
  (see "Recording the timestamping switch") are signed with the same key the operator holds,
  so a rebuilt chain can state an older build or a switched-off span. Such a chain reads as
  one written without anchoring. The verifier reports coverage, so the result is an absent
  proof, never a failed one.
- **Forks at capture time are not detectable.** An operator who keeps two chains in parallel
  and anchors both can later ship either. Rekor's search-by-key would expose that; a TSA keeps
  no public record. This is the "operator controls the running process" limit, and #588 is
  the work that narrows it.

B remains a later opt-in for an operator who wants dropped-anchor and fork detection and
accepts publishing their key and activity times. It is out of scope here. C was rejected for
the default because a package exported shortly after capture ships an unconfirmed proof.

## Anchor entry

An anchor is a `timestamp` entry with `subject: 'entry'` whose `captureContentHash` holds the
`entryHash` of the chain's last entry at request time. The field name is kept for the
hash-stability reason the schema comment gives. `tsaToken` holds the token, and the token's
imprint equals that `entryHash`.

Because every `entryHash` covers its `prevHash`, one token over entry N fixes entries 0..N.
The anchor names its target by hash, not index; a hash is unique in a valid chain, so no new
field is needed.

An anchor is appended after the entry it names, so no token covers the anchor entry itself
until a later anchor does. Coverage is therefore counted over non-anchor entries only: an
anchor entry needs no covering, because the TSA's signature is its proof of time and removing
it is the dropped-anchor case already conceded. Every statement below about "the last entry"
or "pending entries" means non-anchor entries.

The Shared Case design's `merge` stamp (collaborative cases design, step 6 of the sync
session) is the same entry over a `merge` head. Once anchoring ships, a merge needs no
separate stamp: it is an unanchored entry, and the next anchor covers it. The build ticket
for merge stamping should take this form instead of a merge-specific queue.

## Cadence

The timestamp worker retries pending content stamps on start and every five minutes
(`processPending`, on the `RETRY_INTERVAL_MS` timer in `src/main/services/timestampWorker.ts`).
A new capture stamps only itself, through `enqueue`, and runs no retry pass. The anchoring pass
rides the retry pass only, not `enqueue`, so a burst of captures adds no anchor requests. On
each retry pass, after content stamps, for each case:

1. Find the last non-anchor entry. If an anchor already names it or a later entry, stop. This
   keeps an idle case at zero requests and stops an anchor from anchoring itself.
2. If an anchor request for this case is already in flight, stop.
3. Request a token over the current head's `entryHash` from the configured TSA, check its
   imprint, and append the anchor entry. On failure, do nothing; the next pass retries.

An entry appended while a request is in flight is not covered by the anchor that request
produces, because that anchor names the earlier head. Step 1 finds it uncovered on the next
pass and anchors it then.

Export runs three steps before it snapshots the manifest, in this order. It writes any
`timestamping` record the chain owes (see "Recording the timestamping switch"). It then makes
one anchor attempt over the current head, with the same short timeout the TSA client uses,
when the switch is on. Then it snapshots. Nothing may be appended between the snapshot and the
signed export entry, which must name the bundled head as its `prevHash`
(`src/shared/verify/evidencePackage.ts`). A successful attempt means the bundled chain is
anchored through its last non-anchor entry. Failure lets the export continue and the package
reports its unanchored entries as pending.

The operator's timestamping switch (`tsaEnabled`, #1169) governs anchors too. One setting decides
whether this process may contact a TSA, and Settings and Diagnostics already show it.

**What stays undetectable at this cadence:** entries written after the last anchor. While
online that is at most five minutes plus TSA latency, including for an entry that lands while
a request is in flight. Offline, it is the whole offline period, and the verifier shows it as
such. At export, it is nothing if the export-time anchor
succeeded. Routed TSA requests (ADR-0032) add latency to each anchor but do not change the
window.

## Offline and unreachable states

Anchoring reuses the trusted-time vocabulary instead of adding a second one. Each entry
resolves to one value of the existing `TrustedTime` type:

- `rfc3161`: a verified anchor covers it, meaning the anchor names this entry or a later one.
  The entry carries the earliest covering anchor's `stampedAt` and TSA name.
- `pending`: no anchor covers it, timestamping was on when it was written, and the chain
  holds at least one anchor or was written by a build that anchors (the signed `toolVersion`
  says which). This is the offline case, and also the case of deleted anchors.
- `none`: no anchor covers it, and either the chain predates anchoring or a `timestamping`
  record (next section) says the switch was off when the entry was written.

`pending` versus `none` rests on the chain's own statements, `toolVersion` and the
`timestamping` records, which the operator signs. They are evidence of what the operator's
build recorded, not proof against the operator: "What A gives up" states the case where they
are rewritten.

The first anchor after upgrading covers every older entry, with that anchor's time. That
proves the old entries existed by the upgrade, which is true and no stronger.

**Unreachable at verification time does not arise.** Verifying a token needs no network:
`openssl ts -verify` checks it against a TSA root the reader trusts, the same as for content
tokens today. The package bundles a copy of the root, which becomes a trust anchor only once
the reader checks its fingerprint against a source outside the package (runbook step 6a). A
package with no bundled root needs the reader to supply one, as it does now. A verifier
offline at verification time gets the same answer as one online.

## Recording the timestamping switch

Without a record, a chain written with `tsaEnabled` off reads the same as one whose anchors
were deleted: both have an unanchored tail. The chain therefore records the switch.

A new `timestamping` entry carries `enabled: boolean`. It is written into a case's chain
immediately before any other entry when the switch's current state differs from the last
state that chain records. Export writes it too, before the manifest snapshot (see "Cadence"),
so a switch change with no later entry still reaches the package. A chain with no
`timestamping` entry is read as on, the default. The switch is per installation and chains are
per case, so a case nobody touches while the switch is off gets no entry, and needs none: it
has no entries to explain.

The verifier resolves an unanchored entry to `none` when the nearest preceding `timestamping`
entry says off, and to `pending` otherwise. The report names each off span as `timestamping was
off for entries J to K`, and says whether an anchor covers the record that opened the span.

The record is the operator's statement, and it limits a rewrite only where an anchor fixes it.
An off record that an anchor in the package covers cannot have been inserted after that anchor's
time. One that no anchor covers is a statement signed with the operator's key and nothing more.
An honest build writes it, and a reader learns from it why a span has no anchors. An operator
who rebuilds the chain and drops every anchor can also forge one, together with an older
`toolVersion`, so that a rewritten chain reads as written with timestamping off. The verifier
cannot tell that chain from an honest one; the threat model change below says so.

The new type is a schema change, to `MANIFEST_SCHEMA_VERSION` 5. A schema-4 verifier meeting
the entry reports the too-old verdict, not a broken chain (X25), as every type added since
schema 3 has.

## Package format

- Anchor tokens ship as files under `anchors/`, named by the `entryHash` of the anchor entry
  that carries the token (`anchors/<anchorEntryHash>.tst`). A Shared Case package ships
  several chains, each with its own zero-based indexes (`memberChainPath`,
  `lineageChainPath`), so an index would collide across chains. The anchor entry's hash
  covers its token, so two different tokens never share a name. The new path helper sits
  beside `timestampTokenPath` in `src/packages/evidence-package-layout/lib/paths.ts`.
- `evidence.json` `verificationMaterials` gains an `anchors` list of
  `{ chainPath, anchorIndex, anchoredEntryHash, tokenPath, stampedAt }`, where `chainPath` is
  the package path of the chain holding the anchor. Like `timestampTokenPaths`, it is an
  untrusted locator: the verifier uses it to find files and binds each file's bytes to the
  signed `tsaToken` in the chain.
- The index shape changes, so `EVIDENCE_INDEX_SCHEMA_VERSION` goes from 2 to 3, as the
  comment beside it in `src/shared/schemas.ts` requires. The frozen export-entry era cutoff
  beside it stays at 2.
- The content-token filters in `src/shared/verify/evidencePackage.ts` already exclude
  `subject: 'entry'`, so anchors cannot leak into the per-capture timestamp check.

## Verifier

### Check

A new check after chain verification (§7.1 in the standalone verifier design) and before the
per-capture binding:

For each verified anchor entry before any chain break:

- The anchored `entryHash` must match an entry earlier in the chain. No match → FAIL `anchor
  at index K names an entry this chain does not contain`.
- The token's imprint must equal that `entryHash`. Mismatch → FAIL `anchor at index K does not
  bind the entry it names`.
- The located `anchors/` file's bytes must equal the decoded `tsaToken`. Missing → FAIL;
  mismatch → FAIL `anchor token does not match the signed manifest`.

An unanchored chain is not a failure. Neither is a pending tail. The verifier reports coverage
in one line: `Chain anchored through entry N at T (TSA name); P entries pending`, where N is the
newest entry an anchor names and P counts the non-anchor entries after N. It also reports the
largest gap between an entry's own `timestamp` and its covering anchor's `stampedAt`. A long gap
while anchoring was on is a fact a declaration should explain. It is not a verdict.

As with content tokens, the binary checks imprint and byte binding only. TSA signature
validity is proved by the runbook step.

### `VERIFY.md` step

`src/main/services/verifyRunbook.ts` gains a step after 6b, one command per anchor, using the
root the reader confirmed in step 6a:

```sh
openssl ts -verify -digest <anchoredEntryHash> -in anchors/<anchorEntryHash>.tst -token_in \
  -CAfile <tsa root> -untrusted <tsa intermediates>
```

The step asks the reader to find the entry whose `entryHash` is `<anchoredEntryHash>` in the
chain named by `chainPath`. Entry indexes are zero-based, so entry K is line K + 1 of the file.
It then states the claim this proves: every entry up to that one existed by the token's time.

`verify.sh` (`src/main/services/verifyScript.ts`), which the runbook calls the executable form
of its steps, gains the same command in the same slice.

## What an observer learns

Nothing is published. The TSA, DigiCert by default, receives a SHA-256 digest of a manifest
entry, the time of the request and the address it came from, which is the egress route under
ADR-0032. The digest reveals nothing about the case: it is a hash over an entry that is itself
built from hashes and metadata. DigiCert already receives one request per capture for content
stamps. Anchoring adds at most one request per case per retry pass. Passes run on start and
every five minutes, and a pass requests only for a case holding an entry no anchor covers.
Each export adds one more.

The timing is a new signal. Content stamps already tell DigiCert, and an observer of its
traffic, when the investigator captures. Anchors also follow activity that sends no TSA
request today: a deletion, an exclusion, a renumbering, a member change, and an export. After
anchoring ships, the TSA learns that a case changed in each five-minute window
where any of these happened, though not what changed. The operator's timestamping switch
turns this off along with content stamps.

## Threat model change

When anchoring ships, the threat model paragraph on the determined operator gains the following:

> The chain head is anchored with the same Timestamp Authority every few minutes and at
> export. A rewrite of any entry that an anchor in the package covers fails verification
> against that anchor. An operator who removes every anchor and rebuilds the chain can make it
> read as one written with timestamping off or by a build that predates anchoring, and the
> verifier cannot tell it from an honest chain of that kind. Entries written after the last
> anchor, and any chain kept in parallel at capture time, also stay outside this protection.

## Build slices

Each slice is evidence-affecting and gets human review.

1. **Verify-core.** Anchor index and the coverage result on `ChainVerifyResult`, pure, with
   unit tests over hand-built chains: covered, pending tail, dropped anchors, an anchor naming
   a foreign hash, an imprint mismatch, a head that is an anchor (not pending), and an entry
   appended between an anchor's target and the anchor (pending).
2. **Worker and switch record.** The anchoring pass on the retry timer, with the idle and
   in-flight stops and the `tsaEnabled` gate, plus the schema-5 `timestamping` entry and the
   off-span rule in verify-core.
3. **Export and verifier.** The switch record and anchor attempt before the export snapshot,
   the `anchors/` files and locator, the index version bump, the verifier check, the report
   line, and the `VERIFY.md` step with its `verify.sh` command.
4. **Surfaces and docs.** Coverage on Diagnostics and the case's integrity view, plus the
   threat model change in the preceding section.

## Open questions

- **TSA rate limits.** DigiCert's public endpoint publishes no request limit that this design
  could cite. At most one anchor per changed case per five minutes, plus one per export, is
  light, but a check before slice 2 ships would confirm it.
