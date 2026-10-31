# Plan: invite, join and roster writers (#1810)

**Status:** done, finished by [#1913](https://github.com/thebristolsound/birdbrain/pull/1913)

The maintainer approved this plan on 2026-10-17 and took the recommended answer to every question
in section 11; the PR that closes #1810 builds it. Issue #1810 is SC-6 in
`docs/plans/2026-10-10-three-programme-agent-briefs.md:309`. This plan was written against
`origin/main` at 58997988 (PR #1872 merged), and every `file:line` citation refers to that
commit. Each citation also names its symbol, which survives later edits. This plan cites two
unmerged branches by commit. #1811's draft PR #1879 is `feat/1811-received-entries` at 36ecaf34,
which carries the same changes as `feat/1811-apply-received-entries`, cut from an older base.
SC-V is draft PR #1880 on `feat/1864-member-chains` at 713099a2.

## 1. Summary

The app has no writer for `member-add`, `member-revoke`, or `exclude`, and nothing makes a Case
shared: no code under `src/` sets `cases.shared_at`, and the sync tests build every roster by
hand (`appendOwnChainLine`, `tests/helpers/syncPeers.ts:157-173`). This plan builds both sides of
the design's "Invite and join" (`docs/specs/2026-09-19-collaborative-cases-design.md:160-177`):

- **The invite string.** A base32 encoder and decoder written in the app against the RFC 4648
  test vectors, and `bbinvite1` followed by base32 of a CBOR map: the Owner's transport ticket as
  an opaque string, the `caseId`, the Owner's Operator name, a 16-byte one-time secret, and an
  expiry 24 hours out.
- **Three writers, Owner only.** `member-add`, `member-revoke`, and `exclude`, through
  `withManifestEntry`. The first invite for a Case writes the Owner's own `member-add` and sets
  `shared_at` and `owner_installation_id`. Every roster write rebuilds `case_members` and
  `members.json` from the Owner's chain.
- **The handshake.** `join`, `join-pending`, `welcome`, and `join-refused` messages in the sync
  session's existing frame format, an in-memory invite registry, and a router that hands each
  incoming stream to the join handler or to `serveSyncSession` by its first message. It runs over
  `MemoryTransport` in the tests and never parses the ticket.
- **A sharing service and its IPC.** The service holds the transport, runs Sync now, and reads
  the member list. The nine channels the issue lists, two events, and one named error code for
  each refusal.
- **The design amendment.** The "Invite and join" paragraph names the ticket's contents as the
  node id and relay URL, never a direct address (ruling 74).

Every entry this plan writes is stamped 4 or lower, which the 1.0.1-beta.22 verifier reads, and
`MANIFEST_SCHEMA_VERSION` stays 5. New `exhibit` entries do not carry `memberCode` (question 3).
SC-6 does not render the QR code; SC-8 does (question 2). No schema migration is needed.

Two findings change what the issue's acceptance criteria can promise. Straight after an
approval, the Owner's replica fails the Shared Case walk with `member-chain-missing`, because
the new member has no chain yet (gap 1, question 1). The session's roster rebuild reads the whole
Owner chain, so on a fork that is shared again it would add the source Case's members (gap 2,
question 8).

## 2. What exists, and two gaps

### What #1873 left

- **Transport.** `Transport`, `MemoryHub`, and `MemoryTransport`
  (`src/main/services/sharing/transport.ts:24-34`, `:110-147`, `:173-236`). `listen` takes one
  stream handler per transport, and a `Connection` exposes `peerNodeId` (`:19-22`).
- **Session.** `serveSyncSession` reads `hello` as its first message
  (`src/main/services/sharing/session.ts:304-373`, `:312`), and `pullFromPeer` runs the pull
  (`:376-754`). Neither has a production caller; the comment on `SHARING_GET_SYNC_STATE` says so
  (`src/shared/ipc.ts:223-225`).
- **Roster cache.** `rebuildRosterFromOwnerChain` (`session.ts:260-292`) adds a member for each
  `member-add` and records each `member-revoke`. `pullFromPeer` runs it only when this
  installation is not the Owner (`:403-412`); on the Owner the roster is "the one its own
  membership writes keep", and none exist yet.
- **Database.** `case_members`, `cases.shared_at`, and `cases.owner_installation_id`, all from
  migration 36 (`src/main/services/db/migrations.ts:921-935`, `:993-998`). `upsertCaseMember` and
  `memberCodeProblem` (`src/main/services/db/caseMemberRepo.ts:78-108`, `:62-76`).
  `writeMembersFile` (`src/main/services/sharing/syncState.ts:222-250`).
- **IPC.** `sharing:getSyncState` is the only sharing channel (`src/shared/ipc.ts:226`, `:1006`;
  `src/main/ipcHandlers.ts:1105-1106`; `src/preload/index.ts:210-212`).
- **The verifier's roster rules** (`buildRoster`, `src/shared/verify/sharedCase.ts:272-364`).
  Every writer here holds them at write time:
  - the first `member-add` names the Owner, with the key the Owner's chain verifies under;
  - no installation, key, or Member Code appears twice on the roster, revoked or not;
  - a `member-revoke` names a member on the roster, not yet revoked, and not the Owner;
  - an `exclude` names an author on the roster, and that author's accepted chain holds the
    Exhibit (`:750-769`);
  - a membership entry in any chain but the Owner's is `roster-invalid` (`:651-662`).

### Gap 1: a new member has no chain

`verifySharedCase` reports `member-chain-missing` for every non-revoked roster member whose chain
is not supplied (`sharedCase.ts:683-693`; pinned by
`tests/shared/verify/manifestSchema4.test.ts:757`). A joiner's Case is new, so its chain is empty
until its first session writes a `merge`. The Owner holds no file for it until the Owner next
pulls from the joiner. Between the approval and that pull, the Owner's
`readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir)).verification` reports
`valid: false`, and an export in that window fails the walk. The issue's criterion that the walk
passes "after every roster write" fails at the first approval.

`verifyManifestChainText` reads an empty chain as valid with no entries: its loops, from
`src/shared/verify/manifestChain.ts:254`, run zero times. This plan therefore keeps a chain file,
empty until entries arrive, for every non-revoked member other than this installation, on every
replica that holds the Owner's chain (step 4). Question 1 asks for that choice.

### Gap 2: the roster rebuild reads history

`rebuildRosterFromOwnerChain` takes every `member-add` in the stored Owner chain. The verifier
reads the roster only from the chain's last `import` on (`currentSegment`,
`sharedCase.ts:247-250`, used at `:479`). A fork continues its source Owner's chain behind an
`import` (`sharedCase.ts:27-32`). When the forking member shares the fork, the rebuild on every
member's replica would add the source Case's members to the new roster. A source Member Code
equal to a new one would make `upsertCaseMember` throw, which fails every session. Nothing reaches
this path until SC-6 lets a fork be shared. Step 4 reads the current segment only.

