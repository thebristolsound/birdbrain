# Persona management with cookie-file import

Map: #541. Sub-issues: #542 (domain model), #543 (export disclosure), #544 (mechanism), #545
(bot-detection research), #546 (threat-model delta). Status: decisions grilled and confirmed by
the maintainer on 2026-09-19; not yet scheduled.

## Goal

A user registers a persona, seeds it with a cookie file exported from the browser where that
identity is signed in or by signing in through a Birdbrain window, and runs background captures
(Recapture, add URL) through a session that carries that login. Every resulting Capture and
Manifest Entry states which persona was present. Passwords are never stored. No anti-detection
work.

Two audiences, one feature. Most users want their own signed-in view captured. The round-1
group (#284) works under pseudonyms and needs the isolation and disclosure guarantees. The
provenance semantics are the same for both; the docs lead with the first audience and put the
guarantees second.

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

## Decisions (confirmed 2026-09-19)

Recorded in ADR-0030 and the `CONTEXT.md` entry for **Persona** (phase 0, 2026-09-19).

1. **Persona is a per-Capture provenance attribute, registered per install.** Same shape as
   Operator: registry in the install, stamp on the row and the Manifest Entry. Orthogonal to
   Operator: the Operator is still the human; the persona is the identity the target site saw.
   Not per Case; visible in every Case's picker in v1. Per-Case opt-in is deferred to #543.
2. **The term is Persona everywhere**, domain model and UI, framed in onboarding copy as "a
   signed-in browser identity, yours or a pseudonym". No softer UI label.
3. **Label frozen at capture time.** `personaLabel` on the row and the entry is what the persona
   was called when the Capture was made. A rename never rewrites it.
4. **Soft delete.** Deleting a persona clears the partition's storage and hides the row from
   pickers; the row stays so historic Captures keep their label. Deletion is always available
   because clearing the cookies is the security action.
5. **Mechanism is both, Electron partition primary.** A `persist:persona-<id>` partition is
   seeded by cookie-file import or by a sandboxed login window, and used by Recapture and add
   URL. Extension captures carry a declared label only; the app cannot verify which Chrome
   profile the tab was in.
6. **Per-job persona choice, no app-wide state.** Recapture and add-URL each carry a picker
   defaulting to none. The partition and the stamp are set from the same value in one call.
7. **Two wordings for the stamp.** `background` captures say persona session used;
   `extension` captures say persona declared by operator.
8. **Cookie files are read, loaded, and discarded.** The file bytes are never copied into the
   install. Only Chromium's own cookie store on the partition holds the values, protected by the
   same OS key `safeStorage.isEncryptionAvailable()` reports on. When that returns false the
   import UI shows the #414 warning and requires acknowledgement.
9. **Optional Manifest fields, no schema bump, verifier ships first.** `personaId` and
   `personaLabel` are optional on `capture` entries and on `exhibit` entries whose origin is
   `extension`, `background` or `extension-image`. `derivation` entries carry nothing; they
   inherit from the parent. Existing chain hashes are unchanged. The verifier is strict, so the
   release that teaches it the fields lands before any build writes them (ADR-0023 sequencing).
10. **No persona exists until the user creates one.** No first-run auto-creation; the empty
    state is one "Add persona" button.
11. **The #545 probe gates phase 3 only.** Targets: Facebook, Instagram, X, LinkedIn, Telegram
    web, and a Cloudflare-fronted forum. A no-go on a platform is recorded in the tester guide;
    a no-go everywhere drops partition rendering and ships the label path only.
12. **Sequencing.** Phase 0 starts now. No persona PR takes the dispatch slot until the beta
    PRs (#1490 to #1494) merge and the tag is cut.

## Supported cookie formats

| Format | Source | v1 | Why |
| --- | --- | --- | --- |
| Netscape `cookies.txt` | the "Get cookies.txt LOCALLY" extension, curl, yt-dlp | yes | plain TSV, widest tooling |
| JSON array | Cookie-Editor, EditThisCookie exports | yes | plain, fields map 1:1 to Electron's Cookie object |
| Firefox `cookies.sqlite` | profile directory | later | stored in the clear, readable with better-sqlite3, needs file-lock copy |
| Chrome `Cookies` SQLite | profile directory | no | values are OS-encrypted and app-bound on Windows since Chrome 127; not readable from another process |
| Whole browser profile directory | any | no | Electron cannot mount a Chrome or Firefox profile as a session |

Each cookie maps to the Electron `Cookie` fields in `ses.cookies.set({ url, name, value,
domain, path, secure, httpOnly, expirationDate, sameSite })`. `url` is derived from `domain` +
`secure` since Electron requires it. Rejected rows (malformed, expired, unknown `sameSite`
value) are counted and reported, never silently dropped.

## Phases

Each phase is one PR cut from `main`, labelled `agent-authored` and `evidence-affecting` from
phase 2 on, human review required (ADR-0005). Phase 1 is the only non-evidence PR.

### Phase 0: decisions and probe (no product code)

- Record decisions 1 to 10 as an ADR and a `CONTEXT.md` entry for **Persona**; close #542 and
  #544 against it.
- Run the #545 probe against the existing background renderer with a hand-seeded partition.
  Output: a spike doc under `docs/specs/` with a go/no-go per target platform.

### Phase 1: registry and parsers

- Migration 35 via `pnpm db:migration:new personas`: table `personas` (`id`, `label`, `notes`,
  `created_at`, `last_import_at`, `last_import_count`, `deleted_at`).
- `src/main/services/persona/` with `personaRepo.ts` under `db/`, and pure parsers
  `cookieFiles/netscape.ts` and `cookieFiles/json.ts` returning a normalized `ImportedCookie[]`
  plus a rejection list. Unit tests with fixture files for each format and each rejection class.
- IPC: `persona:list`, `persona:create`, `persona:update`, `persona:delete`, `persona:import`
  (takes a path from the native file dialog, never file contents over IPC).
- Renderer: `components/settings/PersonasSection.tsx` (create, rename, delete, import button,
  last-import summary, the #414 warning when encryption is unavailable, the "signed-in browser
  identity" empty state).
- Import loads into `session.fromPartition('persist:persona-<id>')` and returns counts. The
  partition is created here but nothing renders through it yet.
- Delete calls `clearStorageData()` on the partition then soft-deletes the row. Confirmed in UI.

### Phase 2: provenance

- `captures` gains `persona_id`, `persona_label` (migration 36). `captureRepo` reads and writes
  them.
- `ManifestCaptureEntrySchema` and the `exhibit` entry schema gain optional `personaId`,
  `personaLabel`. Canonical body and chain hash unchanged when absent. `src/shared/verify` and
  the standalone verifier (`pnpm build:verifier`) accept the fields; verifier tests cover an
  entry with and without.
- `captureLifecycle.ingest` takes an optional `persona: { id, label }` and stamps both.
- Ships and is released before phase 3 writes the first stamped entry.

### Phase 3: persona-backed background capture and login window

Gated on the phase 0 go/no-go.

- `RenderPage` becomes `(url, { timeoutMs, partition? })`. `renderPageInHiddenWindow` uses the
  supplied persistent partition instead of `recapture-<uuid>` when given one. Everything else in
  the window stays as is: sandbox, no node, permissions denied, offscreen.
- Persistent-session hazards to handle explicitly: the consent blocker and network-idle tracker
  register on the session, which now outlives the job, so teardown must run on the session
  every time (the file already notes this at the timeout path); `setPermissionRequestHandler`
  on a shared session is set once; the partition's cache is turned off so a stale cached page
  cannot masquerade as a fresh capture.
- `webviewPolicy.ts` gets a persona partition entry that denies every guest load.
- Recapture and add-URL flows take a persona picker (default "none") and pass the partition
  and the persona stamp together.
- "Sign in as persona": visible `BrowserWindow` on the persona partition, sandboxed, no
  preload, user completes login and 2FA by hand, closes the window. Nothing is recorded except
  that a sign-in window was opened (diagnostic log only).
- Capture detail shows "persona session used" for these captures.

### Phase 4: extension label

- `GET /api/status` returns the persona list; `POST /api/captures` accepts optional `personaId`.
- Popup gets an active-persona selector beside Active Case, stored in extension local storage
  per Chrome profile so a profile-per-persona setup remembers its own choice.
- The Capture Method stays `extension`; Capture detail shows the declared-by-operator wording.

### Phase 5: expiry

- Persona row shows cookie count and the earliest expiry so the user knows when to re-seed.

### Phase 6: disclosure and threat model

- #543: export and report wording when any Capture in the package carries a persona, using the
  two wordings from decision 7.
- #546: threat-model delta page: cross-persona linkage on disk (one SQLite, one Manifest per
  Case name both operator and persona), cookie theft at rest (Chromium's OS-keyed cookie
  encryption, same caveat as the signing key), wrong-persona capture (per-job picker, default
  none, stamp and partition set by one call), and what is not guaranteed (OS-level isolation,
  network attribution, bot detection).
- Tester guide: leads with capturing a page you are signed in to; the guarantees for
  pseudonymous work are the second section.

## Out of scope

Password storage, automated login, fingerprint or user-agent spoofing, Chrome `Cookies` DB
decryption, mounting browser profiles, per-Case persona binding, first-run auto-created
personas.

## Pinned, not decided

- **Hardened Chromium profile per persona.** Birdbrain launches Brave (or another Chromium)
  with a per-persona `--user-data-dir` instead of rendering in an Electron partition. Avoids
  the bot-detection question and Chrome's cookie limitations. Would make the extension label
  path verifiable. Revisit if the #545 probe returns no-go, or as a phase 7 alternative.
- **One-click seeding from the Birdbrain extension** through the `cookies` permission. Removes
  the export step for the casual audience. Costs a store-review permission and moves cookie
  values over the capture-server channel. Phase 7 candidate, measured against whether users
  stall on the export step.
- **Research: t3code's browser-launcher profiles and integrated preview browser.** Read their
  current profile model before phase 3 design review.
