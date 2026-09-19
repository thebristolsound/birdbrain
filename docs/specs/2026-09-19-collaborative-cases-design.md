# Shared Cases: peer-to-peer collaboration design

Date: 2026-09-19
Status: design, not implemented. Nothing below ships today.
Companion: [Shared Case members UI design brief](2026-09-19-shared-case-members-ui-brief.md)
holds the designer-facing surface list. This document is the engineering contract.
Decisions come from a grilling session with the maintainer on 2026-09-19; every
recommendation was accepted.

## Problem

Birdbrain is single-user. One installation owns one signing key, one Manifest per Case, and one
SQLite database. Two investigators working one Case today exchange Case Archives by hand, and
the import path (`src/main/services/caseArchive.ts`) rebuilds the Case under the importer's key
with an `import` boundary entry. That works for a handoff and fails for ongoing work: every
exchange is a full package, nothing merges, and the second investigator's later Captures never
reach the first.

The target user is 2–5 trusted peers (civil-society investigators, ADR-0029) who will not run
a server, will not create accounts, and may be behind carrier-grade NAT. The maintainer's hard
constraint: joining a Shared Case is one paste and one click, with nothing installed beyond
Birdbrain.

## Constraints

- **Evidence semantics are unchanged.** Every mechanism in `CONTEXT.md` "Provenance and
  integrity" (Manifest, Entry Hash, Content Hash, Trusted Time, Integrity Status) applies to a
  Shared Case exactly as to a single-user Case. A member's Manifest is append-only, signed by
  that member's installation key, and never rewritten by anyone.
- **Privacy: no third party holds Case content.** Peers connect to each other. A relay may carry
  encrypted bytes when hole-punching fails; it learns which nodes connected, when, and how much,
  never Case content.
- **Painless setup.** No account, no terminal, no port forwarding, no VPN. Tailscale is neither
  required nor detected in v1.
- **Blocking-tier paths.** Manifest schemas (`src/shared/schemas.ts`), verify-core
  (`src/shared/verify/`), export, and the standalone verifier (`src/verifier/`) are on the
  evidence path. The verifier must learn every new entry type and ship in a release before any
  build writes one (ADR-0023, same rule).

## Decisions

| #   | Decision                              | Chosen                                                                                                                                      |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Data model                            | Each member keeps its own signed chain. A Shared Case is the set of member chains plus `merge` entries that reference other members' heads. |
| 2   | Transport                             | Iroh (`@number0/iroh`, new dependency, approved) behind a transport interface. n0 public relays by default; `relayUrl` setting for self-host. |
| 3   | Team size                             | 2–5 peers. Every peer holds a full replica: all member chains, all Exhibit bytes.                                                            |
| 4   | Roles                                 | One Owner (creator) who invites and revokes. Every other member writes. No read-only role in v1.                                             |
| 5   | Invite                                | One-way invite string from the Owner; joiner pastes; Owner approves in-app. Single use, 24-hour expiry, Owner must be online.                |
| 6   | Member identity                       | Member = installation (existing RSA signing key, `src/main/services/signingKey.ts`). Display name from `operatorName`.                       |
| 7   | Exhibit Number                        | `<Member Code>-<sequence>`. Sequence is per member. Prefix hidden in the app when the Case has one member; always shown in exports.           |
| 8   | Member Code                           | Assigned by the Owner at approval, defaults to `operatorName` initials, unique within the Case, recorded in the `member-add` entry.           |
| 9   | Working layer (notes, tags, annotations) | Per-author rows, synced append-only with tombstones. No CRDT. Tags merge by name for display.                                            |
| 10  | Deletion and exclusion                | Only the author writes `deletion` for their Exhibit. The Owner writes `exclude`, which exports honor and list.                              |
| 11  | Revocation                            | `member-revoke` entry. Peers stop syncing with the member. The member keeps its replica; the UI says so.                                    |
| 12  | At-rest encryption                    | None added. Full-disk encryption stays the documented prerequisite. Transport encryption only.                                              |
| 13  | Sync trigger                          | Automatic while the app is open and a peer is reachable, plus **Sync now**. Pull-only.                                                       |
| 14  | `merge` granularity                   | One entry per sync session that brought at least one new remote entry.                                                                      |
| 15  | Trusted Time on receipt               | The receiver submits the `merge` entry's Entry Hash to its TSA. On by default when a TSA is configured.                                      |
| 16  | Share granularity                     | Whole Case. Partial sharing is an Evidence Package export, which exists.                                                                     |
| 17  | Local-only state                      | Staging Pool, Selectors, to-do items, and TSA settings do not sync.                                                                          |
| 18  | Owner loss                            | Any member can create a new Case from their replica (import path, lineage entry). `owner-transfer` is phase 2.                              |