## 3. Steps

Steps 1 and 2 have no dependencies. Step 3 comes before steps 4 and 5. Step 6 needs step 2,
step 7 needs steps 4 to 6, step 8 needs step 7, step 9 needs step 8, and step 10 comes last.

The tests use the two-peer harness in `tests/helpers/syncPeers.ts` with invented names and
content. One peer is active at a time (`activate`, `:74-84`). The handshake tests therefore run
the Owner's side on the active peer, and the joiner's network side with a signer built from the
joiner's private key, the way `recordSource` signs (`:413`). The joiner's local writes run after
`activate(joiner)`.

### Step 1. Base32 written in the app

Create `src/main/services/sharing/base32.ts` with `encodeBase32(bytes, { padding })` and
`decodeBase32(text, { padding })`. It adds no dependency (ruling 11).

- The alphabet is RFC 4648 section 6 (`A` to `Z`, then `2` to `7`), not the section 7 "base32hex"
  alphabet.
- The decoder accepts upper and lower case. It refuses any other character, padding in the wrong
  place, a length that no byte count produces, and nonzero bits after the last whole byte, so one
  byte string has exactly one spelling.

Tests in `tests/main/services/sharing/base32.test.ts`:

- The seven vectors of RFC 4648 section 10, encoded and decoded, with padding:

  | Input | Base32 |
  |---|---|
  | `""` | `""` |
  | `"f"` | `"MY======"` |
  | `"fo"` | `"MZXQ===="` |
  | `"foo"` | `"MZXW6==="` |
  | `"foob"` | `"MZXW6YQ="` |
  | `"fooba"` | `"MZXW6YTB"` |
  | `"foobar"` | `"MZXW6YTBOI======"` |

- The same vectors round-trip without padding, and in lower case.
- Each refusal in the list above throws.

### Step 2. The invite string

Create `src/main/services/sharing/invite.ts`.

- `encodeInvite(fields)` returns `bbinvite1` followed by lower-case base32 without padding of the
  `cborg` encoding of `{ ticket, caseId, operatorName, secret, expiresAt }`. `ticket` is the
  string `Transport.ticket` returns (`transport.ts:26-28`), and no code reads inside it. `secret`
  is 16 bytes, and `expiresAt` is an ISO 8601 UTC string.
- `decodeInvite(text)` trims surrounding whitespace, accepts the prefix in either case, decodes
  the base32 and the CBOR, and parses the result against a strict Zod schema with a length bound
  on every string, the way `decodeMessage` treats a frame
  (`src/main/services/sharing/messages.ts:162-175`). Any failure throws
  `SharingError('invite-malformed')`.
- An upper-case copy of an invite decodes to the same fields. SC-8 can then draw the QR code
  from the upper-case form, which QR alphanumeric mode encodes in fewer modules.

A relay-only ticket was 122 characters in the spike
(`docs/specs/2026-10-10-anonymous-team-sync-spike.md`, "Results"), so an invite runs to about
440 characters.

Tests in `tests/main/services/sharing/invite.test.ts`: a round trip; the upper-case form;
surrounding whitespace and a line break; and, each refused as `invite-malformed`, a wrong prefix,
a truncated string, a CBOR map with an extra key, and a 15-byte secret.

### Step 3. Writer types and stamps

In `src/main/services/manifest.ts`:

- `ManifestEntryInput` (`:583-797`) gains `member-add`, `member-revoke`, and `exclude`, field for
  field as `ManifestMemberAddEntrySchema`, `ManifestMemberRevokeEntrySchema`, and
  `ManifestExcludeEntrySchema` (`src/shared/schemas.ts:881-901`, `:905-920`, `:958-975`). The
  `exhibit` variant (`:720-741`) gains `memberCode?: string`.
- `MIN_READER_SCHEMA_VERSION` (`:837-853`) gains `'member-add': 4`, `'member-revoke': 4`, and
  `exclude: 4`. Its `Record` type makes a missing value a compile error.
- `fieldMinReaderSchemaVersion` (`:874-881`) returns 4 for an `exhibit` that carries
  `memberCode`, beside its two `capture` rules. The schema refuses `memberCode` on an entry
  stamped below 4 (`schemas.ts:776-781`).
- `ensureMemberChainFile(caseDir, installationId)` creates an empty
  `manifest.<installationId>.jsonl` when none exists, through `assertChainInstallationId`
  (`:251-256`). `appendMemberChainLines` returns early on zero lines (`:267`), so it cannot.

`src/shared/schemas.ts`, `src/shared/verify/`, and `src/shared/constants.ts` do not change.

The 1.0.1-beta.22 tag sets `MANIFEST_SCHEMA_VERSION` to 4, and its three roster schemas and its
`exhibit` schema match 58997988 line for line (`git show v1.0.1-beta.22:src/shared/schemas.ts`).
A stamp of 4 is therefore one that verifier reads.

Tests:

- `tests/shared/verify/manifestSchema3.test.ts:460` pins `v4Types` to `merge` alone. Add the
  three types.
- In `tests/main/services/sharing/membership.test.ts`, append each new type through the writers
  of step 5 and pin `schemaVersion` 4 on the written line. Pin an `exhibit` with `memberCode` at 4
  and one without at 3. Every written line parses with `ManifestEntrySchema`.
- The pin is "at most 4" for each type this plan adds, not `MANIFEST_SCHEMA_VERSION === 5`, so
  CE-P step 1's planned bump does not break it.

### Step 4. One roster cache rebuild, from the current segment

Move `rebuildRosterFromOwnerChain` out of `session.ts` (`:260-292`) into a new
`src/main/services/sharing/rosterCache.ts` as
`rebuildRosterCache({ caseId, caseDir, ownerEntries, self })`.

