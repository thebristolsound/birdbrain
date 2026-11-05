# Persona management with cookie-file import

**Status:** active. Phase 1 shipped in PR #1570, which closed #1497. Phase 2's verifier half
merged on 2026-11-02 in #2031 (6c488f05), which also closed #1830, and its writer half merged on
2026-11-03 in #2051 (45071a74); #1498 was reopened the same day for the exhibit-ingest part that
#2051 deferred. Phases 2, 3, 5 and 6 were rewritten on 2026-11-02 around the launched browser, as
`docs/plans/2026-10-31-capture-engine-stage-2.md` (called "the stage 2 plan" below) directs;
phase 4 moved to stage 3, and phase 3b is superseded. The plan is done when phases 3, 5 and 6 have
merged and #1498 is closed; the stage 2 programme waits on that (stage 2 plan :21-22).

Map: #541. Sub-issues: #542 (domain model), #543 (export disclosure), #544 (mechanism), #545
(bot-detection research), #546 (threat-model delta). The maintainer grilled and confirmed the
decisions on 2026-09-19.

**Amended 2026-10-17 by
[ADR-0052](../adr/0052-import-persona-cookies-from-installed-browsers.md):** besides a cookie
file, a Persona's cookies may come from a browser installed on the Operator's machine, Firefox
first and then Chromium browsers on macOS and Linux, from the sites the Operator picks. Cookie
files stay as the fallback. The Firefox, Chrome `Cookies`, and whole-browser-profile rows of
"Supported cookie formats", the "Out of scope" list, and the extension-seeding item under
"Pinned, not decided" say so. A new ticket under #541 builds the browser import.

**Rewritten 2026-11-02 for capture engine stage 2.** ADR-0034 made a witnessed Capture under a
Persona a `launched` Capture in a browser Birdbrain started with that Persona's profile, kept the
Electron partition for background Captures, and withdrew `persona-window`
(ADR-0034:71-78, :93-99, :119-121). The phases below follow the stage 2 plan's step 5 and its
"Persona phases 6 and 4" (stage 2 plan :243-283). Decision 9 now states the rule of ADR-0030 as
amended on 2026-10-31 (ADR-0030:33-36). Decisions 5, 7 and 11 still read as confirmed on
2026-09-19: ADR-0034 amends decision 5's mechanism; the stage 2 spec keeps decision 7's two
wordings, drops ADR-0030's `persona-window` wording, and adds the `launched` and
`launched-passive` wordings
(`docs/specs/2026-10-10-capture-engine-launched-browser-design.md:1083-1100`, called "the spec"
below); and decision 11's persona window is the one phase 3b retires.

**Refreshed 2026-11-04 against `main` at 43ad0830.** #2031 merged the verifier half of phase 2
with the launched-browser fields at schema 7 and closed #1830; #2051 merged the writer half with
DB migration 45, after which #1498 was reopened for exhibit ingest; #2043 landed the designer's
2026-11-01 revision of the launched-browser mock; and #2046 folded the probe's attach findings into
the spec, which moved its lines. "What exists", the phase table, phase 2's three parts, and phase
3's wait lists say so, and every spec citation points at the spec on that `main`.

**Rulings, 2026-11-05.** The maintainer ruled on six points this plan left open; the stage 2 plan's
"Rulings, 2026-11-05" section holds the full list.

- A Duplicate of a Persona Capture carries the source's Persona id and label, on its signed entry
  and on its row (stage 2 ruling 4).
- A Persona Capture received into a Shared Case fills both `persona_id` and `persona_label` on the
  receiver's row from the signed entry (stage 2 ruling 5).
- When a launch reports that a launched profile fell back to Chromium's fixed-key store on this
  machine (probe P16), the Persona's row in Settings shows one warning line. Nothing shows
  otherwise (stage 2 ruling 6).
- `src/main/services/persona/**` stays advisory and does not join the blocking tier (stage 2
  ruling 7).
- #1499 drops its "Sign in as persona" window: the cookie import is the only way to seed a
  Persona's in-app session, and #1501's re-seed action points at the import (stage 2 ruling 8).
