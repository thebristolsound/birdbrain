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
than time T, per a party the operator does not control. Then a rewrite of anything before N is
detectable, not merely unlikely.

## Decision: which party anchors the chain

Three options were weighed in trust-model terms.

| Option | Who vouches | What a rewrite costs the operator | Who learns what |
| --- | --- | --- | --- |
| A. RFC 3161 TSA (DigiCert, the configured `tsaUrl`) | The TSA's signature, chaining to a publicly trusted root | Anything before the last anchor needs a back-dated token, which the TSA will not issue | The TSA receives a hash, the request time, and the egress IP. Nothing is public |
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
  as unanchored, not tampered. The verifier reports coverage, so an unanchored chain from a
  build that anchors is visible as such (see "Verifier"), but it is a missing proof, not a
  failed one.
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

The Shared Case design's `merge` stamp (collaborative cases design, step 6 of the sync
session) is the same entry over a `merge` head. Once anchoring ships, a merge needs no
separate stamp: it is an unanchored entry, and the next anchor covers it. The build ticket
for merge stamping should take this form instead of a merge-specific queue.

## Cadence

The timestamp worker already retries pending content stamps on start, after each capture, and
every five minutes (`RETRY_INTERVAL_MS` in `src/main/services/timestampWorker.ts`). On each of
those passes, after content stamps:

1. Find the head. If it is an anchor entry, or every entry after the last anchor is itself an
   anchor, stop. This keeps an idle case at zero requests and stops an anchor from anchoring
   itself.
2. Request a token over the head's `entryHash` from the configured TSA, check its imprint, and
   append the anchor entry. On failure, do nothing; the next pass retries.

Export makes one anchor attempt over the current head before it snapshots the manifest, with
the same short timeout the TSA client uses. Success means the bundled chain is anchored
through its last entry. Failure lets the export continue and the package reports its tail as
pending.

The operator's timestamping switch (`tsaEnabled`, #1169) governs anchors too. One setting decides
whether this process may contact a TSA, and Settings and Diagnostics already show it.

**What stays undetectable at this cadence:** entries written after the last anchor. While
online that is at most five minutes plus TSA latency. Offline, it is the whole offline period,
and the verifier shows it as such. At export, it is nothing if the export-time anchor
succeeded. Routed TSA requests (ADR-0032) add latency to each anchor but do not change the
window.

## Offline and unreachable states

Anchoring reuses the trusted-time vocabulary instead of adding a second one. Each entry
resolves to one value of the existing `TrustedTime` type:

- `rfc3161`: a verified anchor at or after it covers it. The entry carries the earliest
  covering anchor's `stampedAt` and TSA name.
- `pending`: no anchor covers it, timestamping was on when it was written, and the chain
  holds at least one anchor or was written by a build that anchors (the signed `toolVersion`
  says which). This is the offline case, and also the case of deleted anchors.
- `none`: no anchor covers it, and either the chain predates anchoring or a `timestamping`
  record (next section) says the switch was off when the entry was written.

The first anchor after upgrading covers every older entry, with that anchor's time. That
proves the old entries existed by the upgrade, which is true and no stronger.

**Unreachable at verification time does not arise.** Verifying a token needs no network:
`openssl ts -verify` checks it against the TSA root the package bundles, the same as for content
tokens today. A package with no bundled root needs the reader to supply one, as it does now. A verifier offline at verification time gets the same answer as one
online.

## Recording the timestamping switch

Without a record, a chain written with `tsaEnabled` off reads the same as one whose anchors
were deleted: both have an unanchored tail. The chain therefore records the switch.

A new `timestamping` entry carries `enabled: boolean`. It is written into a case's chain
immediately before any other entry when the switch's current state differs from the last
state that chain records. A chain with no `timestamping` entry is read as on, the default.
The switch is per installation and chains are per case, so a case nobody touches while the
switch is off gets no entry, and needs none: it has no entries to explain.

