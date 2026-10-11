# Encrypting the live store at rest

**Date:** 2026-10-11

**Status:** Design, awaiting approval. Nothing here is implemented. Until it ships, every public
page keeps saying Birdbrain does not encrypt cases at rest.

**Decisions this revisits:** the round 1 map (#284) put encrypting the live store out of scope
on 2026-07-31, with a revisit trigger of "any move toward a public (non-invited) release."
The
public beta brief (`docs/specs/2026-09-06-public-beta-brief.md`) kept that posture. This spec
proposes reversing it. Approval needs a new ADR that records the reversal and passes the
ADR-0004 gate for evidence-affecting decisions.

**Audience:** the maintainer deciding whether to approve, and whoever implements it.

## Problem

The maintainer wants to say that Birdbrain encrypts its data. Today that is false. Five public
pages say so: `features.mdx`, `download.mdx`, `tester-guide.mdx`, `adoption-guide.mdx`, and
`SECURITY.md`. The only secrets Birdbrain wraps at rest are the signing key and the OpenRouter
credential, and only when the operating system provides a credential store.

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

## Design

### Key hierarchy

- **Data Key.** 32 random bytes per installation, generated with `crypto.randomBytes`. It is a
  new key, separate from the signing key: #292 records that a signing key and an encryption key
  must not be the same key.
- **Derived keys.** `crypto.hkdfSync('sha256', dataKey, salt, info, 32)` derives a database key
  (`info = 'birdbrain/db/v1'`) and a file key (`info = 'birdbrain/files/v1'`), so a flaw in one
  format cannot expose the other.
- **Credential store wrap.** `safeStorage.encryptString` over the Data Key, written to
  `<userData>/data-key.enc`. This is how the app opens without prompting.
- **Recovery wrap.** A recovery code of 128 random bits, shown once as groups of characters.
  `crypto.scrypt` derives a key-encryption key from it, and AES-256-GCM wraps the Data Key into
  `<userData>/data-key.recovery`. The Operator must type the code back before encryption starts.
  The code is never stored.
- **Lost credential store.** On an operating system reinstall, a moved data folder, or an
  unreadable keyring, the app asks for the recovery code, unwraps the Data Key, and wraps it
  again with the new credential store.

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
  encrypted file and can be restored only with the Data Key or the recovery code. The restore
  dialog must accept both a legacy plaintext file and an encrypted one.
- **Tests.** In-memory databases stay without a key. One test opens a keyed temporary file and asserts
  that a known marker string never appears in the raw bytes of the database or its WAL.

### Files under the storage root

- **Format.** Each file gets a header (magic `BBENC`, format version, a random 7-byte nonce
  prefix), then the plaintext in 64 KiB segments, each sealed with AES-256-GCM. A segment's
  nonce is the prefix, a 4-byte counter, and a final-segment flag, the STREAM construction. This
  supports streaming writes, streaming reads, and detecting truncation, using only Node `crypto`.
- **Coverage.** Every file type under the storage root listed in the section on what exists today,
  including thumbnails, the Staging Pool, `.pending-delete`, and `import-id-map.json`.
- **The Manifest.** `manifest.jsonl` stays append-only. Each line becomes one sealed record:
  base64 of nonce, ciphertext, and tag. Appends still flush to disk, and rollback still truncates at a
  line boundary. Lineage and member chains use the same format.
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

### Turning encryption on for an existing installation

A post-startup job, like `exhibitBackfill.ts`, resumable and idempotent:

1. Generate the Data Key and wrap it with the credential store. Show the recovery code and wait
   until the Operator confirms it. Recommend an export of each Case first.
2. Encrypt the database: `db.backup()` into a keyed `birdbrain.db.encrypt.partial`, run
   `PRAGMA integrity_check`, compare row counts table by table, then rename it over the original
   and delete the plaintext `-wal` and `-shm`. SQLite3 Multiple Ciphers cannot `rekey` a
   plaintext database in WAL mode, which is why this step copies the database instead of changing its key.
3. Encrypt each file: seal it to `{name}.enc.partial`, flush it to disk, decrypt it again, and compare the
   hash against the Content Hash in the Manifest (or against the source hash where none exists),
   then rename it over the original. Files that already start with `BBENC` are skipped, which
   makes the job resumable after a crash.
4. Rewrite each `manifest.jsonl` into the sealed line format, verify the chain, and rename.
5. Re-take the pre-migration snapshots as encrypted copies and delete the plaintext ones.

New installations start encrypted, with no migration.

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

### Reading the data without Birdbrain

A published reference page documents both formats well enough to decrypt by hand:

- **Database:** open it with the stock `sqlcipher` tool, `PRAGMA cipher_compatibility = 4`, and
  the raw database key.
- **Files:** the sealed format above.

The standalone verifier binary, which already builds without Electron or `better-sqlite3`, gains
a `decrypt` command that takes the recovery code and a data folder and writes a plaintext copy.

## How this answers the three reasons in #284

1. **"It fights verification."** Independent verification already runs only on exported
   packages, which stay plaintext. The live store was never the input to `birdbrain-verify`,
   `verify.sh`, or `openssl ts -verify`. Two public lines do describe the live store as readable
   with commodity tools: `adoption-guide.mdx` ("The database is standard SQLite") and
   `threat-model.mdx` (copying the Case directory and editing it with ordinary tools). Both
   change when this ships.
2. **"It is the most reliable way to destroy evidence."** The recovery code, the documented
   formats, and the `decrypt` command keep a lost credential store from being fatal. Exports
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
- Persona profiles under Chromium's `Partitions/`. Chromium encrypts cookies with the same
  operating system facility, and the claim says the profiles are not covered.
- Files the Operator exports to a path they choose.
- Memory, swap, and hibernation files.

## Delivery gates

- **New dependency:** `better-sqlite3-multiple-ciphers`. Needs approval.
- **Blocking tier:** this touches `src/main/services/db/**`, `captureStore.ts`, `storage.ts`,
  `captureLifecycle.ts`, `manifest.ts`, `signingKey.ts`, `caseArchive.ts`, `export.ts`,
  `staging.ts`, `thumbnails.ts`, `src/main/index.ts`, `src/shared/verify/**`, `src/verifier/**`,
  and `scripts/build-verifier.mjs`
  (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`). Every PR carries
  `evidence-affecting` and needs maintainer review.
- **Data migration:** rewrites every file and the database on existing installations. It needs
  interruption and resume tests, and a test that the Content Hash of every migrated file still
  matches its Manifest Entry.
- **Public claims:** the five pages that say Birdbrain does not encrypt, plus the two
  live-store lines named above, change in the PR that turns encryption on, not before.

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

## Open questions for the maintainer

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
