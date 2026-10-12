# Encrypting the live store at rest

**Date:** 2026-10-11

**Status:** Approved by [ADR-0049](../adr/0049-the-live-store-is-encrypted-at-rest.md) on
2026-10-11. Nothing here is implemented. Until it ships, every public page keeps saying
Birdbrain does not encrypt cases at rest. Text marked *Proposed, pending the maintainer* was
added after that approval and is not yet decided; the section "Proposed choices pending the
maintainer" lists each one.

**Decisions this revisits:** the round 1 map (#284) put encrypting the live store out of scope
on 2026-07-31, with a revisit trigger of "any move toward a public (non-invited) release." The
public beta brief (`docs/specs/2026-09-06-public-beta-brief.md`) kept that posture, and the Shared Cases design
(`docs/specs/2026-09-19-collaborative-cases-design.md`, decision 12) records "At-rest
encryption: None added." This spec proposes reversing both. Approval needs a new ADR that
records the reversal and passes the ADR-0004 gate for evidence-affecting decisions.

**Audience:** the maintainer deciding whether to approve, and whoever implements it.

## Problem

The maintainer wants to say that Birdbrain encrypts its data. Today that is false. Five public
pages say so: `features.mdx`, `download.mdx`, `tester-guide.mdx`, `adoption-guide.mdx`, and
`architecture.mdx`. The only secret Birdbrain wraps at rest is the signing key
(`signingKey.ts`), and only when the operating system provides a credential store.

This design encrypts the Case database and every file under the storage root with a key held in
the operating system's credential store, and states exactly what that protects.

## What exists today

- **Database.** One SQLite file, `<userData>/birdbrain.db`, opened with `better-sqlite3` in WAL
  mode, so `-wal` and `-shm` files sit beside it (`src/main/services/db/core.ts`). Full-text
  search tables, note images (inline `data:` URLs in `notes.body_doc`), and Extracted Text
  (`capture_texts.content`) all live inside it.
- **Every path that opens the database:** `openMigrated` at startup and after a snapshot
  restore, `migrateFile` for restore copies, `openDatabaseReadOnly` in the MCP server,
  `dbSnapshots.ts` probes and `db.backup()`, `dbRestore.ts`, and `dbAdmin.ts` (`VACUUM`, and a
  checkpoint followed by a file copy for the operator's backup).
- **Pre-migration snapshots.** `db-snapshots/pre-migration-v{from}-to-v{to}-{stamp}.db`, three
  kept (`dbSnapshots.ts`).
- **Storage root.** `settings.storagePath`, otherwise `<userData>/captures`. It can point
  outside `userData`, including at a network share (`src/main/index.ts`, `storage.ts`).
- **Files under the storage root** (`captureStore.ts`): per Case, `{captureId}.mhtml|html|png|txt`,
  `{captureId}_thumb.jpg`, Exhibits under `attachments/`, `images/`, `documents/`, the Staging
  Pool under `staging/`, deletions in progress under `.pending-delete/`, `manifest.jsonl` plus
  `lineage/` and Shared Case member chains, and `import-id-map.json`.
- **How files are read.** MHTML and legacy HTML load in `<webview>` partitions as `file://`
  URLs (`ipcHandlers.ts`, `webviewPolicy.ts`), and PDF export loads a `file://` URL in its own
  partition (`pdfExport.ts`). Text, PNG, and thumbnails go to the renderer over IPC. Hashing and
  verification stream the file (`createReadStream`).
- **Temporary plaintext outside the store.** Recapture writes
  `<temp>/birdbrain-recapture-<uuid>.mhtml` before streaming it in (`backgroundRenderer.ts`).
  Case import stages under `{storageRoot}/.import-staging-<uuid>` (`caseArchive.ts`).
- **Independent verification reads exports, not the live store.** The standalone verifier takes
  an unzipped export package and "does not reach into any Birdbrain installation"
  (`docs/specs/2026-06-01-standalone-verifier-design.md`). `verify.sh` and `VERIFY.md` read only
  the package they ship in.
- **The MCP server is a separate process.** It runs under `ELECTRON_RUN_AS_NODE`, opens
  `birdbrain.db` read-only, reads `settings.json` for the storage root, and reads `.txt`, PNG,
  Exhibit files, and the Manifest directly (ADR-0038, `src/mcp/`).
- **Existing key handling.** `signingKey.ts` wraps the private key with Electron `safeStorage`
  (`enc:` plus base64) and falls back to plaintext after an explicit operator acknowledgement.
  On Linux with no Secret Service, `safeStorage.isEncryptionAvailable()` returns `false`
  (`docs/specs/2026-08-12-safestorage-linux-availability-research.md`).
- **File-touching migrations** run after startup, not in `runMigrations`, because they need
  settings, the key, and the storage root. `exhibitBackfill.ts` is the existing example and is
  idempotent, keyed on database state.

## The claim this design supports

Draft, to be sharpened in the ADR. ADR-0004 requires both halves.

> Birdbrain encrypts the Case database and every file in its storage folder (captures, Exhibits,
> thumbnails, Extracted Text, and the Manifest) with AES-256. The key is held in your operating
> system's credential store (Windows DPAPI, macOS Keychain, or the Linux Secret Service), with a
> recovery code you keep. This protects a copy of Birdbrain's data taken without your operating
> system login: a synced or backed-up data folder, a storage folder on a network share, or a disk
> read without full-disk encryption.
>
> It does not protect against software running as you, because your credential store releases
> the key to it. It does not protect an unlocked, logged-in session. Exports and Case Archives
> leave Birdbrain decrypted. Settings, logs, and browser Persona profiles are not covered. Data
> written before encryption was turned on can survive in free disk space. Full-disk encryption
> is still recommended.
>
> In a Shared Case, encryption covers your copy. Each member's own installation protects that
> member's copy, and a member you remove keeps the copy they already hold.

## Threat model

| Scenario                                                    | Protected                                                    | Why                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Data folder synced to a cloud drive or included in a backup | Yes                                                          | The copy is ciphertext; the key stays in the credential store.                        |
| Storage root on a network share                             | Yes                                                          | Same.                                                                                 |
| Laptop disk read without full-disk encryption               | Yes, unless the attacker also has the operating system login | DPAPI and Keychain keys are bound to the user's login.                                |
| Another non-admin user on the same machine                  | Yes                                                          | They cannot read the credential store entry.                                          |
| Malware or any process running as the Operator              | No                                                           | DPAPI and an unlocked Secret Service release the key to any process of that user.     |
| An unlocked, logged-in session                              | No                                                           | The app is meant to read the data.                                                    |
| Exports and Case Archives                                   | No                                                           | They decrypt by design so independent verification works. Archive encryption is #418. |
| Memory, swap, hibernation files                             | No                                                           | Decrypted pages exist in memory while the app runs.                                   |
| Plaintext written before migration                          | No                                                           | Freed blocks are not wiped; full-disk encryption covers them.                         |
| The Operator                                                | No                                                           | The Operator holds the key, as with the signing key.                                  |
| Another member's replica of a Shared Case                   | Only if that member's installation encrypts                  | Each member encrypts its own replica under its own key.                               |
| A member removed from a Shared Case                         | No                                                           | They keep their replica, and their own key opens it.                                  |

## Design

### Key hierarchy

- **Data Key.** 32 random bytes per installation, generated with `crypto.randomBytes`. It is a
  new key, separate from the signing key: #292 records that a signing key and an encryption key
  must not be the same key.
- **Derived keys.** `crypto.hkdfSync('sha256', dataKey, salt, info, 32)` derives a database key
  (`info = 'birdbrain/db/v1'`) and a file key (`info = 'birdbrain/files/v1'`), so a flaw in one
  format cannot expose the other. *Proposed, pending the maintainer:* `salt` is empty (zero
  bytes) and is part of the published format, so the Data Key alone rebuilds both keys and
  nothing beside the wrapped copies needs keeping. Node 20's `hkdfSync` accepts a zero-length
  salt.
- **Credential store wrap.** `safeStorage.encryptString` over the Data Key, written to
  `<userData>/data-key.enc`. This is how the app opens without prompting.
- **Recovery wrap.** A recovery code of 128 random bits, shown once as groups of characters.
  `crypto.scrypt` derives a key-encryption key from it, and AES-256-GCM wraps the Data Key. The
  result is the recovery envelope, a small JSON file: format version, the scrypt parameters, a
  16-byte random scrypt salt, the 12-byte GCM nonce, the wrapped Data Key, and the tag. The
  envelope reveals nothing without the code. The Operator must type the code back before
  encryption starts. The code is never stored.
- **scrypt parameters.** *Proposed, pending the maintainer:* N = 2^17, r = 8, p = 1, recorded
  in each envelope so a later version can raise them. They need 128 MiB of memory, above Node's
  32 MiB default, so the call passes `maxmem`; Node 20 rejects the call without it. One
  derivation took 284 ms on Node 20.20.2.
- **Where the envelope is kept.** *Proposed, pending the maintainer:* an operating system
  reinstall removes `<userData>`, and the code cannot recover anything without an envelope. The
  app writes the same envelope to three places: `<userData>/data-key.recovery`, the storage root
  (`<storageRoot>/birdbrain-key.recovery`), and beside each database backup the Operator makes
  (`<backup>.recovery`). `backupDatabase` copies only the database file today (`dbAdmin.ts`), so
  it gains that second write. The storage root copy helps only when the root is outside
  `<userData>`, which is not the default. The code and any one copy recover the Data Key.
- **Lost credential store.** On an operating system reinstall, a moved data folder, or an
  unreadable keyring, the app asks for the recovery code. It uses the envelope in `<userData>` or
  at the storage root when one is there, and otherwise asks the Operator to pick the envelope
  file. It unwraps the Data Key and wraps it again with the new credential store.

All primitives are in Node's `crypto` module. The key hierarchy adds no dependency.

### Database

- **Driver swap.** Replace `better-sqlite3` with `better-sqlite3-multiple-ciphers`, a fork that
  bundles SQLite3 Multiple Ciphers. Its current stable release, 13.0.3, tracks `better-sqlite3`
  13.0.3, the version this repository pins, and its author also maintains `better-sqlite3`. The
  API is the same synchronous API. This is a new dependency and needs explicit approval.
- **Cipher.** The `sqlcipher` scheme with `legacy=4`, which writes the SQLCipher 4 format. The
  reason is recovery: the stock `sqlcipher` command-line tool can open the file with the raw key,
  so the database stays readable without Birdbrain.
- **Keying.** Every open path runs `PRAGMA cipher`, `PRAGMA legacy`, and `PRAGMA key` with the
  raw 32-byte database key (the `x'...'` literal form, no passphrase derivation) before any other
  statement. Then it runs `SELECT count(*) FROM sqlite_master` to fail fast on a wrong key,
  because `PRAGMA key` reports `ok` either way. One helper in `db/core.ts` owns this, and every
  open path listed under "What exists today" calls it.
- **WAL.** SQLite3 Multiple Ciphers encrypts WAL frames, so WAL mode stays.
- **Snapshots, restore, and the operator's backup.** Snapshots are written with `db.backup()`
  into a keyed destination, so they are ciphertext too. The operator's backup copies the
  encrypted file, writes the recovery envelope beside it, and can be restored only with the Data
  Key or the recovery code. The restore
  dialog must accept both a legacy plaintext file and an encrypted one.
- **Tests.** In-memory databases stay without a key. One test opens a keyed temporary file and asserts
  that a known marker string never appears in the raw bytes of the database or its WAL.

### Files under the storage root

- **Format.** *Proposed, pending the maintainer:* each file gets a header (magic `BBENC`, format
  version, a 32-byte random salt, and a random 7-byte nonce prefix), then the plaintext in 64 KiB
  segments, each sealed with AES-256-GCM under a key for that file alone,
  `crypto.hkdfSync('sha256', fileKey, salt, 'birdbrain/files/v1/segment', 32)`. A segment's
  nonce is the prefix, a 4-byte counter, and a final-segment flag, the STREAM construction. This
  supports streaming writes, streaming reads, and detecting truncation, using only Node `crypto`.
- **Why a key per file.** Under one shared file key, the 7-byte prefix alone would keep nonces
  apart across files, and two files with the same prefix would reuse the nonce of every segment
  position they share. The chance of such a pair among n files is about n²/2^57, which passes
  2^-32 at about 5,800 files. With a key per file, a nonce repeat needs two files to draw the
  same 32-byte salt.
- **Coverage.** Every file type under the storage root listed in the section on what exists today,
  including thumbnails, the Staging Pool, `.pending-delete`, and `import-id-map.json`.
- **The Manifest.** `manifest.jsonl` stays append-only. Each line becomes one sealed record:
  base64 of a 32-byte random salt, a 12-byte random nonce, the ciphertext, and the tag, under a
  key derived from the file key and that salt (`info = 'birdbrain/files/v1/line'`; *proposed,
  pending the maintainer*). Appends still flush to disk, and rollback still truncates at a line
  boundary. Lineage and member chains use the same format. A sealed line is base64, so it never
  starts with `{` as a plaintext JSON line does.
- **Hashes do not change.** The Content Hash, `textHash`, and every Manifest Entry stay
  computed over plaintext. The writer hashes plaintext as it encrypts. The signed chain, the
  Timestamp Tokens, and every existing verification result mean what they meant before.
- **One read and write API.** All readers and writers go through `captureStore.ts` for the
  sealed format, so no code path calls `fs` on a capture file directly. The callers listed under
  "How files are read" move onto it.

### Viewing captures

The renderer cannot load ciphertext through `file://`. A privileged custom scheme, registered
with `protocol.handle`, serves decrypted bytes to the `mhtml-sandbox`, `legacy-html-sandbox`,
and `pdf-export` partitions, and only to them.

This is the largest unknown in the design. Chromium may refuse to render MHTML from a scheme
other than `file:`. The first spike must answer it. If Chromium refuses, the fallback is a
decrypted temporary file per view, which is plaintext on disk, deleted when the view closes, and
named as a limitation in the claim.

### Temporary files and import

- Recapture writes straight into the sealed writer instead of `<temp>`.
- Case import writes into `.import-staging-*` in the sealed format.
- The pipeline self-test uses synthetic content and stays as it is.

### Exports

Evidence packages, Case Archives, CSV, PDF, and downloads are decrypted on the way out, by
design. The independent verification path (`birdbrain-verify`, `verify.sh`, `VERIFY.md`,
`openssl ts -verify`) reads exported packages and does not change.

### The MCP server

The MCP server needs the Data Key, and it runs under `ELECTRON_RUN_AS_NODE`, where the
`safeStorage` module is not expected to be available. A spike must confirm that. Options:

1. Disable the MCP server on encrypted installs until a key path is designed. The tool reports
   that the store is encrypted.
2. Have the app hand the key to the MCP process. That needs a channel the MCP client cannot read,
   which conflicts with ADR-0038's separate-process design.
3. Have the MCP process call the credential store itself through a native module. That adds a
   dependency.

Recommendation: option 1 for the first release, recorded in the ADR, because it is the only
option that adds no dependency and keeps ADR-0038 intact. See open question 3.

### First launch and turning encryption on

*Proposed, pending the maintainer.* `initDatabase` opens the database in `src/main/index.ts`
before `createWindow` runs, so any screen in the main window comes after the first database
write and after the live connection is open. The design moves the key steps ahead of the
database instead:

- **A setup window before the database opens.** On a profile with no Data Key, startup opens a
  setup window before `initDatabase`. It shows the recovery code, takes it back, asks for a
  passphrase on Linux without a credential store, and writes the wraps and the envelopes. Startup
  then continues, and `initDatabase` opens the database keyed from its first statement. If the
  Operator closes the setup window, startup stops, and the next launch starts again with a new
  code. The passphrase prompt at every later launch on such a Linux machine uses the same window,
  for the same reason.
- **New installations** have no database when the setup window runs, so the first database write
  is already ciphertext. They need no migration and leave no plaintext in free disk space.
- **Existing installations** get the prompt in the same window, also before `initDatabase`.
  Deferring continues startup unencrypted. Accepting runs steps 1 and 2 below while no
  connection is open, then startup continues. Steps 3 to 5 touch only files and run after startup
  as a resumable, idempotent job, like `exhibitBackfill.ts`.

1. Generate the Data Key and wrap it with the credential store. Show the recovery code and wait
   until the Operator confirms it. The prompt recommends exporting each Case first; an Operator
   who wants to can defer, export, and accept at a later launch.
2. Encrypt the database while no connection is open: open the plaintext file, `db.backup()`
   into a keyed `birdbrain.db.encrypt.partial`, run `PRAGMA integrity_check`, compare row counts
   table by table, close both connections, delete the plaintext `-wal` and `-shm`, then rename
   the copy over the original. `dbRestore.ts` closes the live connection before its rename for
   the same reason. SQLite3 Multiple Ciphers cannot `rekey` a plaintext database in WAL mode,
   which is why this step copies the database instead of changing its key.
3. Encrypt each file except the chain files: seal it to `{name}.enc.partial`, flush it to disk,
   decrypt it again, and compare the hash against the Content Hash in the Manifest (or against
   the source hash where none exists), then rename it over the original. On a resume, a file
   counts as sealed only when its header parses and its first segment authenticates under its
   key. The `BBENC` bytes alone prove nothing, because a captured page or Exhibit can begin with
   them.
4. Rewrite each chain file (`manifest.jsonl`, `manifest.<installationId>.jsonl`, and the chains
   under `lineage/`) from plaintext JSON lines into the sealed line format, verify the chain, and
   rename. Step 3 leaves these files alone so that this step reads plaintext lines.
5. Re-take the pre-migration snapshots as encrypted copies and delete the plaintext ones.

Until the job records completion in the database, readers treat a file that fails the sealed
check as plaintext. After that, and on a new installation, a file that fails authentication is
an integrity failure.

### Linux with no credential store

`safeStorage` reports no encryption on Linux without a Secret Service. Options:

1. Ask for a passphrase at every launch, derive a key with `crypto.scrypt`, and wrap the Data Key
   with it. The recovery code still applies.
2. Leave the store in plaintext after an explicit acknowledgement, matching `signingKey.ts`, and
   make the claim conditional on the credential store.

Recommendation: option 1, because option 2 turns the claim into "encrypted where
available," which is the narrowing the evidence claims audit flagged for the signing key (TM4 in
`docs/specs/2026-08-16-evidence-claims-audit.md`).

### Diagnostics

Settings -> Diagnostics gains a "Case data encryption" row: on or off, which wrap opened the Data
Key (credential store, passphrase, or recovery code), and the migration state. The diagnostics
bundle records the same fields and never the key.

### Shared Cases

Shared Cases are partly built. Manifest schema 4 with Shared Case verification, the members
table, and Shared Case export, import, and fork (#1509, #1510, #1511) are done. Peer-to-peer sync
(#1512, #1811), the Iroh transport and node key (#1809), and invite and join (#1810) are not. The
contract is `docs/specs/2026-09-19-collaborative-cases-design.md`.

- **Keys stay per installation.** Every member holds a full replica (decision 3 of that design).
  The sender reads through the decrypting API, Iroh carries the bytes over its encrypted
  connection, and the receiver writes them through the sealed writer under its own Data Key. No
  member holds another member's key, and adding or removing a member changes no key.
- **Remote member chains.** That design stores each remote member's chain as
  `manifest.<installationId>.jsonl`, "byte-for-byte as received." Under this design the
  rule becomes: the file decrypts, line by line, to exactly the bytes received. Entry Hashes
  and signatures cover those bytes, so verification results do not change. Verifying member
  chains in the app (`src/shared/verify/sharedCase.ts`, called from `manifest.ts`) reads through
  the decrypting API. Export writes the decrypted bytes, so `verify.sh` and `birdbrain-verify`
  read package files as they do today.
- **Received Exhibit files.** The sync session hashes each file on arrival and rejects a
  mismatch. The receiver hashes the plaintext as it writes the sealed file, the same as for a
  local Capture, and deletes the partial file on a mismatch. No plaintext copy reaches disk
  before the check.
- **New files in the Case directory.** `members.json` and `sync-state.json` are sealed like
  every other file under the storage root.
- **The Iroh node key.** #1809 plans to store it in its own file, wrapped with `safeStorage` like
  the signing key, with the same plaintext fallback. Under this design the Data Key wraps it
  instead, so it follows the passphrase and recovery code paths and has no plaintext fallback.
  If #1809 lands first, the migration wraps the node key again under the Data Key.
- **Members without encryption.** Encryption covers one installation's copy. A member running an
  older Birdbrain holds a plaintext replica of the same Case. Proposed rule: the sync `hello`
  message carries the sender's at-rest encryption state. A peer that reports none, or omits the
  field, gets `bye` with a named reason, and the Members UI shows which member is blocked and
  why. The state is self-reported, so a modified client can lie. The rule stops cooperating
  members from leaking a Case by accident and does nothing more. See open question 5.
- **Removed members.** A revoked member keeps its replica (decision 11 of that design), and its
  own Data Key still opens it. Encryption does not change this.
- **Handoff by Case Archive.** Shared Case export and fork produce a plaintext package, like
  every export. Archive encryption is #418.

### Reading the data without Birdbrain

A published reference page documents both formats well enough to decrypt by hand:

- **Database:** open it with the stock `sqlcipher` tool, `PRAGMA cipher_compatibility = 4`, and
  the raw database key.
- **Files:** the sealed format above.

The standalone verifier binary, which already builds without Electron or `better-sqlite3`, gains
a `decrypt` command that takes the recovery code, a recovery envelope, and a data folder, and
writes a plaintext copy.

## How this answers the three reasons in #284

1. **"It fights verification."** Independent verification already runs only on exported
   packages, which stay plaintext. The live store was never the input to `birdbrain-verify`,
   `verify.sh`, or `openssl ts -verify`. Two public lines do describe the live store as readable
   with commodity tools: `adoption-guide.mdx` ("MHTML files open in any Chromium browser. The
   Manifest is plain-text JSON lines. The database is standard SQLite.") and `threat-model.mdx`
   (copying the Case directory and editing it with ordinary tools). Both change when this ships.
2. **"It is the most reliable way to destroy evidence."** The recovery code with any copy of the
   envelope, the documented formats, and the `decrypt` command keep a lost credential store from
   being fatal. Exports
   remain the backup Birdbrain recommends. What remains is the loss of both the credential store
   and the recovery code, and the claim and the setup screen both say so.
3. **"Full-disk encryption covers the dominant threat."** That is still true. Application-level
   encryption adds the synced folder, the network share, the backup, and the disk without
   full-disk encryption. The claim recommends full-disk encryption alongside it.

## Alternatives rejected

- **Keep relying on full-disk encryption.** That makes the claim impossible, which is the problem.
- **`@journeyapps/sqlcipher`.** Its API is asynchronous. Birdbrain uses the synchronous
  `better-sqlite3` API everywhere, so switching would rewrite every database call.
- **Encrypt only the database.** Captures would stay plaintext beside an encrypted database, so
  "Birdbrain encrypts its data" would be false.
- **A passphrase at every launch for everyone.** A forgotten passphrase is the evidence-loss case
  #284 warned about, and it adds friction on every machine that has a credential store.
- **A key per Case.** It helps Shared Cases and selective sharing, but adds key management this
  claim does not need. Deferred.

## Out of scope

- Archive encryption: #418.
- `settings.json` (storage path and Operator name, role, and organisation), logs (`logSafe.ts`
  already keeps URLs, Case names, and paths out), `installation-id`, `server-token`, the
  consent-filter cache, and the copied extension.
- Persona profiles under Chromium's `Partitions/`. The app never turns on Electron's cookie
  encryption (no fuse configuration exists outside the docs), so Persona cookies are expected to
  be stored in plaintext. Turning it on is #88, and CE-AR in
  `docs/plans/2026-10-10-three-programme-agent-briefs.md` checks the plaintext on a running
  build. The claim says the profiles are not covered.
- Files the Operator exports to a path they choose.
- Memory, swap, and hibernation files.

## Delivery gates

- **New dependency:** `better-sqlite3-multiple-ciphers`. Needs approval.
- **Blocking tier:** this touches `src/main/services/db/**`, `captureStore.ts`, `storage.ts`,
  `captureLifecycle.ts`, `manifest.ts`, `signingKey.ts`, `caseArchive.ts`, `export.ts`,
  `pdfExport.ts`, `backgroundRenderer.ts`, `exhibitBackfill.ts`, `exhibits.ts`, `staging.ts`,
  `thumbnails.ts`, `src/main/index.ts`, `src/shared/verify/**`, `src/verifier/**`, and
  `scripts/build-verifier.mjs`
  (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`). Every PR carries
  `evidence-affecting` and needs maintainer review.
- **Data migration:** rewrites every file and the database on existing installations. It needs
  interruption and resume tests, and a test that the Content Hash of every migrated file still
  matches its Manifest Entry.
- **Shared Cases contract:** decision 12 of the Shared Cases design and its "byte-for-byte as
  received" rule change. The ADR amends that design alongside the #284 scope decision.
- **Public claims:** the five pages that say Birdbrain does not encrypt (named under "Problem"),
  the two live-store passages named above, and the `architecture.mdx` roadmap item "evaluate
  application-level Case encryption" change in the PR that turns encryption on, not before.

## Suggested order

1. **Spikes, in one throwaway branch:** MHTML from a custom scheme in a `<webview>`;
   `safeStorage` under `ELECTRON_RUN_AS_NODE`; `db.backup()` into a keyed destination with the
   new driver; write and read throughput of the sealed format on a large MHTML.
2. The ADR reversing the #284 scope decision, with the final claim text.
3. Key hierarchy, recovery code, and Diagnostics, with nothing encrypted yet.
4. Database encryption for new installations.
5. File encryption for new installations, the custom scheme, and the MCP decision.
6. Migration for existing installations.
7. The `decrypt` command, the reference page, and the public claim changes.

The sealed read and write API from step 5 should land before the sync session that writes
received files (#1512), so the sync work is written against it once. If the sharing work lands first,
its file reads and writes move onto the sealed API in step 5.

## Open questions for the maintainer

The maintainer decided all five as recommended on 2026-10-11, recorded in ADR-0049.

1. **Default or opt-in.** Should new installations start encrypted with no choice, or should
   encryption be a setting? The plain claim needs it on by default. Recommendation: on by
   default, with no off switch.
2. **Linux with no credential store.** Passphrase at every launch, or plaintext after an
   acknowledgement? Recommendation: passphrase.
3. **The MCP server.** Is disabling it on encrypted installations acceptable for the first
   release? Recommendation: yes, pending the spike.
4. **Existing installations.** Migrate automatically at the next launch, or wait until the
   Operator starts it? Recommendation: prompt at launch, and let the Operator defer it a limited
   number of times.
5. **Shared Case members without encryption.** Should sync refuse a member whose installation
   does not report encryption? Recommendation: yes. Without the rule, one member's plaintext
   replica undoes the protection on everyone else's copy.

## Proposed choices pending the maintainer

Review of this design on PR #1820 found gaps that no ADR, spec, or existing code settles. Each
answer below is the most conservative option these documents support, written into the design
and marked there. None is decided.

1. **Where the recovery envelope lives** (Key hierarchy). Proposed: in `<userData>`, at the
   storage root, and beside every database backup.
2. **The HKDF salt** (Key hierarchy). Proposed: empty, fixed by the published format.
3. **The scrypt parameters** (Key hierarchy). Proposed: N = 2^17, r = 8, p = 1, stored in each
   envelope.
4. **The file and Manifest line keys** (Files under the storage root). Proposed: a key per file
   and per Manifest line, each derived from the file key and a 32-byte random salt stored with
   the ciphertext.
5. **The first-launch flow** (First launch and turning encryption on). Proposed: a setup window
   before the database opens, used for new installations, the prompt on existing ones, and the
   Linux passphrase.
