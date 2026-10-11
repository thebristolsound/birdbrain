# Browser cookie import from installed browsers: research

**Date:** 2026-10-10

**Status:** Research. The maintainer adopted the recommendation, option 2, on 2026-10-10 as
ruling 72 of that day's decision walkthrough, and ruled on the at-rest wording in ruling 73. Both
are stated under [Maintainer rulings](#maintainer-rulings-2026-10-10). Nothing here is implemented.

**Question:** While ruling on decision D7 of the
[launched-browser spec](2026-10-10-capture-engine-launched-browser-design.md), which seeds a
Persona's browser profile from the Persona import, the maintainer asked that Birdbrain detect the
browsers installed on the machine and import cookies from them, as t3code does. The
[persona cookie-import plan](../plans/2026-09-19-persona-cookie-import.md) rules out reading
Chrome's `Cookies` database. What does t3code do, what would adopting it change, and which option
fits Birdbrain?

**Frame of reference:** a point-in-time reading. Line citations describe the commits named here
and are not maintained. Keys used in citations:

- `t3/` is `apps/desktop/src/preview/BrowserImport/` in
  [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at commit `febe1b24`. A file name with
  no directory (`Sources.ts`, `ChromiumKeys.ts`, and the rest) is in `t3/`. Other t3code paths
  (`apps/`, `packages/`, `native/`, `LICENSE`) are at the same commit.
- `plan` is `docs/plans/2026-09-19-persona-cookie-import.md`.
- `spec` is the launched-browser spec, cited by section because it took the rulings after this
  reading.
- `roadmap` is `docs/plans/2026-10-10-three-programme-agent-briefs.md` on branch
  `docs/three-programme-agent-briefs`, cited by section.
- `assessment` is `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`.
- Other Birdbrain paths are at `origin/main` `df531d36`.
- "Google" is the
  [Google Security Blog post of July 2024 on Chrome cookies](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html).

## What t3code does

- It checks a fixed list of nine browsers. To list them, it opens each browser's live cookie
  database read-only and counts the rows (t3/Sources.ts:107-211, 374-406, 906-917).
- It refuses to import while the source browser runs. After that it copies the Chromium or
  Firefox database with `VACUUM INTO` into a temporary directory and deletes the copy afterwards
  (BrowserImport.ts:95; CookieDatabase.ts:87-100).
- It gets the Chromium key from a different place on each operating system (ChromiumKeys.ts:10,
  100-127, 135-179, 199-216, 309-333):
  - macOS: the keychain, through `@napi-rs/keyring`.
  - Linux: `libsecret`, through a bundled C helper. v10 rows need only the fixed `peanuts`
    passphrase. t3code has no `KWallet` reader.
  - Windows: the Windows Data Protection API (DPAPI). t3code refuses app-bound stores.
- It imports the whole profile with no domain filter. It skips partitioned rows, and it drops
  Firefox container rows without counting them (`packages/contracts/src/browserImport.ts:108-113`;
  ChromiumCookies.ts:256-261; FirefoxCookies.ts:128-144).
- It has no consent screen of its own. The operating system's prompt is the only consent, and
  Linux v10 rows and Firefox need no prompt at all
  (`apps/web/src/components/settings/BrowserImportWizard.tsx:144-229`; ChromiumKeys.ts:309-332;
  FirefoxCookies.ts:4-8).

## Platform by browser

| Browser | macOS | Linux | Windows |
|---|---|---|---|
| Chrome, Edge | Prompt [1] | Works [2] | Does not work [3] |
| Brave, Vivaldi, Opera | Prompt [1] | Works [2] | Refused [4] |
| Arc | Prompt [1] | No build | Refused [4] |
| Helium | Prompt [1] | Works [2] | Works, no prompt [5] |
| Firefox | Works, no prompt [6] | Works, no prompt [6] | Works, no prompt [6] |
| Safari | Full Disk Access grant [7] | none | none |

1. The dialog offers Deny, Allow, or Always Allow. Always Allow trusts the app permanently
   ([Apple, access control lists](https://developer.apple.com/documentation/security/access-control-lists);
   ChromiumKeys.ts:100-127).
2. v11 rows need the Secret Service, which prompts only when it is locked. On KDE the key sits in
   `KWallet`, so v11 rows there are likely lost (t3code `native/browser-secret/main.c:23-27`;
   Chromium `b3fffd4b` `freedesktop_secret_key_provider.cc:205-231`).
3. App-Bound Encryption since Chrome 127 and Edge 127 (Google;
   [ElcomSoft blog](https://blog.elcomsoft.com/?p=12644)).
4. This is t3code's choice. Whether these forks use App-Bound Encryption is not verified
   (Sources.ts:157-175;
   [Brave, sensitive data storage](https://support.brave.app/hc/en-us/articles/29808985123085-Sensitive-data-storage)).
5. Uses the older DPAPI scheme (Sources.ts:165-175).
6. Firefox stores values as plaintext, `value TEXT` (mozilla-central
   `CookiePersistentStorage.cpp:1355`).
7. t3code checks the grant at SafariCookies.ts:212-236.

Costs:

- The source browser must be closed. For Chromium that is t3code's rule; Firefox holds an
  exclusive lock on its database (Sources.ts:866-875; mozilla-central
  `mozStorageConnection.cpp:1192-1206`).
- Chromium needs a keychain binding, a `libsecret` helper built for each architecture, and python3
  for the Firefox lock probe (`apps/desktop/package.json:19`; Sources.ts:740-801).
- Firefox alone needs only better-sqlite3, which Birdbrain already has (`package.json:157`).

## What adopting it changes

- **Prior decision.** "Chrome Cookies SQLite: no" (plan:86) holds for Windows Chrome and Edge. It
  does not hold for macOS or Linux
  (`docs/specs/2026-09-19-t3code-browser-profiles-research.md:303-307`). Firefox import carries out
  the plan's "later" row (plan:85). Chromium import reverses the out-of-scope line (plan:187-189).
  No rule requires a new ADR; `docs/agents/domain.md:31-35` requires the conflict to be stated
  openly, and ruling 72 asks for an ADR.
- **ADR-0030.** A temporary copy of the database conflicts with two phrases (ADR-0030:62-65): cookie
  files are "read, loaded into the session, and discarded" and "the only copy of a cookie value is
  Chromium's own store." The macOS Chrome key probably also decrypts saved passwords, so the reader
  must touch the cookie table and nothing else (Chromium 152 `login_database.cc:42, 763-765`).
  Importing a whole profile puts the Operator's own signed-in sessions into a Persona (#541
  Destination; plan:9-17). ADR-0032 is unaffected (ADR-0032:36-118).
- **The at-rest wording may be wrong today.** ADR-0030:64-65 and `personaSessions.ts:10-15` say
  the `safeStorage` key protects partition cookies. Electron's `cookieEncryption` fuse defaults to
  Disabled, and Birdbrain does not set it
  ([Electron v44.5.1 fuses documentation](https://github.com/electron/electron/blob/v44.5.1/docs/tutorial/fuses.md),
  lines 38-49; app-builder-lib 26.15.3 `platformPackager.js:259-262`). Nobody has checked this on
  a running build. #88 tracks the fuse. Turning it on cannot be undone, and on macOS it needs code
  signing, which releases do not have (fuses.md:46-53; SECURITY.md:60).
- **Threat model.** The threat-model page covers chain of custody only (`threat-model.mdx:6-10`).
  SECURITY.md:20-24 does not mention Birdbrain holding a lasting grant to another app's key. On
  Linux and for Firefox, Birdbrain's own dialog would be the only consent
  (ChromiumKeys.ts:309-332; FirefoxCookies.ts:4-8). What the keychain prompt shows for an unsigned
  Birdbrain is not verified (SECURITY.md:60).
- **Provenance.**
  - No Persona field is signed yet. #1498 (open) adds them, and the `personas` row keeps only
    `last_import_at` and `last_import_count` (`src/shared/types.ts:288-295`).
  - Recording the source kind and browser on the row needs a migration, which is blocking tier
    (assessment:246).
  - Sign a seed field only if #543 wants it, and ship it with both verifiers in #1498's release
    (ADR-0032:138-140).
  - The field should state what Birdbrain last loaded (ADR-0032:74-75) and never the profile name
    or the site list (Sources.ts:533-546).
- **D7.** Browser import becomes a second source for option (a) (spec, "Cookie seeding from the
  Persona import"). The source browser and the Persona's launched browser must both be closed
  (spec, same section, on an import while the launched browser runs). S3 (spec, "What each
  Capture in a launched browser must prove") needs a per-site exception. The key-store paragraph
  (spec, "Browser profiles per Persona") assumes the #414 warning covers the partition, which the
  fuse default puts in doubt until ruling 73's check runs.
- **Evidence-affecting.** The importer alone follows the precedent of phase 1, which was not
  evidence-affecting (plan:96-97). `src/main/services/persona/**` is on neither tier list. Once
  #1499 renders through the partition, the seeded session shapes what a target serves, so it
  should be added. A signed field, the verifiers, and the migration are blocking tier; the fuse
  change is advisory (assessment:61-71, 229-246, 268).

## Options

1. **Full port.** Costs:
   - Three new dependencies.
   - A rewrite off Effect and node:sqlite (ChromiumCookies.ts:16-25).
   - Keeping the T3 Tools MIT notice (t3code `LICENSE:1-3`).
   - Breaking Persona isolation.
   - On Windows it adds only Firefox and Helium.
2. **Firefox first, then Chromium on macOS and Linux, chosen site by site, with file import as the
   fallback.**
   - Firefox adds no dependency.
   - Chromium needs the two key readers. The alternative, `/usr/bin/security`, makes the prompt
     name `security` as the program asking (ChromiumKeys.ts:88-92).
   - The host columns are plaintext, so listing sites needs no key. Filtering in SQL means
     cookies the Operator did not pick are never decrypted.
   - Firefox values still pass through the temporary copy (ChromiumCookies.ts:243-249;
     CookieDatabase.ts:87-100).
3. **File import only, plus the extension route the plan already pins.** `chrome.cookies.getAll`
   filters by domain and runs inside Chrome
   ([Chrome extensions cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies);
   plan:197-200). Whether App-Bound Encryption affects it is not verified. Costs: the Operator
   exports cookies by hand, and the extension needs a permission that draws store review.

## Recommendation

Option 2, Firefox first:

- No sites are ticked by default.
- Whole-profile import only when the Operator says the source profile is used for this Persona
  alone.
- Tell macOS users to pick Allow, not Always Allow.

Ship none of it before the at-rest problem is fixed. Never work around App-Bound Encryption;
ADR-0034 likewise works within Chrome 136's refusal of remote debugging on the default profile
(ADR-0034:57-60).

## Maintainer rulings (2026-10-10)

**Ruling 72 adopts option 2.**

- Birdbrain detects installed browsers. Firefox comes first, with no new dependency, then Chromium
  on macOS and Linux.
- The Operator selects sites one by one, with none ticked by default. The importer filters in SQL,
  so it never decrypts a cookie the Operator did not pick.
- A whole-profile import is offered only when the Operator states that the source profile serves
  this Persona alone.
- Cookie files stay as the fallback.
- Birdbrain never works around App-Bound Encryption, so Chrome and Edge on Windows stay
  file-only.
- Birdbrain tells macOS users to pick Allow, not Always Allow.
- The ruling needs an ADR amending ADR-0030 (:47-54, :62-65), the persona plan (:85-87, :187-189,
  :197-200), ADR-0034 (:75-77), and the spec's S3 and seeding section; a new ticket under #541,
  grilled before it is `ready-for-agent`; and updates to #546, #543, and #1498.

**Ruling 73 sets the at-rest condition.**

- The roadmap's CE-AR brief checks on a running build whether Persona partition cookies are
  encrypted at rest.
- If they are not, CE-AR corrects ADR-0030's at-rest sentence, persona plan decision 8, and the
  `personaSessions.ts` comment to state what is true.
- Enabling the `cookieEncryption` fuse stays its own change (#88).
- No browser import ships before the wording is true. The recommendation's "fixed" could have
  meant turning the fuse on; the ruling asks for true wording and leaves the fuse to #88.

Still open after the rulings: which key readers the Chromium phase uses, a dependency decision.
On macOS the choice is a keychain binding or `/usr/bin/security`; on Linux it is a `libsecret`
helper built for each architecture.

## Follow-ups

This research filed nothing. Ruling 72 names the ADR, the new ticket, and the issue updates; the
rest is the research's own list.

1. Write an ADR that amends:
   - ADR-0030:47-54 and 62-65
   - plan:85-87, 187-189, and 197-200
   - ADR-0034:75-77
   - the spec's S3 and seeding section, which state the ruling since 2026-10-10
   - when the code ships: `CONTEXT.md:41-43, 324-325` and SECURITY.md:26-31, 56-63
2. Run ruling 73's check on a running build. If the partition cookies are not encrypted, correct
   ADR-0030's at-rest sentence, plan decision 8 (:58-61), and the `personaSessions.ts` comment.
   #88 already tracks the fuse.
3. Issue updates:
   - #546 gains the import threats.
   - #543 gains the question of whether to disclose the seed source.
   - #1498 decides whether the seed field ships in its release.
   - A new ticket under #541, to be grilled before it is `ready-for-agent`.
4. Roadmap and spec changes:
   - Add a row for the Chromium key-reader dependencies to the table "Decisions and approvals
     the maintainer owes" in the roadmap. Import scope and the choice between fixing the fuse and
     fixing the wording are ruled.
   - Step 5 of the spec's proposed PR split leaves the browser import out and names the new
     ticket under #541 that builds it, as ruling 72 routes the build. The spec's seeding section
     and S3 carry the browser as a cookie source, the S3 exception, and the rule that both
     browsers are closed, and the roadmap's CE-A brief records the ruling.

## Not verified

- Whether imported Google cookies trigger Google's stolen-cookie detection or fail under Device
  Bound Session Credentials (Google).
- Whether any law or terms of service forbid reading the same user's cookie store. This research
  cannot verify it.