The verifier resolves an unanchored entry to `none` when the nearest preceding `timestamping`
entry says off, and to `pending` otherwise. The report names each off span as `timestamping was
off for entries J to K`.

This does not let an operator excuse a rewrite. An off record inside the anchored prefix is
fixed by the anchors like any other entry, so it cannot be inserted after the fact. One in the
unanchored tail is in the window the design already concedes, and it states in the chain that
anchoring was off for the span, which is the disclosure a declaration needs.

The new type is a schema change, to `MANIFEST_SCHEMA_VERSION` 5. A schema-4 verifier meeting
the entry reports the too-old verdict, not a broken chain (X25), as every type added since
schema 3 has.

## Package format

- Anchor tokens ship as files under `anchors/`, named by the anchored entry's index
  (`anchors/<index>.tst`). The new path helper sits beside `timestampTokenPath` in
  `src/packages/evidence-package-layout/lib/paths.ts`.
- `evidence.json` `verificationMaterials` gains an `anchors` list of
  `{ anchoredIndex, entryHash, tokenPath, stampedAt }`. Like `timestampTokenPaths`, it is an
  untrusted locator: the verifier uses it to find files and binds each file's bytes to the
  signed `tsaToken` in the chain.
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
in one line: `Chain anchored through entry N of M at T (TSA name); M − N entries pending`. It
also reports the largest gap between an entry's own `timestamp` and its covering anchor's
`stampedAt`. A long gap while anchoring was on is a fact a declaration should explain. It is
not a verdict.

As with content tokens, the binary checks imprint and byte binding only. TSA signature
validity is proved by the runbook step.

### `VERIFY.md` step

`src/main/services/verifyRunbook.ts` gains a step after 6b, one command per anchor:

```sh
openssl ts -verify -digest <entryHash> -in anchors/<index>.tst -token_in \
  -CAfile <tsa root> -untrusted <tsa intermediates>
```

The step asks the reader to compare `<entryHash>` with line `<index>` of `manifest.jsonl`. It
then states the claim this proves: every line up to that one existed by the token's time.

## What an observer learns

Nothing is published. The TSA, DigiCert by default, receives a SHA-256 digest of a manifest
entry, the time of the request and the address it came from, which is the egress route under
ADR-0032. The digest reveals nothing about the case: it is a hash over an entry that is itself
built from hashes and metadata. DigiCert already receives one request per capture for content
stamps. Anchoring adds at most one more request per five minutes while a case is changing. An
observer of DigiCert's traffic would learn when the investigator is active. They learn that
already from content stamps.

## Threat model change

When anchoring ships, the threat model paragraph on the determined operator gains the following:

> The chain head is anchored with the same Timestamp Authority every few minutes and at
> export. An operator who rewrites the chain cannot make the rewrite verify against those
> anchors; they can only remove them, which the verifier reports as missing anchor coverage.
> Entries written after the last anchor, and any chain kept in parallel at capture time, stay
> outside this protection.

## Build slices

Each slice is evidence-affecting and gets human review.

1. **Verify-core.** Anchor index and the coverage result on `ChainVerifyResult`, pure, with
   unit tests over hand-built chains: covered, pending tail, dropped anchors, an anchor naming
   a foreign hash, and an imprint mismatch.
2. **Worker and switch record.** The anchoring pass, with the idle and self-anchor stops and
   the `tsaEnabled` gate, plus the schema-5 `timestamping` entry and the off-span rule in
   verify-core.
3. **Export and verifier.** The export-time anchor, the `anchors/` files and locator, the
   verifier check and report line, and the `VERIFY.md` step.
4. **Surfaces and docs.** Coverage on Diagnostics and the case's integrity view, plus the
   threat model change in the preceding section.

## Open questions

- **TSA rate limits.** DigiCert's public endpoint publishes no request limit that this design
  could cite. Anchoring at most every five minutes per active case is light, but a check
  before slice 2 ships would confirm it.