- It reads only the entries at or after the chain's last `import`, as `currentSegment` does.
- It keeps today's rules otherwise: it refuses an id that cannot name a chain file, adds a member
  once, and records a revocation once.
- After its database writes commit, it calls `ensureMemberChainFile` for every non-revoked member
  other than `self` (gap 1), then `writeMembersFile`. The files come after the commit, so a
  rolled-back `member-add` never leaves a chain file for an installation the roster does not
  name, which the walk would report as `unknown-member`.
- `pullFromPeer`'s `rebuildRoster` (`session.ts:403-412`) calls it with the stored Owner chain.
  The session changes in two ways only: the current segment, and the empty files.

Tests:

- A fork made the way the test `forks a non-Owner replica into a Case that continues the Owner
  chain and verifies` makes one (`tests/main/services/sharedCaseExport.test.ts:663`), then shared
  through step 5. `case_members` holds only the new roster, on the Owner and, after a session, on
  a member, and the walk passes on both.
- After an approval, the Owner's walk passes with an empty file for the joiner.
- A member replica that learns of a third member in a session holds an empty file for it, and its
  walk passes.
- A Case holding an empty member chain exports a package that passes `verifyEvidencePackage`, and
  a Case Archive of it imports. Once SC-V has merged, `runVerifyScript` passes it too: SC-V's
  `check_chain` returns success on a chain file with no lines (`src/main/services/verifyScript.ts`
  at 713099a2).
- The existing roster tests in `tests/main/services/sharing/syncPeers.test.ts` pass unchanged.

### Step 5. The roster writers

Create `src/main/services/sharing/membership.ts`. Each function runs on the active installation
and refuses with a `SharingError` before it writes anything.

**Guards shared by every writer**

- **Operator name.** An empty trimmed Operator name refuses `operator-name-required`, as the
  ingest gate does (`trimmedOperatorName`, `src/main/services/captureLifecycle.ts:721-725`).
- **Owner.** `assertOwner` requires `cases.shared_at` set, `cases.owner_installation_id` equal
  to this installation, and the own chain's current segment opening its roster with this
  installation's `member-add` as `owner`. A member's installation refuses `not-owner`, and a Case
  nobody shared refuses `not-shared`.
- **Fresh cache.** Before every write, the writer rebuilds the cache from the own chain (step 4),
  so a stale cache cannot lead to an entry the verifier refuses.
- **Rollback.** Each append goes through `withManifestEntry` (`manifest.ts:954-968`) with the
  database writes in its callback inside `withTransaction`. A failed database write rolls the
  entry back, as the Staging Pool commit does (`src/main/services/staging.ts:219-236`).

**`shareCase(caseId, { ownerMemberCode, nodeId })`**, run by the first invite:

- When the current segment already holds the Owner's `member-add`, it appends nothing. If
  `shared_at` is NULL there (a crash between the append and the row write), it sets it and
  rebuilds the cache.
- Otherwise it appends the Owner's `member-add`: this installation's id, `getPublicKeyPem()`,
  the Member Code, the Operator name, `nodeId` from the transport, and `role: 'owner'`. In the
  same callback, a new `markCaseShared(caseId, installationId)` in
  `src/main/services/db/caseRepo.ts` sets `shared_at` to now and `owner_installation_id`, where
  `shared_at IS NULL`.
- The Owner's Member Code is `ownerMemberCode` when given, else `suggestMemberCode`. A code that
  `memberCodeProblem` refuses throws `member-code-rejected`.

**`suggestMemberCode(operatorName, taken)`** goes in a new `src/shared/memberCode.ts`, so SC-8's
Member Code field can show the same default (decision 8, `collaborative-cases-design.md:52`). It
takes the first letter of each of up to three words, removes accents, upper-cases the result, and
keeps `[A-Z0-9]`. If that leaves nothing, or the code is taken, it tries `M`, then `M2` to `M9`.
Tests cover a plain name, an accented name, a name with no Latin letter, and a taken code.

**`addMember(caseId, joiner)`**, called only by approval (step 7):

- It refuses `already-member` when the installation or its key is on the roster, including as a
  revoked member. The verifier does not define a second `member-add` for one installation
  (`sharedCase.ts:308-316`).
- It refuses `member-code-rejected` from `memberCodeProblem`.
- It appends `member-add` with `role: 'member'` and the `nodeId` the Owner's transport reported
  for the join stream.

**`revokeMember(caseId, installationId)`** refuses `not-a-member`, `already-revoked`, and
`owner-not-revocable`, then appends `member-revoke`. The listener re-reads the roster before every
request (`session.ts:337-340`), so a session with that member ends at its next request.

**`excludeExhibit(caseId, exhibitId, reason?)`** finds the author the way step 5 of the walk
does. It reads `readSharedCaseSnapshot(...).verification.entries`, the accepted entries by chain,
and takes the one chain that holds an `exhibit` with that `exhibitId` or a `capture` with that
`captureId`.

- None refuses `exhibit-not-found`, two refuse `exhibit-ambiguous`, and an `exclude` already in
  the own chain for the same Exhibit refuses `already-excluded`.
- It appends `exclude` with `authorInstallationId`, and `reason` when given.
- A revoked author's entries past the Owner's last `merge` before the revocation are not accepted
  entries, so they cannot be excluded. Nor can an Exhibit that only a chain failing verification
  holds: the walk skips its check for such a chain (`sharedCase.ts:753-755`), so it could not
  judge the exclusion.
- It needs no Exhibit row, so it works before #1811 writes rows for received Exhibits.

Tests in `tests/main/services/sharing/membership.test.ts`:

- `shareCase` appends one `member-add` with role `owner`, and sets `shared_at` and
  `owner_installation_id`. A second call appends nothing. `case_members` equals the roster read
  from the chain, `members.json` lists it, and the walk passes.
- `addMember` appends one entry. It refuses a taken code, a malformed code, a revoked
  installation, and a key already on the roster, and each refusal leaves the manifest bytes
  unchanged.
- `revokeMember` and its three refusals.
- `excludeExhibit` of a received Capture after a session, and of the Owner's own Exhibit. Its
  refusals. The walk passes and lists the exclusion.
- On a member's installation after a join and a first session, `revokeMember` and
  `excludeExhibit` refuse `not-owner`. The member's manifest bytes, `case_members`, and Case
  directory listing are unchanged.