- #1498 closes. The rule that puts a Persona on an `exhibit` entry becomes an acceptance criterion
  of whichever future change first adds an exhibit writer for the `extension`, `background` or
  `extension-image` origin (stage 2 ruling 11).

## Goal

A user registers a persona, seeds it with a cookie file exported from the browser where that
identity is signed in, and runs background captures
(Recapture, add URL) through a session that carries that login. Every resulting Capture and
Manifest Entry states which persona was present. Passwords are never stored. No anti-detection
work. Under ADR-0034 the Operator also browses as a Persona in a browser Birdbrain launched with
that Persona's profile, and each Capture taken there carries the Persona (spec :179-180).

Two audiences, one feature. Most users want their own signed-in view captured. The round-1
group (#284) works under pseudonyms and needs the isolation and disclosure guarantees. The
provenance semantics are the same for both; the docs lead with the first audience and put the
guarantees second.

## What exists

Read from `origin/main` at 43ad0830 on 2026-11-04.

- **Phase 0.** ADR-0030 and the `CONTEXT.md` entry for **Persona** (`CONTEXT.md:41`) record the
  decisions, and the #545 spike is `docs/specs/2026-09-19-persona-bot-detection-spike.md`. #542
  and #545 are closed; #544 is still open.
- **Phase 1 (#1497, closed 2026-09-24).** Migration 35 creates the `personas` table
  (`src/main/services/db/migrations.ts:881-902`). `src/main/services/persona/personaSessions.ts`
  maps a Persona to `persist:persona-<id>` (`partitionForPersona`, :17), imports a cookie file
  into it (`importCookies`, :68), clears it before the soft delete (`clearPersona`, :114), sweeps
  orphaned partition folders (`removeOrphanedPartitions`, :158), and reports whether `safeStorage`
  encryption is available for the #414 warning (`getPersonaStorageState`, :197-198). The parsers
  are under `src/main/services/persona/cookieFiles/`, and the IPC channels are
  `src/shared/ipc.ts:164-169`.
- **No Capture uses a Persona yet.** `renderPageInHiddenWindow`
  (`src/main/services/backgroundRenderer.ts:870`) renders on a fresh `recapture-<uuid>` partition
  (:893). `RenderPage` is `(url, { timeoutMs, captureId, toolVersion })`
  (`src/main/services/recapture.ts:81-84`), with no partition. `src/main/webviewPolicy.ts` has no
  Persona partition entry, and nothing under `src/main/` outside `services/persona/` passes a
  `persona` to the ingest below.
- **The verifier reads a Persona and the ingest writes one; no caller passes one.** Since #2031,
  the `capture` entry (`src/shared/schemas.ts:741-742`) and the `exhibit` entry (:1133-1134) accept
  optional `personaId` and `personaLabel`. The verifier refuses an empty value (:643-644), either
  field on an entry stamped below 7, and a `personaLabel` without a `personaId` (:648-658), and
  `src/shared/verify/manifestChain.ts:492` and :514-515 pass both through. Since #2051,
  `captureLifecycle.ingest` takes an optional `persona: Pick<Persona, 'id' | 'label'>`
  (`src/main/services/captureLifecycle.ts:132`) and signs both fields (:469-470, :534-535), and
  `withCaptureEntry` in `src/main/services/manifest.ts` omits each when absent (:1329-1330). The
  `exhibit` entry input still says "Nothing writes them yet" (:833-834). The `capture` entry
  carries `operatorId` and `operatorName` (`schemas.ts:744-745`), and the capture row carries
  `operator_id`, `persona_id` and `persona_label` (`src/main/services/db/captureRepo.ts:182`,
  :204-205).
- **Schema numbers.** `MANIFEST_SCHEMA_VERSION` is 7 (`src/shared/constants.ts:120`), and the
  database is at 45 (`LATEST_SCHEMA_VERSION`, `src/main/services/db/core.ts:6`): migration 45 adds
  the two Persona columns (`src/main/services/db/migrations.ts:1927-1941`). The Capture Methods
  are `extension`, `background`, `duplicate`, and the two launched methods `launched` and
  `launched-passive` (`src/shared/types.ts:79`, :86-92). The verifier reads the launched methods,
  and nothing writes them.
- **No release carries schema 7.** The newest tag is `v1.0.1-beta.25` of 2026-10-31, and it
  contains neither 6c488f05 nor 45071a74. The maintainer's tag of a release carrying schema 7
  still gates the merge of the first caller that passes a Persona (stage 2 plan :200-204,
  :189-191).
- **Cookies at rest.** The partition's cookie values are stored unencrypted, because Electron's
  `EnableCookieEncryption` fuse is off in the build Birdbrain ships; turning it on is #88
  (ADR-0030:19-23). #1824 stays open for two Settings questions (stage 2 plan :48-49).
- **Stage 2 in flight.** #2031 added the Persona fields to the verifier at schema 7 with the
  launched-browser fields, merged on 2026-11-02 as 6c488f05, and closed #1830. #2051 added the
  writer, merged on 2026-11-03 as 45071a74, and closed #1498; the reviewing agent reopened #1498
  the same day for the exhibit-ingest part #2051 deferred. #2046 (3c07b017) folded the probe's four
  attach findings into the spec. #1831, #1832 and #1833 are open; #1829, which recorded the
  seeding-launch exception, is closed (ADR-0034:15-18).
- **The designer's revision.** #2043 (f701cb56) landed the 2026-11-01 revision of the
  launched-browser mock (`docs/design-handoff/2026-11-01-launched-browser-revision/`) and its
  assessment (`docs/specs/2026-11-02-launched-browser-revision-feasibility-assessment.md`). The
  revision draws #1833's Persona picker (assessment :316), state 13, a browser left from an earlier
  run with a Persona form and a no-Persona form, and state 15, deleting a Persona whose browser is
  open (assessment :73, :75). On 2026-11-02 the maintainer ruled that #1831 builds from that
  revision and goes to the designer for review once built (#2043's commit message).

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
   seeded by cookie-file import and used by Recapture and add URL. The sandboxed login window
   was dropped on 2026-11-05 (stage 2 ruling 8). Extension captures carry a declared label
   only; the app cannot verify which Chrome profile the tab was in.
6. **Per-job persona choice, no app-wide state.** Recapture and add-URL each carry a picker
   defaulting to none. The partition and the stamp are set from the same value in one call.
7. **Two wordings for the stamp.** `background` captures say persona session used;
   `extension` captures say persona declared by operator.
8. **Cookie files are read, loaded, and discarded.** The file bytes are never copied into the
   install. Only Chromium's own cookie store on the partition holds the values, and it holds them
   unencrypted in the partition's `Cookies` database under the user-data folder: Electron's
   `EnableCookieEncryption` fuse is off in the build Birdbrain ships, and turning it on is #88
   ([at-rest assessment](../specs/2026-10-11-persona-cookies-at-rest-assessment.md)). When
   `safeStorage.isEncryptionAvailable()` returns false the import UI shows the #414 warning and
   requires acknowledgement.
9. **Optional Manifest fields at schema 7, verifier ships first** (replaced on 2026-11-02 by the
   rule of ADR-0030 as amended on 2026-10-31, ADR-0030:94-102). `personaId` and `personaLabel` are
   optional on `capture` entries and on `exhibit` entries. The writer puts them on an `exhibit`
   entry only when its origin is `extension`, `background` or `extension-image`; the verifier
   accepts them whatever the origin (stage 2 plan :94-95). `derivation` entries carry nothing;
   they inherit from the parent. An entry that carries either field stamps manifest schema 7
   (stage 2 plan :69, :80-81), so a verifier from an earlier release reports it as from a newer
   schema instead of as malformed (ADR-0030:97-98). An entry without them keeps the number it
   stamps today, and existing chain hashes are unchanged. The release that teaches the verifier
   the fields ships before any build writes them (ADR-0023:54-57). Schema 7 carries no
   seed-source field; one takes a later number once ADR-0052 is accepted and #543 decides
   disclosure (stage 2 plan :78-79).
10. **No persona exists until the user creates one.** No first-run auto-creation; the empty
    state is one "Add persona" button.
11. **The #545 probe gates phase 3 only.** Targets: Facebook, Instagram, X, LinkedIn, Telegram
    web, and a Cloudflare-fronted forum. Spike result (`docs/specs/2026-09-19-persona-bot-detection-spike.md`):
    the four social platforms fail on terms, not fingerprint; Telegram Web and Cloudflare sites
    are conditional go. Ruling: terms exposure on a sock account is the user's risk, so the four
    platforms stay in scope through a persona window with the human present (phase 3b); the
    unattended render is measured against them once phase 3 exists. Fingerprint spoofing stays
    out.
12. **Sequencing.** Phase 0 starts now. No persona PR takes the dispatch slot until the beta
    PRs (#1490 to #1494) merge and the tag is cut.

## Supported cookie formats

| Format | Source | v1 | Why |
| --- | --- | --- | --- |
| Netscape `cookies.txt` | the "Get cookies.txt LOCALLY" extension, curl, yt-dlp | yes | plain TSV, widest tooling |
| JSON array | Cookie-Editor, EditThisCookie exports | yes | plain, fields map 1:1 to Electron's Cookie object |
| Firefox `cookies.sqlite` | profile directory | later, the first browser-import source (ADR-0052) | stored in the clear, readable with better-sqlite3, so no new dependency; Firefox holds an exclusive lock on the database while it runs, so Firefox is closed during the import, which reads a temporary copy of the database |
| Chrome `Cookies` SQLite | profile directory | later on macOS and Linux (ADR-0052); no on Windows | values are OS-encrypted; on macOS and Linux the import needs a key reader for the keychain or `libsecret`, a dependency decision still open; Chrome and Edge on Windows use App-Bound Encryption since version 127, and Birdbrain never works around it, so they stay file-only |
| Whole browser profile directory | any | no as a directory; its cookies later (ADR-0052) | Electron cannot mount a Chrome or Firefox profile as a session; a browser import takes every cookie in a source profile only when the Operator states that the profile serves this Persona alone |

Each cookie maps to the Electron `Cookie` fields in `ses.cookies.set({ url, name, value,
domain, path, secure, httpOnly, expirationDate, sameSite })`. `url` is derived from `domain` +
`secure` since Electron requires it. Rejected rows (malformed, expired, unknown `sameSite`
value) are counted and reported, never silently dropped.

## Phases

Each phase is one or more PRs cut from `main`. Every code PR in phases 2 and 3 is
evidence-affecting at the blocking tier, so the maintainer reviews and merges it (ADR-0005; stage
2 plan :157-159). Phases 1 and 5 are not evidence-affecting.

| Phase | Issues | Stage 2 step | Waits on |
| --- | --- | --- | --- |
| 2, verifier half | #1498 in #2031 | step 2 | nothing: merged on 2026-11-02 as 6c488f05 |
| 2, writer half | #1498 in #2051 | step 5 | nothing: merged on 2026-11-03 as 45071a74 |
| 2, exhibit ingest | none: #1498 closes | none | an acceptance criterion of the first change that adds an exhibit writer for the `extension`, `background` or `extension-image` origin |
| 2, Duplicate and received rows | not yet filed | step 5 | its turn on `captureLifecycle.ts` after #1832; merges before any caller passes a Persona |
| 3, launched profile | #1833 | step 5 | the schema 7 release, and the Duplicate and received-row change |
| 3, background render | #1499 | step 5 | the schema 7 release, and the Duplicate and received-row change |
| 3b | #1505 | none | superseded |
| 4 | #1500 | stage 3 | the Companion pipe |
| 5 | #1501 | step 5 | #1499 |
| 6 | #543, #546, tester guide | none | the code each statement describes |

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

### Phase 2: provenance (#1498, in two halves)

The stage 2 plan splits #1498 in two (stage 2 plan :245-248).

**Verifier half, stage 2 step 2: merged in #2031 (6c488f05, 2026-11-02).**

- #2031 added `personaId` and `personaLabel` to `capture` and `exhibit` entries
  (`src/shared/schemas.ts:741-742`, :1133-1134) in the same PR as the launched-browser fields, and
  moved `MANIFEST_SCHEMA_VERSION` from 6 to 7 (`src/shared/constants.ts:120`; stage 2 plan
  :80-81). It closed #1830.
- Both fields share a refine that requires schema 7 (`schemas.ts:648-652`), and
  `fieldMinReaderSchemaVersion` (`src/main/services/manifest.ts:1053`) stamps `PERSONA_MIN_READER`
  (:1037), so an entry that carries one stamps 7 (decision 9). A second refine refuses a
  `personaLabel` without a `personaId` (`schemas.ts:654-658`).
- `src/shared/verify` (`manifestChain.ts:492`, :514-515) and the standalone verifier
  (`pnpm build:verifier`) accept the fields.
- No release carries schema 7 yet. When the maintainer tags one, it ungates the merge of the
  first caller that passes a Persona (stage 2 plan :200-204, :245-248).

**Writer half, stage 2 step 5: merged in #2051 (45071a74, 2026-11-03).**

- Migration 45 adds nullable `persona_id` and `persona_label` to `captures`, skipping a column
  already present and with no foreign key to `personas`
  (`src/main/services/db/migrations.ts:1927-1941`); `LATEST_SCHEMA_VERSION` is 45 (`core.ts:6`).
  `captureRepo` reads and writes them (`captureRepo.ts:204-205`, :266-267, :548-549), following
  `operator_id` (:182, :250, :570).
- `captureLifecycle.ingest` takes an optional `persona: Pick<Persona, 'id' | 'label'>`
  (`captureLifecycle.ts:132`) and writes the row columns and the entry fields (:469-470,
  :534-535). A Persona turns on the strict pre-sign parse (:546), so an empty id or label is
  refused before anything is signed. `withCaptureEntry` omits each field when absent
  (`manifest.ts:1329-1330`), so an entry without a Persona keeps its body and its stamp.
  `captureLifecycle.ts` passes from #2051 to #1832, then to #600 (stage 2 plan :292-294).
- It merged before the schema 7 release because no caller passes a Persona: the ingest callers at
  `recapture.ts:352` and `captureLifecycle.ts:1469` pass none. Its first callers are #1833 and
  #1499 (stage 2 plan :245-248).
- #2051's description left two cases open. `duplicate()` (`captureLifecycle.ts:1618`) names
  neither Persona field, so a Duplicate of a Persona Capture signs no Persona. A Capture received
  into a Shared Case leaves both columns NULL (`migrations.ts:1929-1930`;
  `sharing/receivedEvidence.ts` names neither column) although its signed entry carries the
  Persona. The maintainer ruled on both on 2026-11-05: a Duplicate carries the source's Persona id
  and label on its signed entry and its row, and a received Capture fills both columns from its
  signed entry (stage 2 rulings 4 and 5). The change that does so merges before the first caller
  passes a Persona.
- It adds no Capture Method. `persona-window` left #1498's scope on 2026-10-10 (spec :90-94).

**Exhibit ingest: a criterion for a later change (#1498 closes under the ruling of 2026-11-05).**

- #1498's scope gives exhibit ingest for the `extension`, `background` and `extension-image`
  origins the same `persona` parameter, and decision 9 puts the fields on an `exhibit` entry for
  those origins only. #2051 deferred it: the only `exhibit` entry writer is `commitStagedFiles`
  (`src/main/services/staging.ts:216-222`), and the only staging insert uses
  `MANUAL_UPLOAD_ORIGIN` (:38, :162), so the rule falls to the first change that adds an exhibit
  writer for one of those origins (#2051's description). The `exhibit` entry input still says
  "Nothing writes them yet" (`manifest.ts:833-834`).
- On 2026-11-05 the maintainer ruled that #1498 closes and that this rule becomes an acceptance
  criterion of whichever future change first adds an exhibit writer for the `extension`,
  `background` or `extension-image` origin (stage 2 ruling 11).

### Phase 3: a Persona's two browser sessions

ADR-0034 gives a Persona one browser session per engine: a launched-browser profile and an
Electron partition, both seeded from the same cookie import (ADR-0034:93-96).

**A launched-browser profile per Persona (#1833).** It waits on the schema 7 release (stage 2 plan
:249-252) and, as a first caller passing a Persona, on the change that carries the Duplicate and
received-row rulings of 2026-11-05. Its waits on #1831's code, on the verifier and on the writer it
calls ended when #2056, #2031 and #2051 merged.

- The Operator picks the Persona, default none, when starting the launched browser, and the choice
  holds for that browser's life (decision D21, spec :251-257). Each Capture taken in it carries
  that Persona from the launch's choice, never from a picker at capture time (E5, spec :179-180).
  Whichever of #1832 and #1833 merges second wires the stamp into the launched route (#1833,
  "Order and lanes").
- Each Persona has one browser profile per browser product, under
  `<userData>/launched-browsers/persona-<personaId>/<product>/` (decision D8, spec :729-739).
- One import seeds the partition and each configured product's profile. A windowless seeding
  launch writes the cookies with `Storage.setCookies`, and the engine never reads a cookie value
  back out of either store (decision D7, spec :794-801). That launch is the one exception to the
  rule that a launched browser runs only inside a Capture Session (ADR-0034:15-18).
- Deleting a Persona deletes its browser profiles after clearing the partition and before the soft
  delete (spec :745-749).
- Persona profiles turn off Chrome sync and password saving (decision D15, spec :756-762). Under
  the maintainer's ruling of 2026-10-17, the launched browser also blocks the password leak check
  (stage 2 plan :42-44).
- Before adding a plaintext warning, the PR quotes the Linux key store measurement (decision D17,
  spec :763-774). When a launch reports the fixed-key fallback on this machine, the Persona's row
  in Settings shows one warning line, and nothing shows otherwise; `src/main/services/persona/**`
  stays advisory (stage 2 rulings 6 and 7 of 2026-11-05).
- It takes the migration lane only if it stores per-store counts on the `personas` row (spec
  :877).

**Background render through the partition (#1499).** The Electron partition serves background
Recapture and add-URL only (spec :105-106, ADR-0034:93-96).

- `RenderPage` (`recapture.ts:81-84`) gains an optional partition, and
  `renderPageInHiddenWindow` (`backgroundRenderer.ts:870`) uses the Persona's
  `persist:persona-<id>` partition instead of `recapture-<uuid>` (:893) when given one. Sandbox,
  no Node, denied permissions, and offscreen rendering stay as they are.
- The session outlives the job, so the consent blocker and the network-idle tracker tear down on
  every exit path, the permission handler is set once per session, and the partition is created
  with `cache: false` (#1499 scope; spec :649-650).
- `webviewPolicy.ts` gains a Persona partition entry that denies every guest load.
- Recapture and add-URL take a Persona picker, default none, and pass the partition and the
  `persona` stamp from the same value in one call (decision 6). Capture detail shows "persona
  session used" (spec :1092).
- #1499's body says it is blocked by #1498 and by #545. #545 closed on 2026-09-20, and the writer
  #1499 calls, `captureLifecycle.ingest` with a `persona`, merged in #2051; #1498 is open only for
  exhibit ingest, which #1499 does not touch. On 2026-11-05 the maintainer dropped its "Sign in as
  persona" window: the cookie import is the only way to seed the partition (stage 2 ruling 8). It
  merges only after the change that carries the Duplicate and received-row rulings and after the
  schema 7 release (stage 2 plan :200-204).
- The unattended render against the four social platforms is still unmeasured; it gates this
  half only (ADR-0030:129-132).

**Orphan sweep.** #1628 reports that the sign-in cleanup deletes sessions a later restore brings
back. It sits in the sweep that #1831 and #1833 extend, and it is labelled ready-for-human (stage 2
plan :260-261).

### Phase 3b: superseded (#1505)

On 2026-10-10 the maintainer ruled #1505 superseded by the launched-browser design and ruled that
`persona-window` leaves #1498's scope (spec :90-94); GitHub records #1505 closed as not planned.
ADR-0034 withdrew the method (ADR-0034:98-99). A witnessed Capture under a Persona is now a
`launched` Capture in the Persona's browser profile (phase 3). Decision 11's ruling that the four
social platforms stay in scope with a human present was made for the Electron persona window;
nobody has tried a launched Chrome against them (spec :261-266).

### Phase 4: moved to stage 3 (#1500)

#1500 becomes the declared Persona on a stage 3 `companion` Capture and leaves this plan (stage 2
plan :280-282). ADR-0034 builds the Companion pipe after launched Chromium browsers
(ADR-0034:101-103), and stage 3 sets the `companion` wording (spec :1099). #1500's body still
describes an extension popup selector, the `extension` method and a block on #1498. On 2026-11-05
the maintainer ruled that #1500 comes off ready-for-agent until stage 3 (stage 2 ruling 9).

### Phase 5: cookie count and expiry (#1501)

- Each Persona shows a cookie count and the earliest expiry for each store, so the user knows when
  to re-seed (stage 2 plan :257-259).
- For the partition, the count and the expiry come from the partition's own cookie store, as
  #1501's scope describes. For a launched profile, they come from the import result, because S2
  forbids reading cookie values from the launched browser (spec :194-195).
- Storing per-store counts on the `personas` row needs a migration (spec :877). #1833 and #1501
  may need that `personas` row migration; #2051 took DB 45, so `pnpm db:migration:new` scaffolds
  it as 46, and it takes the migration lane, which holds one migration PR at a time (stage 2 plan
  :231-232).
- No cookie name or value crosses IPC. The phase is not evidence-affecting (stage 2 plan
  :101-103).
- #1501's body says it is blocked by #1499, because the sign-in window was the re-seed action it
  pointed at. Since the ruling of 2026-11-05 dropped that window, the re-seed action is a cookie
  import (stage 2 ruling 8).

### Phase 6: disclosure, threat model, and tester guide

- **#543** (export disclosure, wayfinder:grilling) takes the `launched` wording of decision D11
  and the seed-source question from ADR-0052 (stage 2 plan :274-276). The wording for Capture
  detail, `report.html`, `certification.html` and `VERIFY.md` is the spec's table (spec
  :1090-1095); export wording stays with #543 (spec :1099).
- **#546** takes the threat-model change, which ships with the code that makes it true (spec
  :1656-1657). Beyond the original items (cross-persona linkage on disk, cookie theft at rest,
  wrong-persona capture, and what is not guaranteed), it covers:
  - What two Personas share in the launched browser: the machine, the Egress, and the browser
    build (spec :752-755).
  - The wrong-persona mitigation at launch: the picker defaults to none, one launched browser
    runs at a time, and the panel shows the Persona (spec :248-257; #1833 scope).
  - Unencrypted partition cookies (ADR-0030:19-23) and the launched profile's key store (spec
    :763-774).
- **The tester guide** has no issue yet (stage 2 plan :279). It leads with capturing a page you are
  signed in to in the launched browser, and puts the guarantees for pseudonymous work second.

## Out of scope

Password storage, automated login, fingerprint or user-agent spoofing (the t3code research also found UA rewriting breaks Turnstile), working around
App-Bound Encryption (Chrome and Edge on Windows stay file-only), mounting browser profiles as a
session, per-Case persona binding, first-run auto-created personas. Since ADR-0052, a browser
import is planned to decrypt the `Cookies` database of a Chromium browser on macOS and Linux, and
it may take every cookie in a source profile when the Operator states that the profile serves
this Persona alone.

## Pinned, not decided

- **Hardened Chromium profile per persona.** Birdbrain launches Brave (or another Chromium)
  with a per-persona `--user-data-dir` instead of rendering in an Electron partition. Avoids
  the bot-detection question and Chrome's cookie limitations. Would make the extension label
  path verifiable. Revisit if the #545 probe returns no-go, or as a phase 7 alternative.
- **One-click seeding from the Birdbrain extension** through the `cookies` permission. Removes
  the export step for the casual audience. Costs a store-review permission and moves cookie
  values over the capture-server channel. Phase 7 candidate, measured against whether users
  stall on the export step. Ruling 72 of 2026-10-10 adopted import from installed browsers
  instead of file import plus this route (ADR-0052). Chrome and Edge on Windows stay file-only,
  so the export step remains there, and whether App-Bound Encryption affects this route's
  `chrome.cookies.getAll` is not verified.
- **Research: t3code's browser-launcher profiles and integrated preview browser.** Read their
  current profile model before phase 3 design review.
