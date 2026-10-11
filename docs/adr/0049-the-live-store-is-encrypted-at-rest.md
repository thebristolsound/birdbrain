# The live store is encrypted at rest

**Status:** Accepted

**Date:** 2026-10-11

Reverses the round 1 map's scope decision (#284, amended 2026-07-31) that put encrypting the
live store out of scope, and decision 12 of the
[Shared Cases design](../specs/2026-09-19-collaborative-cases-design.md) ("At-rest encryption:
None added"). The design is
[`docs/specs/2026-10-11-live-store-encryption-design.md`](../specs/2026-10-11-live-store-encryption-design.md).
The maintainer accepted this record on 2026-10-11, with the five open questions in that spec
decided as it recommends. Nothing in it is implemented. Until the change that turns encryption
on ships, every public page keeps saying Birdbrain does not encrypt Cases at rest.

## Context

Birdbrain stores each Case in one SQLite database and a folder of files under the storage
root, all in plaintext. The only secrets it wraps at rest are the signing key and the OpenRouter
credential, through Electron `safeStorage`, and only when the operating system provides a
credential store. Five public pages say Birdbrain does not encrypt Cases at rest.

The round 1 map ruled live-store encryption out for three reasons: it fights independent
verification, a lost key destroys evidence, and full-disk encryption covers the stolen laptop.
Its revisit trigger was "any move toward a public (non-invited) release." The public beta is that
move. [ADR-0004](0004-adopt-osint-assurance-baseline.md) lists "encrypted storage and backup" among
the things Birdbrain must support.

Two facts weaken the map's reasons. The standalone verifier, `verify.sh`, `VERIFY.md`, and
`openssl ts -verify` read only exported packages, never the live store
([standalone verifier design](../specs/2026-06-01-standalone-verifier-design.md)). A recovery
code and documented formats keep a lost credential store from being fatal.

## Decision

### What is encrypted

- **The database.** Birdbrain moves from `better-sqlite3` to `better-sqlite3-multiple-ciphers`
  and writes the SQLCipher 4 format, keyed with a raw 256-bit key before any other statement on
  every connection. The WAL, pre-migration snapshots, and the Operator's database backup are
  ciphertext.
- **Every file under the storage root.** Captures, Extracted Text sidecars, thumbnails,
  Exhibits, the Staging Pool, the Manifest and every other chain, and Shared Case files. Each
  file is sealed with AES-256-GCM in 64 KiB segments. Each Manifest line is a separately sealed
  record, so the Manifest stays append-only.
- **Hashes stay over plaintext.** Content Hashes, `textHash`, Entry Hashes, signatures, and
  Timestamp Tokens are computed over the plaintext, exactly as before.

### Keys

- **One Data Key per installation**, 32 random bytes, separate from the signing key. HKDF
  derives a database key and a file key from it.
- **The operating system's credential store wraps the Data Key**, so the app opens without a
  prompt.
- **A recovery code is mandatory.** The app shows a 128-bit recovery code once, and the Operator
  types it back before encryption starts. scrypt and AES-256-GCM wrap a second copy of the Data
  Key under it. The app never stores the code.
- **No plaintext fallback.** On Linux with no credential store, the app asks for a passphrase at
  every launch and wraps the Data Key under it with scrypt. The recovery code still applies.

### Rollout

- **New installations start encrypted, with no off switch.**
- **Existing installations get a prompt at launch.** The Operator can defer it a fixed number of
  times, which the implementation plan sets. After the last deferral, encryption runs at that
  launch. The job is resumable. It checks every file against its Content Hash before replacing
  it, and it replaces the plaintext pre-migration snapshots with encrypted ones.

### The read-only MCP server

The MCP server is disabled on encrypted installations for the first release. It runs as a
separate process under `ELECTRON_RUN_AS_NODE`, where the credential store is not expected to be
reachable, and every way to give it the key either adds a dependency or conflicts with
[ADR-0038](0038-a-read-only-mcp-server-reads-a-case-from-a-separate-process.md). It reports that
the store is encrypted. Turning it back on is a later decision.

### Shared Cases

- Each member encrypts its own replica under its own Data Key. Sync decrypts on the sending side
  and encrypts again on the receiving side. No member holds another member's key.
- A remote member's chain decrypts, line by line, to exactly the bytes received. This replaces
  "byte-for-byte as received" in the Shared Cases design.
- **Sync refuses a member whose installation does not report encryption.** The sync `hello`
  message carries the sender's at-rest encryption state. A peer that reports none, or omits it,
  gets `bye` with a named reason, and the Members UI says which member is blocked. The state is
  self-reported.
- The Data Key wraps the Iroh node key (#1809), replacing that issue's `safeStorage` wrap and its
  plaintext fallback.

### Exports stay plaintext

Evidence Packages, Case Archives, and every other export are decrypted on the way out, so
independent verification does not change. Archive encryption stays with #418.

## Evidence impact

1. **Investigation need, baseline, and threat.** Operators hold sensitive Case material on
   machines whose data folder may be synced, backed up, or stored on a network share. The
   governing baseline is ADR-0004, which requires support for encrypted storage. The threat is a
   copy of the data folder or the storage root read without the Operator's operating system
   login.
2. **Supported claim.** Birdbrain encrypts the Case database and every file under the storage
   root with AES-256. A key in the operating system's credential store protects it, and a
   recovery code backs that key up. It does not protect against software running as the
   Operator, an unlocked session, memory or swap, exports and Case Archives, plaintext left in
   free disk space from before encryption, settings, logs, or browser Persona profiles. In a
   Shared Case it covers the Operator's copy only, and a removed member keeps theirs. Full-disk
   encryption stays recommended.
3. **Evidence and custody effects.** Originals, derivatives, Manifest Entries, actors, and
   custody semantics do not change. Encryption changes the bytes on disk and nothing that is
   hashed or signed. Turning encryption on writes no Manifest Entry.
4. **Verification and failure behavior.** Independent verification reads exported packages,
   which stay plaintext, so it does not change. Verification inside the app reads through the
   decrypting API. A wrong key fails when the database opens, before any read. A sealed file
   that fails authentication or is truncated is an integrity failure, never silently skipped.
   Losing both the credential store and the recovery code loses the live store; exports remain
   the backup Birdbrain recommends, and the setup screen says so.
5. **Safety effects.** A seized or synced data folder no longer exposes Case content without the
   Operator's login, which lowers the risk to Operators and Subjects. The passphrase on Linux
   machines without a keyring and the recovery code add steps an Operator under pressure can get
   wrong; the claim and the setup screen name the loss case plainly.
6. **Formats and compatibility.** The database file and every file under the storage root change
   format. Older Birdbrain versions cannot open an encrypted store. Export package and Case
   Archive formats do not change. The restore dialog accepts both plaintext and encrypted
   database files. Turning on encryption is one-way in the app; the `decrypt` command in the
   standalone verifier writes a plaintext copy.
7. **Validation.** Tests assert that a marker string from a Capture never appears in the raw
   bytes of the database, its WAL, or any file under the storage root. They also assert that the
   migration preserves every Content Hash, that an interrupted migration resumes, and that the
   stock `sqlcipher` tool opens the database with the raw key. Spikes for MHTML rendering from a
   custom scheme, `safeStorage` under `ELECTRON_RUN_AS_NODE`, and `db.backup()` into a keyed
   destination run before implementation.
8. **Remaining obligations.** Operators keep the recovery code safe, keep exports as backups,
   and use full-disk encryption. Organizations remain responsible for device security, retention,
   and lawful handling.

## Considered options

- **Keep relying on full-disk encryption.** Rejected: Birdbrain could not claim to encrypt its
  data.
- **`@journeyapps/sqlcipher`.** Rejected: its API is asynchronous, so every database call would
  be rewritten.
- **Encrypt only the database.** Rejected: plaintext captures beside it make the claim false.
- **Plaintext after acknowledgement on Linux machines without a keyring**, as `signingKey.ts`
  does. Rejected: the claim would become "encrypted where available," the narrowing the evidence
  claims audit flagged for the signing key.
- **A key per Case.** Deferred: it helps selective sharing but adds key management the claim
  does not need.

## Consequences

- `better-sqlite3-multiple-ciphers` becomes a dependency. The maintainer approved it by accepting
  this record.
- Every implementation PR touches blocking-tier paths and carries `evidence-affecting`.
- If the MHTML spike shows Chromium will not render MHTML from a custom scheme, viewing needs a
  decrypted temporary file per view. That changes the claim, and this record is amended before
  file encryption ships.
- The encrypted read and write path for files lands before the Shared Case sync step that writes
  received files (#1811).
- The public pages that say Birdbrain does not encrypt, and the two lines that describe the live
  store as readable with ordinary tools (`adoption-guide.mdx`, `threat-model.mdx`), change in the
  PR that turns encryption on.
- The read-only MCP server is unavailable to Operators until a later decision restores it.