- After every write, `listCaseMembers` matches `verification.members`, and the walk reports
  `valid: true` and outcome `pass`.
- The `memberCode` statement (question 3): after `shareCase`, a Staging Pool commit writes an
  `exhibit` entry with no `memberCode`, stamped 3, and the walk cites it as
  `<Owner's code>-<number>`.

### Step 6. The invite registry

Create `src/main/services/sharing/inviteRegistry.ts`, held in memory, one per process
(question 5).

- `open(caseId)` draws 16 random bytes and sets `expiresAt` to now plus 24 hours. It stores the
  SHA-256 of the secret with `{ inviteId, caseId, expiresAt, state: 'open' }` and returns the
  secret and the id. The registry never stores the secret itself.
- `claim(caseId, secret, now)` checks, in this order: a secret it never issued, or one for another
  Case, refuses `invite-unknown`; a cancelled one `invite-cancelled`; a used one
  `invite-reused`; and one at or past `expiresAt` `invite-expired`. Otherwise it marks the
  invite used.
- `cancel(caseId, inviteId)` refuses `invite-not-found` for an id it does not hold. A join already
  pending from that invite stays pending until the Owner approves or declines it.
- A used, cancelled, or expired record stays until the process exits, so a late join gets the
  named error and not `invite-unknown`.

A join claims the invite only once its signature has verified (step 7), so a join relayed through
another node does not use up the invite.

Tests with fake timers: one millisecond before and at the 24-hour mark; cancelled; reused;
unknown; and a secret of another Case.

### Step 7. The join handshake

**Messages.** `SyncMessageSchema` (`messages.ts:142-153`) gains four members, each `.strict()`
with a length bound on every string:

- `join`: `caseId`, `secret` (16 bytes), `installationId` (the existing `installationIdField`),
  `publicKeyPem`, `operatorName`, `ticket` (the joiner's own, question 4) and `signature`.
- `join-pending`: no fields.
- `welcome`: `caseId`, `caseName`, `ownerPublicKeyPem`, `roster` (one object per `case_members`
  row) and `tickets` (question 4).
- `join-refused`: `reason`, one of the refusal codes in section 4.

**The join signature.** `joinDigest(caseId, secret, ownerNodeId, signer)` is the SHA-256 hex of
`canonicalStringify({ purpose: 'birdbrain-invite-join', caseId, secret, ownerNodeId, signer })`,
with the secret as hex, signed with `signEntryHash` (`src/main/services/signingKey.ts:245-248`).
This is the design's `secret || ownerNodeId`, built the way `helloDigest` binds the hello proof
to a purpose, the Case and the signer (`session.ts:155-163`). A join signature therefore never
passes as a hello proof or an entry signature.

**Owner side.** `serveJoin(stream, peerNodeId, deps)` in
`src/main/services/sharing/joinHandshake.ts`:

1. It reads `join`.
2. It verifies the signature over `joinDigest(join.caseId, join.secret, transport.nodeId,
   join.installationId)` with `join.publicKeyPem` (`verifyEntrySignature`,
   `src/shared/verify/signature.ts:8-18`). On failure it sends `join-refused` with
   `join-signature-invalid` and leaves the invite open.
3. It sends `join-refused` with `already-member` for an installation or key on the roster,
   before the claim, so an existing member's mistaken join does not use up the invite.
4. It claims the invite (step 6) and sends any refusal as `join-refused`.
5. It records a pending join: request id, Case, installation, key, fingerprint, Operator name,
   `nodeId` (the listener's `peerNodeId`), ticket, and the suggested Member Code. It sends
   `join-pending` and emits `event:sharingChanged`.
6. It waits for approval, a decline, or the stream to close. The pending join leaves memory on any
   of the three.
7. On approval it calls `addMember` with the Member Code the Owner entered, sends `welcome` and
   closes the stream. On a decline it sends `join-refused` with `declined` and writes nothing.

Approval checks that the stream is still open before it writes. The fingerprint is the SHA-256 of
the DER public key from `fingerprintPem` (`src/main/services/exhibits.ts:136-143`), exported for
this. The design's display form, the first 32 hex characters in groups of four, is SC-8's.

**Joiner side.** `requestJoin({ transport, invite, identity, onStep })` writes nothing:

1. It decodes the invite. A past `expiresAt` refuses `invite-expired` before any dial; the
   Owner's clock still decides for any join that reaches it.
2. It dials `invite.ticket`. `PeerUnreachableError` (`transport.ts:36-41`) becomes
   `owner-unreachable`.
3. It sends `join`, signed over `connection.peerNodeId`: the node the transport reached, not a
   node id read out of the ticket.
4. On `join-pending` it reports the waiting step; on `join-refused` it throws that code; on
   `welcome` it checks four things and refuses `welcome-invalid` if any fails:
   - the `caseId` is the invite's;
   - the roster names exactly one `owner`, whose key is `ownerPublicKeyPem`;
   - the roster names this installation, with this key, as a `member`;
   - every Member Code matches `MEMBER_CODE_PATTERN` (`schemas.ts:414`).

**`adoptWelcome(welcome)`**, with the joiner active:

- It refuses `case-exists` when a Case with that id exists. `sharing:join` also checks this before
  it dials, which covers an Owner pasting its own invite.
- In one transaction, a new `createJoinedCase({ id, name, sharedAt, ownerInstallationId })` in
  `caseRepo.ts` writes the Case row, and `upsertCaseMember` writes each roster row. `createCase`
  always makes a new id (`caseRepo.ts:40-49`), so it cannot be reused.
- It creates the Case directory and `manifest.jsonl` (`initManifest`), writes `members.json`, and
  stores the tickets.
- It creates no member chain file. Until the first session stores the Owner's chain, an empty
  file would read as `unknown-member`: `verifySharedCaseReplica` finds no Owner claim and walks
  the empty local chain as the Owner (`sharedCase.ts:943-944`).

Tests in `tests/main/services/sharing/joinHandshake.test.ts`, on one `MemoryHub` with the Owner's
node listening through the router of step 8:

- **Approval.** One `member-add` with the entered code, whose `nodeId` is the joiner's node. The
  joiner receives the `welcome`. After `activate(joiner)` and `adoptWelcome`, the Case exists
  under the Owner's id with the Case name and roster from the `welcome`. After the first session,
  the joiner holds the Owner's chain and its own `merge`, and its walk passes. The Owner's walk
  passes before and after the Owner pulls from the joiner.
- **Rejected code.** A code that `memberCodeProblem` refuses throws `member-code-rejected`,
  appends nothing, and leaves the join pending.
- **Decline.** A snapshot taken before the join equals one taken after it. On the Owner it holds
  the manifest bytes, the `cases` row, `case_members`, and the Case directory listing with each
  file's hash. On the joiner it holds the Case list and the storage root listing.
- **Invite refusals.** A reused invite, an expired one (fake timers past 24 hours), and a
  cancelled one each come back as `join-refused` with that code, and `requestJoin` throws a
  `SharingError` with it.
- **Wrong node.** A join signed over another node id is refused `join-signature-invalid`. The
  invite stays open, and a correct join then succeeds.
- **Bad welcome.** A test listener sends a crafted `welcome` failing each of the four checks, and
  each is refused `welcome-invalid` with nothing written.

### Step 8. The sharing service

Create `src/main/services/sharing/sharingService.ts`. `registerIpcHandlers` creates one instance.

- **Transport seam.** `setTransportProvider(() => Promise<Transport | null>)`. The default
  returns null, so every call that needs the network refuses `sharing-unavailable` until
  `IrohTransport` is wired in (section 8). The first time a provider returns a transport, the
  service calls `listen(routeIncomingStream)` on it, once.
- **Router.** `routeIncomingStream(stream, peerNodeId)` reads the first frame through a
  `MessageReader` over a wrapper that records the chunks it reads. It then hands the handler a
  stream that replays those chunks before reading on. `join` goes to `serveJoin`, `hello` goes to
  `serveSyncSession(replayed, liveSyncSource)`, and anything else closes the stream.
  `serveSyncSession` does not change.
- **Commands.** `createInvite`, `cancelInvite`, `joinCase`, `approveJoin`, `declineJoin`,
  `revoke`, and `excludeExhibit` compose steps 5 to 7. `joinCase` returns after `adoptWelcome`.
  It then starts the first session on a new stream of the join connection, as the design's step 4
  asks (`collaborative-cases-design.md:172-174`). That session reports through `beginSession` and
  `finishSession` (`syncState.ts:153-195`) like any other.
- **Sync now.** `syncNow(caseId)` runs one `pullFromPeer` for each non-revoked member other than
  this installation whose ticket it knows (question 4), one after another. A second call while one
  runs returns the running result. An unreachable member is reported, not thrown.
- **Member list.** `getMembers(caseId)` returns the roster with each member's fingerprint, this
  installation's id and whether it is the Owner, the open invites (id and expiry, never the
  secret), and the pending joins (request id, Operator name, fingerprint, suggested code).
- **After #1811.** PR #1879 makes `SyncSessionOptions.receivedCaptures` required (`session.ts` at
  36ecaf34). The service passes the app's `CaptureLifecycle`, which `registerIpcHandlers` already
  receives (`ipcHandlers.ts:192-201`).