Rejected: a shared mutable database with a coordinator (one party can rewrite history; needs a
server); CRDT for the evidence layer (evidence is append-only facts, conflicts cannot occur);
last-writer-wins for notes (silent loss); Tailscale as a requirement (three steps and an account
outside the app); Elasticsearch as a sync backbone (plaintext leaves the device; with full
replicas any peer's FTS5 index already covers the Case).

## Architecture

Three layers, each with its own consistency model.

**Evidence layer.** Member chains and Exhibit bytes. Append-only, signed, content-addressed.
Conflict-free by construction: two members capturing at the same instant produce two entries in
two chains, each with its own Member Code and sequence. Nothing coordinates.

**Working layer.** Notes, tags, tag applications, annotations. Each row belongs to one author
installation and only that installation edits it. Sync ships the author's rows newer than the
peer's last-seen version, with tombstones for deletes. Two authors never write one row, so
"last write wins" is a statement about one author's own devices and loses nothing.

**Transport layer.** Iroh QUIC connections between installations, authenticated at two levels:
Iroh's node key encrypts and authenticates the connection, and a challenge signed with the
Birdbrain signing key proves the peer is the member the `member-add` entry named. The Iroh node
id is recorded in `member-add` so a stolen invite cannot be replayed from another node without
also holding the signing key.

### Case directory

Today `<storageRoot>/<caseId>/` holds Exhibit files and `manifest.jsonl`. A Shared Case adds:

- `manifest.<installationId>.jsonl` for each remote member, byte-for-byte as received. The local
  chain stays `manifest.jsonl`.
- `members.json`, a cache of the member roster derived from `member-add` and `member-revoke`
  entries in the Owner's chain. Derived, never authoritative; rebuilt from the chain.
- `sync-state.json`: per-peer last-seen chain heads and working-layer versions. Local, not
  evidence.

Remote Exhibit bytes land at the storage-root-relative `path` their entry names, under the same
`caseId` (the joiner adopts the Owner's `caseId`). The receiver hashes every file on arrival and
refuses a mismatch against the entry's `contentHash` before the file is visible.

### Manifest entries

`MANIFEST_SCHEMA_VERSION` becomes 4. Four new entry types, each carrying the standard chain
fields (`caseId`, `timestamp`, `operatorId`, `operatorName`, `toolVersion`, `index`,
`prevHash`, `schemaVersion` pinned to 4, `signature`, `entryHash`) and `.strict()` like every
schema-3 entry:

- `member-add`: `memberInstallationId`, `memberPublicKeyPem`, `memberCode`,
  `memberOperatorName`, `nodeId`, `role` (`owner` | `member`). Only the Owner writes it. The
  first one, written when the Case becomes shared, names the Owner itself and fixes the
  Owner's Member Code.
- `member-revoke`: `memberInstallationId`. Only the Owner writes it.
- `merge`: `heads`, an array of `{ installationId, index, entryHash, entriesReceived }`, one
  per remote member whose chain advanced in this sync session. Any member writes it.
- `exclude`: `exhibitId`, `authorInstallationId`, optional `reason`. Only the Owner writes it.
  Exports keep the Exhibit's entry and list the exclusion; they do not omit it.

Two existing entries change:

- `exhibit` gains optional `memberCode`. Absent means "the chain's own writer," which keeps
  every schema-3 entry valid and gives single-member Cases the same rule as shared ones. The
  `exhibitNumber` integer stays and becomes the per-member sequence.
- `timestamp` gains a second subject form. Today it binds a Content Hash; the `merge` stamp
  binds an Entry Hash. The schema carries `subject: 'content' | 'entry'`, defaulting to
  `content` when absent so schema-2 and schema-3 tokens parse unchanged.

The "verifier too old" outcome ADR-0023 introduced covers the release gap: a schema-3 verifier
meeting a schema-4 entry reports that, not a broken chain.

### Verification

`verifyManifestChainText` (`src/shared/verify/manifestChain.ts`) is unchanged for a single
chain: it verifies one chain against one key, switching at `import` boundaries. Shared-Case
verification is a layer above it, `verifySharedCase`, in the same module tree:

1. Verify the Owner's chain. Collect the member roster from `member-add` and `member-revoke`
   entries in chain order.
2. Verify each remote member's chain with the public key its `member-add` entry carries. An
   entry written after that member's `member-revoke` is reported, not accepted.
3. For every `merge` entry in every chain, check that each referenced `(installationId,
   index, entryHash)` exists in that member's chain. A `merge` naming a head that is absent or
   differs is a distinct non-pass outcome, `merge-head-mismatch`.
4. Resolve every `exhibit` entry's citation as `<memberCode>-<exhibitNumber>`, taking the code
   from the entry or, when absent, from the chain writer's `member-add`. A Case with no
   `member-add` entries has one member and no prefix.

What this proves: each member's chain was not edited without that member's key; each member's
`merge` entries name chain states that exist; an Exhibit citation resolves to exactly one entry.
What it does not prove: that a member's key was not misused by whoever holds that machine, or
that a member's TSA is honest. The `SECURITY.md` statement about the Operator holding the key
applies per member.

The standalone verifier (`src/verifier/cli.ts`) learns the same walk. Evidence Package export
(`src/main/services/export.ts`) ships every member chain and every `member-add` public key, and
the Certification is signed by the exporting member.

### Invite and join

The invite string is `bbinvite1` followed by base32 of a CBOR map: Iroh ticket (node id, relay
URL, direct addresses), `caseId`, Owner `operatorName`, a 16-byte one-time secret, and an expiry
timestamp. It is shown as text and as a QR code.

1. The joiner pastes the string. Its app dials the Owner's node over Iroh.
2. The joiner sends `join`: the secret, its public key PEM, `installationId`, `operatorName`,
   and a signature over `secret || ownerNodeId` made with its signing key.
3. The Owner checks the secret (unused, unexpired), verifies the signature against the offered
   key, and shows the approval dialog with the key fingerprint (SHA-256 over the DER public key,
   first 32 hex characters in groups of four) and a Member Code field.
4. On approve, the Owner writes `member-add`, then sends `welcome`: the Owner's public key, the
   `caseId`, Case name, and the current roster. The joiner creates the Case locally under that
   `caseId` and starts a sync session.

The secret is single use and expires after 24 hours; the Owner discards it on either. A declined
join writes nothing.

### Sync session

Pull-only, over one Iroh bidirectional stream per session, messages CBOR-encoded:

1. `hello`: `caseId`, `installationId`, a 32-byte challenge. Each side signs the other's
   challenge with its signing key and verifies against the roster. A peer not in the roster, or
   revoked, gets `bye` and the connection closes.
2. `heads`: for each member chain the sender holds, `{ installationId, index, entryHash }`.
3. `entries`: the requester asks for `(installationId, fromIndex)` and receives the entries as
   raw lines. The receiver parses each with `ManifestEntrySchema`, verifies the chain segment
   against the member's key, and appends to `manifest.<installationId>.jsonl` only when the
   segment continues its stored head.
4. `blobs`: the requester lists Content Hashes it lacks for entries it now holds; the sender
   streams each file. The receiver hashes on arrival and rejects a mismatch.
5. `rows`: working-layer rows for `(authorInstallationId, sinceVersion)`, applied only when
   `authorInstallationId` matches the connected peer's installation or a member the peer holds
   rows for (transitive sync lets two peers exchange a third's rows; each row still carries
   its author's signature over its canonical JSON, checked on apply).
6. After any new entry landed, the receiver writes `merge` to its own chain and, when a TSA is
   configured, queues the `merge` Entry Hash for a `timestamp` entry with `subject: 'entry'`.

Every peer runs the session against every reachable member on app start, on a 60-second timer
while peers are connected, and on **Sync now**. Because nothing is pushed, a malicious peer can
only offer entries; the receiver's signature and hash checks decide what is stored.

### Working-layer rows

`notes`, `annotations`, `tags`, and tag applications gain `author_installation_id` (null means
local, treated as the local installation), `version` (monotonic per author), `deleted_at`, and
`row_signature`. The local installation signs its own rows on write. Remote rows are inserted
only with a valid signature from a roster member and a version above the stored one.

Tag display merges by `name`; the merged chip lists each author on hover. Tag color is the
earliest-created author's, by `created_at`, with ties broken by `installationId`.

### Database

One schema migration (`pnpm db:migration:new shared-cases`):

- `case_members` (`case_id`, `installation_id`, `public_key_pem`, `member_code`,
  `operator_name`, `node_id`, `role`, `added_at_index`, `revoked_at_index`). Cache of the chain.
- `exhibits.member_code TEXT NULL`, `exhibits.author_installation_id TEXT NULL`; the unique
  constraint becomes `(case_id, author_installation_id, exhibit_number)`. Existing rows keep
  null in both, meaning "this installation."
- Working-layer columns as above.
- `cases.shared_at TEXT NULL`, `cases.owner_installation_id TEXT NULL`.

No data is rewritten. Prefix display is a read-time rule.

### IPC

New channels under a `sharing:` domain in `src/shared/ipc.ts`: `sharing:createInvite`,
`sharing:cancelInvite`, `sharing:join`, `sharing:approveJoin`, `sharing:declineJoin`,
`sharing:revoke`, `sharing:excludeExhibit`, `sharing:syncNow`, `sharing:getMembers`,
`sharing:getSyncState`, `sharing:setRelayUrl`, `sharing:isAvailable`. Progress and state
events follow the pattern `cases:exportArchive` uses.

### Transport interface

`src/main/services/sharing/transport.ts` defines `Transport` with `listen`, `dial(ticket)`,
`openStream`, and `close`. `IrohTransport` implements it over `@number0/iroh`. Tests use
`MemoryTransport`, an in-process pair, so the sync protocol and verify code run in the unit
suite without native code. Adding Tailscale or LAN later is a second implementation.

### Platform gate

`@number0/iroh` 1.1.0 ships prebuilt binaries as per-platform optional dependencies and no
`darwin-x64` build. `sharing:isAvailable` reports false when the binding fails to load, and the
Members tab shows the unavailable state from the brief. Packaging must `asarUnpack` the
binding's `.node` files, as the Linux build already does for `sharp`; verify on all three
platforms before the feature leaves draft.

## Evidence impact

1. **Investigation need, baseline, and threat.** Small teams need one Case with attributed
   contributions and no server holding the evidence. Baseline: ADR-0004. Threat: a peer or relay
   inserting, altering, or dropping another member's entries; a revoked member continuing to
   write; a citation resolving to two Exhibits.
2. **Supported claim.** For a Shared Case, verification shows that each member's chain was not
   edited without that member's installation key, that every `merge` names chain states that
   exist, and that every `<Member Code>-<n>` citation resolves to one entry. It does not show who
   sat at a member's machine, that any member's TSA is honest, or that a revoked member deleted
   its replica.
3. **Evidence and custody effects.** Originals are unchanged; a remote member's Exhibit bytes
   are stored as received and hash-checked. Actor semantics widen from one Operator to one
   Operator per chain. Custody gains three recorded events: membership changes, receipt
   (`merge`), and exclusion. Deletion stays with the author.
4. **Verification and failure behavior.** New non-pass outcomes: `merge-head-mismatch`, entry
   after revocation, unknown member key. A schema-3 verifier reports "verifier too old" on any
   schema-4 entry. Known-answer fixtures cover a two-member Case, a revoked member's late entry,
   a forged remote entry, a `merge` naming a missing head, and a single-member Case with no
   prefix.

## Build order

Each step is its own PR; steps 1–3 are evidence-affecting and get human review.

1. **Schema 4 and verifier.** Entry schemas, `verifySharedCase`, standalone verifier, "too old"
   coverage, fixtures. Ships before anything writes schema 4.
2. **Database and Exhibit Number display.** Migration, `member_code` resolution, prefix rule in
   list, detail, citations, and exports.
3. **Export and import of Shared Cases.** Evidence Package and Case Archive carry member chains
   and keys; fork-from-replica for Owner loss.
4. **Transport and sync core.** `Transport`, `MemoryTransport`, sync session, working-layer row
   signing. Tested entirely in-process.
5. **Iroh transport, invite, and join.** New dependency, packaging, platform gate, relay setting.
6. **Members UI.** From the designer's mock (see the brief).
7. **Trusted Time on `merge`.** Timestamp worker subject `entry`.

Later phases, not planned here: read-only reviewer role with `attest` entries; cross-member
corroboration when two members capture one URL; `owner-transfer`; an Elasticsearch export sink;
at-rest encryption, which a hosted relay holding ciphertext would require.

## Testing

- Verify-core: known-answer fixtures under `tests/shared/` for every outcome named
  above, plus the existing single-chain suite unchanged.
- Sync: `MemoryTransport` pairs and triples exercising join, first sync, incremental sync,
  revocation mid-session, forged entry, hash mismatch on a blob, transitive rows.
- Migration: schema 33 to 34 fixtures with existing Exhibits keep bare citations.
- Iroh: one smoke test behind an environment flag that dials loopback, skipped in CI on
  platforms without a binding.
- E2E: two app instances with separate user-data directories joined over `MemoryTransport`
  through a test-only IPC hook; a real-network E2E is manual.

## Open questions

1. Where Iroh persists its node key. It must survive restarts so `nodeId` in `member-add`
   stays valid; if the binding regenerates it, `member-add` needs a rotation path.
2. Whether an `exclude` entry should change the verifier's pass outcome or only annotate.
   Proposed: annotate.
3. Relay hosting for testers who cannot reach n0's relays; a self-hosted `iroh-relay` is one
   binary, and whether the project runs one is a maintainer decision.
