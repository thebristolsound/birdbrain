# Persona management with cookie-file import

Map: #541. Sub-issues: #542 (domain model), #543 (export disclosure), #544 (mechanism), #545
(bot-detection research), #546 (threat-model delta). Status: plan, not yet approved.

## Goal

A researcher registers a persona, loads a cookie file exported from the browser where that
persona is signed in, and runs background captures (Recapture, add URL) through a session that
carries those cookies. Every resulting Capture and Manifest Entry states which persona was
present. Passwords are never stored. No anti-detection work.

## What exists

- One Operator per install: `operatorName/Role/Organization` in Settings; `operatorId` and
  `operatorName` are stamped on every capture row and Manifest Entry
  (`src/main/services/captureServer.ts:405`, `src/shared/schemas.ts:451`).
- `renderPageInHiddenWindow` (`src/main/services/backgroundRenderer.ts:376`) renders on a
  throwaway in-memory partition `recapture-<uuid>`. The `RenderPage` signature is
  `(url, { timeoutMs })` (`src/main/services/recapture.ts:29`).
- `safeStorage` already wraps the OpenRouter key (`src/main/services/settings.ts`) and the signing
  key, with a documented plaintext fallback (#414, threat-model page).
- Manifest capture entries are `.strict()`; optional fields were added once before without a
  schema bump (`duplicateOfCaptureId`, #827). `MANIFEST_SCHEMA_VERSION` is 3, DB schema is 34.
- `webviewPolicy.ts` already reasons per partition; persona partitions need their own policy
  entry so a guest cannot be pointed at a persona session.

## Decisions this plan takes (recommendations, pending grilling on #542/#544)

1. **Persona is a per-Capture provenance attribute, registered per install.** Same shape as
   Operator: registry in the install, stamp on the row and the Manifest Entry. Not per Case: a
   persona outlives a Case and binding it would force duplicate registries. Orthogonal to
   Operator: the Operator is still the human; the persona is the identity the target site saw.
2. **Mechanism is (c) both, cookie import first.** Cookie import into an Electron
   `persist:persona-<id>` partition is the deliverable; a visible login window on the same
   partition is the refresh path when cookies expire. Extension captures get a label only: the
   popup selects the active persona, the app cannot verify which Chrome profile the tab is in.
3. **Cookie files are read, loaded, and discarded.** The file bytes are never copied into the
   install. Only Chromium's own cookie store on the partition holds the values, protected by the
   same OS key `safeStorage.isEncryptionAvailable()` reports on. When that returns false the
   import UI shows the #414 warning and requires acknowledgement.
4. **Optional Manifest fields, no schema bump, verifier ships first.** `personaId` and
   `personaLabel` are optional on the `capture` entry so existing chain hashes are unchanged. The
   verifier is strict, so the release that teaches it the fields lands before any build writes
   them (same sequencing as ADR-0023).

## Supported cookie formats

| Format | Source | v1 | Why |
| --- | --- | --- | --- |
| Netscape `cookies.txt` | the "Get cookies.txt LOCALLY" extension, curl, yt-dlp | yes | plain TSV, widest tooling |
| JSON array | Cookie-Editor, EditThisCookie exports | yes | plain, fields map 1:1 to Electron's Cookie object |
| Firefox `cookies.sqlite` | profile directory | later | stored in the clear, readable with better-sqlite3, needs file-lock copy |
| Chrome `Cookies` SQLite | profile directory | no | values are OS-encrypted and app-bound on Windows since Chrome 127; not readable from another process |
| Whole browser profile directory | any | no | Electron cannot mount a Chrome or Firefox profile as a session |

Each cookie maps to the Electron `Cookie` fields in `ses.cookies.set({ url, name, value, domain, path, secure, httpOnly,
expirationDate, sameSite })`. `url` is derived from `domain` + `secure` since Electron requires
it. Rejected rows (malformed, expired, unknown `sameSite` value) are counted and reported, never
silently dropped.

## Phases

Each phase is one PR cut from `main`, labelled `agent-authored` and `evidence-affecting` from
phase 2 on, human review required (ADR-0005). Phase 1 is the only non-evidence PR.

### Phase 0: decisions (no code)

- Grill #542 and #544; record the outcome as an ADR and a `CONTEXT.md` entry for **Persona**.
- Run the #545 probe against the existing background renderer with a hand-loaded partition.
  Output: go/no-go for authenticated background capture per target platform. A no-go reduces
  phases 3 and 5 to the login-window path only and does not block phases 1, 2 or 4.

### Phase 1: registry and parsers

- Migration 35 via `pnpm db:migration:new personas`: table `personas` (`id`, `label`, `notes`,
  `created_at`, `last_import_at`, `last_import_count`, `deleted_at`).
- `src/main/services/persona/` with `personaRepo.ts` under `db/`, and pure parsers
  `cookieFiles/netscape.ts` and `cookieFiles/json.ts` returning a normalized `ImportedCookie[]`
  plus a rejection list. Unit tests with fixture files for each format and each rejection class.
- IPC: `persona:list`, `persona:create`, `persona:update`, `persona:delete`, `persona:import`
  (takes a path from the native file dialog, never file contents over IPC).
- Renderer: `components/settings/PersonasSection.tsx` (create, rename, delete, import button,
  last-import summary, the #414 warning when encryption is unavailable).
- Import loads into `session.fromPartition('persist:persona-<id>')` and returns counts. The
  partition is created here but nothing renders through it yet.
- Delete calls `clearStorageData()` on the partition then soft-deletes the row. Destructive:
  confirm in UI. The row stays so historic Captures keep resolving their label.

### Phase 2: provenance

- `captures` gains `persona_id`, `persona_label` (migration 36). `captureRepo` reads and writes
  them.
- `ManifestCaptureEntrySchema` gains optional `personaId`, `personaLabel`. Canonical body and
  chain hash unchanged when absent. `src/shared/verify` and the standalone verifier
  (`pnpm build:verifier`) accept the fields; verifier tests cover an entry with and without.
- `captureLifecycle.ingest` takes an optional `persona: { id, label }` and stamps both.
- Ships and is released before phase 3 writes the first stamped entry.

### Phase 3: persona-backed background capture

- `RenderPage` becomes `(url, { timeoutMs, partition? })`. `renderPageInHiddenWindow` uses the
  supplied persistent partition instead of `recapture-<uuid>` when given one. Everything else in
  the window stays as is: sandbox, no node, permissions denied, offscreen.
- Persistent-session hazards to handle explicitly: the consent blocker and network-idle tracker
  register on the session, which now outlives the job, so teardown must run on the session
  every time (the file already notes this at the timeout path); `setPermissionRequestHandler`
  on a shared session is set once; cache is disabled for the partition so a stale cached page
  cannot masquerade as a fresh capture.
- `webviewPolicy.ts` gets a persona partition entry that denies every guest load.
- Recapture and add-URL flows take a persona picker (default "none") and pass the partition
  and the persona stamp together, so a stamped Capture always came from the stamped session.
- `Consent Suppression` semantics are unchanged; note in the Capture detail that the render ran
  under a persona.

### Phase 4: extension label

- `GET /api/status` returns the persona list; `POST /api/captures` accepts optional `personaId`.
- Popup gets an active-persona selector beside Active Case, stored in extension local storage
  per Chrome profile so a profile-per-persona setup remembers its own choice.
- The Capture Method stays `extension`; the label is the operator's declaration, not a
  measurement, and the Capture detail says so.

### Phase 5: login window and cookie refresh

- "Sign in as persona": visible `BrowserWindow` on the persona partition, sandboxed, no
  preload, user completes login and 2FA by hand, closes the window. Nothing is recorded except
  that a sign-in window was opened (diagnostic log only).
- Persona row shows cookie count and the earliest expiry so the user knows when to refresh.

### Phase 6: disclosure and threat model

- #543: export and report wording when any Capture in the package carries a persona.
- #546: threat-model delta page: cross-persona linkage on disk (one SQLite, one Manifest per
  Case name both operator and persona), cookie theft at rest (Chromium's OS-keyed cookie encryption, same caveat as
  the signing key), wrong-persona capture (picker defaults to none, stamp and partition are set
  by one call), and what is not guaranteed (OS-level isolation, network attribution, bot
  detection).
- Tester guide section for the round-1 group.

## Out of scope

Password storage, automated login, fingerprint or user-agent spoofing, Chrome `Cookies` DB
decryption, mounting browser profiles, per-Case persona binding.

## Open questions for the maintainer

1. Does persona ride on the capture row as a label copy (`persona_label`, frozen at capture
   time) or resolve live from the registry? Frozen is recommended: a rename must not rewrite
   history the Manifest already attests.
2. Should a persona be visible in every Case, or should Cases opt in? Recommended: visible
   everywhere in v1, revisit with #543.

## Sequencing constraint

#541 was parked behind the #284 round-1 handover, and the beta release path (PRs #1490 to
#1494) is in flight. Phase 0 can start now; phase 1 should not take the dispatch slot until the
beta PRs merge.