Tests in `tests/main/services/sharing/sharingService.test.ts`:

- The router completes a session for a `hello` stream against a recorded source, reaches
  `serveJoin` for a `join` stream, closes a stream whose first frame is another type, and does not
  throw on a stream that closes before its first frame.
- Sync now pulls from the Owner on a member, and from the member on the Owner. A member with no
  ticket is reported `no-address`, an unreachable one `unreachable`, and a revoked one is skipped.
- With the default provider, `createInvite`, `joinCase`, and `syncNow` refuse
  `sharing-unavailable` and write nothing.

### Step 9. IPC

| Channel | Arguments | Result |
|---|---|---|
| `sharing:createInvite` | `caseId`, optional `ownerMemberCode` (first invite only) | invite id, invite string, `expiresAt` |
| `sharing:cancelInvite` | `caseId`, `inviteId` | nothing |
| `sharing:join` | invite string | `caseId`, Case name |
| `sharing:approveJoin` | `caseId`, `requestId`, `memberCode` | the new `CaseMember` |
| `sharing:declineJoin` | `caseId`, `requestId` | nothing |
| `sharing:revoke` | `caseId`, `installationId` | the revoked `CaseMember` |
| `sharing:excludeExhibit` | `caseId`, `exhibitId`, optional `reason` | the exclusion as the walk lists it |
| `sharing:syncNow` | `caseId` | one outcome for each member |
| `sharing:getMembers` | `caseId` | the `getMembers` payload of step 8 |

- **Events.** `event:sharingChanged` (`{ caseId }`) fires on any invite, pending join, or roster
  change. `event:sharingJoinProgress` (`{ caseId, ownerName, step }`) fires with the steps
  `connecting`, `waiting`, `adopting`, and `syncing`. The design asks for progress and state
  events in the pattern `cases:exportArchive` uses (`collaborative-cases-design.md:291-292`), and
  the members feasibility assessment puts an event behind each step of the join branch (item 23).
- **Errors.** `SHARING_ERROR_CODES` goes in `src/shared/types.ts` beside `SYNC_ERROR_KINDS`
  (`:1508-1515`). Main throws `SharingError`, and each handler converts it to
  `IpcFailure(message, code)` (`src/main/ipcWrap.ts:35-43`), as the handler at
  `ipcHandlers.ts:357` converts `BatchCrossCaseError`.
- **Files.** `src/shared/ipc.ts` (channels, contract, events, and a rewrite of the comment at
  `:223-225`), `src/main/ipcHandlers.ts`, `src/preload/index.ts`, and `src/shared/types.ts`.

Tests: in `tests/main/ipcHandlers.test.ts`, beside `answers the sync state of a Case` (`:729`),
each channel's refusal code on a Case nobody shared, an empty `getMembers`, and a `SharingError`
arriving as `{ ok: false, code }`. `tests/preload/bridge.test.ts` already checks every channel in
`IPC_CHANNELS` against the bridge (`:92`).

### Step 10. Docs and comments

**The design amendment.** Replace the first sentence of "Invite and join"
(`collaborative-cases-design.md:162-164`) with:

> The invite string is `bbinvite1` followed by base32 without padding (RFC 4648, section 6
> alphabet) of a CBOR map: the Owner's transport ticket, which names the Owner's node id and relay
> URL and never a direct address, `caseId`, Owner `operatorName`, a 16-byte one-time secret, and an
> expiry timestamp. Ruling 74 of 2026-10-10 removed the direct addresses: a ticket built from the
> endpoint's own address list gives every interface address to anyone who reads the string
> ([anonymous-team sync spike](2026-10-10-anonymous-team-sync-spike.md)).

In step 2 of the same section, the signature sentence gains a clause after
`secret || ownerNodeId`: "taken over a SHA-256 digest that also binds a purpose string, the
`caseId`, and the joiner's `installationId`, as the sync `hello` proof is." If question 4 keeps
tickets, the same step adds "and its own ticket" to what `join` carries.

**The evidence-path list.** In the "Shared Case sync" table of
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` (`:316-329`):

- `membership.ts`, `rosterCache.ts`, and `joinHandshake.ts` go on the blocking tier. They write
  signed roster entries, decide which installation and key become a member, and write the roster
  that a joiner's first session trusts.
- `base32.ts`, `invite.ts`, `inviteRegistry.ts`, and `sharingService.ts` go on the advisory
  tier.
  They parse or hold invites and route streams, and none of them decides what a session stores.
- The text at `:65-66` and the exclusion row at `:375` say `IrohTransport` arrives with #1810. It
  arrives with #1809; correct both while editing the table.

**Comments.** Rewrite the comment at `tests/helpers/syncPeers.ts:157-160`, which says the app has
no writer for the membership entries until the invite flow lands. The helper stays for entries no
honest writer produces. `transport.ts:5` makes the same #1809 and #1810 slip; SC-5 edits that
file, so the plan leaves it to SC-5.

Check the changed docs with `.claude/hooks/vale-prose.sh --base origin/main`.

## 4. Named errors

Each code is a member of `SHARING_ERROR_CODES` and reaches the renderer as `IpcFailure.code`.

| Code | Raised on | When |
|---|---|---|
| `invite-malformed` | joiner | The string is not a `bbinvite1` invite this build reads |
| `invite-expired` | joiner, Owner | Past `expiresAt` |
| `invite-reused` | Owner | A join already claimed the invite |
| `invite-cancelled` | Owner | The Owner cancelled the invite |
| `invite-unknown` | Owner | The Owner never issued the secret, issued it for another Case, or issued it before a restart |
| `invite-not-found` | Owner | `cancelInvite` names an invite the Owner does not hold |
| `join-signature-invalid` | Owner | The join signature does not verify over this Owner's node id |
| `join-request-unknown` | Owner | Approve or decline names no pending join, or the joiner left |
| `declined` | joiner | The Owner declined |
| `already-member` | Owner | The installation or its key is on the roster, revoked members included |
| `member-code-rejected` | Owner | `memberCodeProblem` refuses the code |
| `welcome-invalid` | joiner | The `welcome` fails one of the four checks of step 7 |
| `case-exists` | joiner | A Case with the invite's id exists on this installation |
| `owner-unreachable` | joiner | The dial to the invite's ticket fails |
| `not-owner` | any | A roster write or an invite on an installation that is not the Owner |
| `not-shared` | any | A revoke, exclusion, or Sync now on a Case nobody shared |
| `not-a-member` | Owner | `revoke` names an installation the roster does not hold |
| `already-revoked` | Owner | `revoke` names a revoked member |
| `owner-not-revocable` | Owner | `revoke` names the Owner |
| `exhibit-not-found` | Owner | No accepted entry holds the Exhibit |
| `exhibit-ambiguous` | Owner | Two chains' accepted entries hold the Exhibit id |
| `already-excluded` | Owner | The own chain already excludes the Exhibit |
| `operator-name-required` | any | The Operator name is empty |
| `sharing-unavailable` | any | No transport is wired in |

## 5. The entries SC-6 writes

| Entry | Writer | Stamp | beta.22 reads it |
|---|---|---|---|
| The Owner's own `member-add` (`role: 'owner'`) | `shareCase`, first invite | 4 | Yes |
| `member-add` (`role: 'member'`) | `addMember`, approval | 4 | Yes |
| `member-revoke` | `revokeMember` | 4 | Yes |
| `exclude` | `excludeExhibit` | 4 | Yes |
| `merge` | the joiner's first session, and Sync now (existing writer) | 4 | Yes |
| `exhibit` without `memberCode` (unchanged Staging Pool commit) | `staging.ts:219-236` | 3 | Yes |
| `exhibit` with `memberCode` | no writer; a test pins the stamp rule | 4 | Yes |

**The `memberCode` statement for the PR body:** new `exhibit` entries do not carry `memberCode`.
A citation takes the code from the writer's `member-add`, as the design defines an absent code
(`collaborative-cases-design.md`, "Manifest entries") and as the walk resolves it
(`sharedCase.ts:717-736`). A `capture` entry has no `memberCode` field at all
(`schemas.ts:455-516`), so the rule matches for Captures and other Exhibits.

## 6. Evidence impact

1. **Investigation need, baseline, and threat.** An Owner brings a teammate into a Case. Threats:
   someone else uses a stolen invite; a join is relayed through another node; a member writes
   membership entries; a joiner is handed the wrong roster.
2. **Supported claim.** Unchanged from the design's Evidence impact item 2. The Owner's chain now
   records each membership change and each exclusion as a signed entry. The join signature shows
   that the joiner held the key it offered and addressed this Owner's node. It does not show who
   sat at the joiner's machine.
3. **Evidence and custody effects.** The app writes `member-add`, `member-revoke`, and `exclude`
   for the first time. A Case gains `shared_at`, and a joiner's Case takes the Owner's `caseId`.
   No existing entry shape, and no written `exhibit` or `capture` entry, changes. Setting
   `shared_at` turns on #1873's Shared Case rules for that Case: Settings > Database refuses
   edits to its synced tables (`SHARED_CASE_BY_ID`, `src/main/services/db/dbAdmin.ts:83`),
   deleting a working-layer row writes a signed tombstone (`deleteLocalRow`,
   `src/main/services/sharing/workingRows.ts:113-123`), and each new row version is recorded in
   the Case's `sync-state.json` (`recordLocalVersion`, `syncState.ts:139-145`).
4. **Verification and failure behavior.** Every new entry stamps 4, which 1.0.1-beta.22 reads, so
   the manifest schema lane is not taken. The writers refuse every roster the walk would call
   `roster-invalid`, before writing. `verify.sh` checks member chains only once SC-V merges, which
   is why SC-6 merges after it. A refused, expired, cancelled, relayed, or declined join writes
   nothing on either installation. Straight after an approval the walk passes only with the empty
   chain files of question 1.
5. **What the joiner trusts.** The joiner adopts the Owner key that the node named in the invite
   presents. Iroh authenticates that node id; `MemoryTransport` authenticates nothing, so the
   tests prove the signature binding and not the transport's. Whoever controls the channel the
   invite travels on controls which node the joiner dials. `getMembers` returns every member's
   fingerprint, the Owner's included, so SC-8 can offer an out-of-band check.

## 7. Schema migration and lanes

None is needed, so SC-6 does not take the database migration lane.

- `case_members`, `cases.shared_at`, and `cases.owner_installation_id` exist since migration 36
  (`migrations.ts:903`, `:921-935`, `:993-998`); the schema is at 39 (`LATEST_SCHEMA_VERSION`,
  `src/main/services/db/core.ts:6`).
- Invites and pending joins are held in memory. Tickets, under question 4's recommendation, go in
  `sync-state.json`, which no release has shipped: 1.0.1-beta.23 (01a55021) predates
  `syncState.ts`.
- Exports read exclusions from the chains (`src/main/services/export.ts:138-146`), so no column is
  needed for them.

The manifest schema lane is not taken: every stamp is at most 4, and `MANIFEST_SCHEMA_VERSION` and
the schemas are unchanged. The Case Archive lane is not taken: the archive format is unchanged,
and `importCaseRow` already leaves `shared_at` out of an import (`caseRepo.ts:202`).

## 8. Order, hot files and the overlap with #1811

`git log origin/main` names pull requests, not issues, so issue state was read through the REST
API on 2026-10-16.

| Item | Rule | State | Effect on SC-6 |
|---|---|---|---|
| SC-2 (#1512) | SC-6 waits for it | Merged as PR #1873 (03b3eded) | Free |
| SC-V (#1864) | SC-6 merges after it | Draft PR #1880 on `feat/1864-member-chains` (713099a2) | SC-6 cannot merge first |
| SC-1 (#1713), `manifest.ts` | Before SC-6 | Merged as PR #1844 | Free |
| #1815, `manifest.ts` if it changes `withDeletionEntry` | Before SC-6 | PR #1876 open; it does not touch `manifest.ts` | Free |
| CE-P step 1, `manifest.ts` | Before SC-6 | Not filed | Question 9 |
| #1811 | No stated order | Draft PR #1879 | Overlap below |
| SC-5 (#1809) | Whichever merges second wires `IrohTransport` | Open, no branch | Below |

**The overlap with #1811.** PR #1879 changes `session.ts` in four places: it moves
`storedEntries` to `entryAcceptance.ts`, makes `SyncSessionOptions.receivedCaptures` required,
adds the `apply` phase and its result fields, and adds the apply step after the file loop. SC-6
changes `session.ts` in two places: it removes `rebuildRosterFromOwnerChain` in favor of
`rosterCache.ts`, and it changes the call in `rebuildRoster`. The import block conflicts, and the
removed function sits next to the removed `storedEntries`, so the merge is small and manual.
`tests/helpers/syncPeers.ts` also changes in both. SC-6 passes `receivedCaptures` wherever it
calls `pullFromPeer` once #1811 is in.

**Wiring `IrohTransport`.** If SC-5 merges first, SC-6's last step sets the transport provider to
build one `IrohTransport` when `sharing:isAvailable` reports true, listen with the router, and
close it on quit. If SC-6 merges first, it ships the seam with the null default, and SC-5's last
step sets the provider. Either way the transport starts on the first call that needs it
(`createInvite`, `join`, or `syncNow`), not at launch. SC-9 moves the start to launch and owns the
timer.

## 9. Whether the plan proceeds without approval

This plan waits for approval under ADR-0016. It is evidence-affecting (the issue carries the
label), and it trips three of ADR-0016's six criteria:

- **Criterion 2, the blocking tier.** It changes `manifest.ts`, `session.ts`,
  `src/main/services/db/caseRepo.ts`, and `exhibits.ts`, and adds three blocking-tier modules.
- **Criterion 5, design choices without precedent.** The invite format, the join messages, the
  invite lifetime, the ticket store, and the empty chain files are protocol and product decisions
  with no repo pattern. ADR-0015's must-ask list also names every decision on the blocking tier.
- **Criterion 6, at most 10 files.** About 28: eight new source files, ten changed source files,
  eight test files, and two docs.

Criterion 1 holds only while SC-6 adds no dependency; question 2's other option trips it.
Criteria 3 (no migration, no deletion) and 4 (reversible with git alone) hold. The PR gets human
review and does not auto-merge.

## 10. Risks

- **A lost welcome.** If the joiner leaves between approval's stream check and the `welcome`, the
  `member-add` stands and the joiner has no Case. The Owner can revoke it, but that installation
  can never be added again (`sharedCase.ts:308-316`).
- **The welcome roster is unsigned.** The joiner writes it to `case_members`, and the first
  session rebuilds from the Owner's chain. That rebuild adds and revokes but never removes a row,
  so a wrong row from a faulty `welcome` would stay.
- **The rollback window.** A failed cache write rolls a roster entry back. A session serving the
  chain inside that window could hand a peer a line that then disappears. Every
  `withManifestEntry` writer in a Shared Case has had this window since #1873, and roster writes
  are rare.
- **Empty chain files.** Under question 1, a replica states it holds an empty prefix of a
  member's chain. A stale prefix already verifies when no `merge` names a later head, so this adds
  no new blind spot, but it is a change in what a chain file means.
- **Invites end at a restart** under question 5, and a join after the restart fails with
  `invite-unknown`.
- **No transport in production** until SC-5 is wired, so the channels SC-6 ships refuse
  `sharing-unavailable` on their own. After a restart the Owner does not listen until a sharing
  call starts the transport; SC-9 fixes that.
- **Rows written before #1873 never sync** (question 7).
- **An Exhibit only in a failing chain cannot be excluded** (step 5).

## 11. Questions the maintainer answered

The maintainer answered each question on 2026-10-17 with the recommendation; the answer follows
each question.

1. **The new member's empty chain.** Straight after the Owner approves a joiner, the Owner's
   verification reports the Case as failing (`member-chain-missing`), because the joiner has
   written nothing yet. It stays failing until the Owner next syncs with the joiner, and an export
   made in between fails too. Should every replica keep an empty chain file for each member until
   that member's entries arrive (recommended)? The other options are to accept the failing window
   and drop "after every roster write" from the acceptance criterion, or to change the verifier
   to report a missing chain only when some `merge` names that member. The verifier change is on
   the blocking tier, and the 1.0.1-beta.22 and beta.23 verifiers would still report it.
   **Answer:** every replica keeps an empty chain file for each member until that member's
   entries arrive, so the Owner's walk passes straight after an approval.
2. **Who draws the QR code.** Should SC-8 draw it in the renderer with `qrcode-generator` 2.0.4
   (recommended), or SC-6 in the main process? SC-6 has no screen, so a main-process drawing has
   to cross IPC as an image. SC-8 can draw it in light and dark, which its done-when requires.
   SC-6 has no QR decoder to test one against, and taking the dependency here trips ADR-0016's
   criterion 1. The mock already makes the copyable string primary and the QR code secondary.
   **Answer:** SC-8 (#1514) draws the QR code in the renderer. SC-6 adds no QR dependency.
3. **Member Code on new `exhibit` entries.** Should new `exhibit` entries in a Shared Case leave
   `memberCode` out and take the code from the writer's `member-add` (recommended), or carry it?
   Leaving it out matches Captures, whose entries have no such field, keeps the Staging Pool
   commit unchanged at stamp 3, and avoids a code that disagrees with the roster, which the walk
   reports as a citation collision. Carrying it would let one chain state its citations without
   the Owner's chain, which the walk needs anyway for the keys.
   **Answer:** new `exhibit` entries do not carry `memberCode`; a test pins that.
4. **How Sync now finds a member.** The roster stores a member's node id, and the transport dials
   a ticket. Should SC-6 keep each member's last-known ticket, learned when the member joins and
   passed on in the `welcome`, in the Case's `sync-state.json` (recommended)? The alternative is a
   transport method that turns a node id into a ticket. For Iroh that means n0's address lookup,
   which publishes the relay URL to n0's DNS service from the Operator's own address. Under the
   recommendation, a member whose relay changes cannot be dialed until something refreshes its
   ticket, which SC-9 can add to the sessions it schedules.
   **Answer:** each member's last-known ticket is kept in the Case's `sync-state.json`, learned
   on join and passed on in `welcome`.
5. **Open invites across a restart.** Should an open invite end when the Owner's app quits
   (recommended for SC-6), or survive in a local file that stores only the hash of each secret?
   The design requires the Owner online when the joiner pastes (decision 5), and the members brief
   only promises the invite survives leaving the screen. Persisting adds a file whose loss or
   copy matters; it can follow if testers hit restarts.
   **Answer:** an open invite ends when the Owner's app quits, and a later join fails with a
   named error.
6. **Showing the Owner's name before joining.** The joiner's wizard shows the Operator name the
   invite carries before the joiner commits (members brief, "Join flow" step 2; feasibility item
   23), and none of the nine channels decodes an invite without joining. Should SC-6 add a tenth
   channel, `sharing:readInvite`, that decodes and returns the Case id, the Owner's name, and the
   expiry (recommended)? The alternatives are moving the decoder to `src/shared/` for the renderer,
   which puts `cborg` in the renderer bundle, or leaving it to SC-8.
   **Answer:** SC-6 adds a tenth channel, `sharing:readInvite`, that shows the Owner's name
   before the joiner commits.
7. **Notes and tags written before #1873.** A row written before #1873 has no signature and is
   never offered to peers (`rowsOfAuthorByTable`,
   `src/main/services/db/workingRowRepo.ts:344`), so sharing an older Case leaves its older notes,
   tags, and annotations on the Owner's machine. Should SC-6 sign them when the Case becomes shared,
   or should the SC-6 PR file a follow-up issue (recommended)? Signing touches every synced table
   and `workingRows.ts`, and it is separable from the invite flow.
   **Answer:** SC-6 does not sign them; the SC-6 PR files a follow-up issue and cites its number
   (ADR-0028: file first, then cite).
8. **The roster rebuild on a re-shared fork.** Should SC-6 move the session's roster rebuild into
   `rosterCache.ts` and make it read the Owner's chain from its last `import`, as the verifier does
   (recommended)? Without it, a fork shared again picks up the source Case's members, and a
   clashing Member Code fails every session (gap 2). SC-6 needs the same rebuild on the Owner, so
   the move costs one function.
   **Answer:** the roster rebuild moves out of `session.ts` into `rosterCache.ts` and reads only
   from the Owner chain's last `import`, as the verifier does.
9. **Merge order.** Should SC-6 start from `main` now, rebase once onto #1811, and merge after SC-V
   and #1811 (recommended)? The alternative is to wait for #1811 to merge before starting. SC-6
   cannot merge before SC-V either way, and the #1811 overlap is small. In `manifest.ts`, should
   SC-6 also merge ahead of CE-P step 1 (recommended), which is not filed yet? The rebase cost then
   falls on CE-P step 1, in `MIN_READER_SCHEMA_VERSION` and `fieldMinReaderSchemaVersion`.
   **Answer:** SC-6 builds from `main` now and merges after #1880 (SC-V) and #1879 (#1811); the
   orchestrator handles that rebase. In `manifest.ts` it merges ahead of CE-P step 1.

## 12. Verification

From the issue: `pnpm lint`, `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` (the new
sharing tests by path, then the full suite), `pnpm build`,
`.claude/hooks/vale-prose.sh --base origin/main`, then `pnpm preflight` at head.

```bash
pnpm lint
pnpm typecheck
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/base32.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/invite.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/membership.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/joinHandshake.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/sharingService.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/syncPeers.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test
pnpm build
.claude/hooks/vale-prose.sh --base origin/main
pnpm preflight
```

`pnpm test <path>` takes no `--` (`CLAUDE.md`, "Commands"). The export test in step 4 uses sharp;
on a Linux machine where sharp crashes under Electron, run it with `BIRDBRAIN_TEST_SYSTEM_SHARP=1`
(`docs/agents/testing.md`, "sharp under Electron on Linux").
