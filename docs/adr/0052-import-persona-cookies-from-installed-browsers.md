# Birdbrain imports a Persona's cookies from installed browsers, site by site

**Status:** Proposed

**Date:** 2026-10-17

Amends [ADR-0030](0030-persona-is-a-provenance-axis-beside-operator.md) (its "Three mechanisms,
one attribute" and "No secrets beyond the browser session" paragraphs) and
[ADR-0034](0034-the-app-acquires-and-the-extension-is-a-companion.md) (its paragraph "Background
Captures stay in Electron's hidden window"), together with the
[persona cookie import plan](../plans/2026-09-19-persona-cookie-import.md) and
[the stage-2 spec](../specs/2026-10-10-capture-engine-launched-browser-design.md). The source is
the maintainer's ruling 72 of 2026-10-10, which adopted option 2 of the
[browser cookie import research](../specs/2026-10-10-browser-cookie-import-research.md); the
research states the ruling under "Maintainer rulings (2026-10-10)". The record itself awaits
acceptance, which changes the status line. Nothing in it is implemented. Part of #541; the issue
for this record is #1901.

## Context

A Persona's browser sessions get their cookies from an import or a sign-in. ADR-0030 seeds the
Persona's Electron partition by cookie-file import or by a sign-in window. Ruling 43 (decision D7
of the stage-2 spec) seeds the partition and the launched browser's profile from the same
import. The importer reads a Netscape `cookies.txt` file or a JSON array and refuses a
browser's cookie database (persona plan, "Supported cookie formats"; `readCookieFile()` in
`src/main/services/persona/cookieFiles/index.ts`). The Operator therefore exports cookies by
hand from the browser where the identity is signed in.

While ruling on D7, the maintainer asked that Birdbrain detect the browsers installed on the
machine and import cookies from them, as the t3code app does. The research read t3code's importer
at commit `febe1b24`. It lists nine browsers, refuses to import while the source browser runs,
copies the cookie database into a temporary directory, and imports the whole profile with no
domain filter. Its only consent is the operating system's prompt, and Firefox and Linux v10
Chromium rows raise no prompt at all.

The research found what each platform allows ("Platform by browser"):

- Firefox stores cookie values as plaintext, and `better-sqlite3`, which Birdbrain already has,
  reads them. Firefox holds an exclusive lock on its cookie database while it runs.
- Chromium browsers on macOS keep the cookie key in the keychain. Reading it raises a dialog that
  offers Deny, Allow, or Always Allow, and Always Allow trusts the app permanently.
- Chromium browsers on Linux get the key from the Secret Service through `libsecret`, and v10
  rows need only a fixed passphrase. On KDE the key sits in `KWallet`, so v11 rows there are
  likely lost.
- Chrome and Edge on Windows use App-Bound Encryption since version 127, and t3code refuses
  those stores.

The earlier records exclude most of the import and defer the rest. The persona plan lists
Chrome's `Cookies` database as "no", Firefox's `cookies.sqlite` as "later", and a whole browser
profile as "no", and its out-of-scope list names "Chrome `Cookies` DB decryption" and
"mounting browser profiles". ADR-0030 says the only copy of a cookie value is Chromium's own
store for the session.

Ruling 73 holds the import back until the at-rest wording is true. The
[Persona cookies at-rest assessment](../specs/2026-10-11-persona-cookies-at-rest-assessment.md)
(#1824, PR #1841) found on 2026-10-11 that a running build stores a Persona's cookie values as
plain text, because Electron's `EnableCookieEncryption` fuse is off, and corrected ADR-0030's
wording to say so, which meets the condition. Turning the fuse on stays #88.

## Decision

**Birdbrain detects the browsers installed on the Operator's machine and imports a Persona's
cookies from them.** A browser import is a second source for the one Persona import that seeds
both the Electron partition and the launched browser's profile (ruling 43). Firefox comes first,
with no new dependency. Chromium browsers on macOS and Linux follow.

**The Operator picks sites one by one, and Birdbrain ticks none by default.** The source
database stores each cookie's host as plaintext, so Birdbrain lists the sites without reading a
key. Birdbrain's reader filters by host in its SQL query, so the query returns only the rows of
the hosts the Operator picked. A cookie for any other host never reaches the decryption step,
and Birdbrain never decrypts a cookie the Operator did not pick.

**A whole-profile import needs the Operator's statement.** Birdbrain offers to import every cookie
in a source profile only when the Operator states that the source profile serves this Persona
alone. Without that statement, a whole-profile import could put the Operator's own signed-in
sessions into a Persona (the research, "What adopting it changes").

**Cookie files stay as the fallback.** The Netscape and JSON imports stay for every browser and
platform the browser import does not cover.

**Birdbrain never works around App-Bound Encryption.** Chrome and Edge on Windows stay file-only.

**On macOS, Birdbrain tells the Operator to pick Allow, not Always Allow,** in the keychain
prompt. Always Allow would give Birdbrain a lasting grant to that browser's key.

**What the ruling leaves open.**

- Which key readers the Chromium phase uses is a dependency decision the maintainer has not made.
  On macOS the choice is a keychain binding or `/usr/bin/security`, which makes the prompt name
  `security` as the program asking. On Linux it is a `libsecret` helper built for each
  architecture.
- The ruling settles neither whether the browsers must be closed during an import nor how the
  importer reads the source database. The stage-2 spec ("Cookie seeding from the Persona import")
  takes both answers from the research. The source browser and the Persona's launched browser
  are both closed. The importer reads a temporary copy of the closed source database, which
  t3code makes with `VACUUM INTO`, and Birdbrain deletes the copy afterwards.

## What this amends

**ADR-0030.** In "Three mechanisms, one attribute", a sign-in window or a cookie import seeds the
Persona's Electron session, and the import reads a cookie file or an installed browser. In "No
secrets beyond the browser session", Birdbrain reads a temporary copy of the closed source
browser's cookie database in a browser import and deletes the copy afterwards. Until then the
copy holds the cookie values of every site in the source profile, as plaintext for a Firefox
source. Passwords are still never stored.

**ADR-0034.** In "Background Captures stay in Electron's hidden window", the cookie import that
seeds both of a Persona's browser sessions reads a cookie file or an installed browser.

**The persona plan.** The Firefox, Chrome `Cookies`, and whole-browser-profile rows of "Supported
cookie formats", the "Out of scope" list, and the extension-seeding item under "Pinned, not
decided".

**The stage-2 spec.** S3 and "Cookie seeding from the Persona import" have stated the ruling since
2026-10-10. They now link this record, and the seeding section records that the at-rest wording
is true.

## Considered options

The research compared three options under "Options"; the ruling adopted the second.

- **Port t3code's importer whole (option 1).** Rejected: it adds three dependencies, needs a
  rewrite off Effect and `node:sqlite`, and carries the T3 Tools MIT notice. It imports every
  cookie in a profile with no domain filter, which breaks Persona isolation. On Windows it adds
  only Firefox and Helium.
- **File import only, plus the extension route the plan pins (option 3).**
  `chrome.cookies.getAll` filters by domain and runs inside Chrome. Not adopted: the Operator
  keeps exporting cookies by hand, and the extension needs a permission that draws store review.
  Whether App-Bound Encryption affects this route is not verified.
- **Import every cookie in the source profile by default.** Rejected: it would import the
  Operator's own identity into a Persona (the stage-2 spec, "Alternatives rejected").
- **Work around App-Bound Encryption on Windows.** Rejected by the ruling. The research's
  recommendation compares it with ADR-0034, which works within Chrome 136's refusal of remote
  debugging on the default profile directory instead of working around it.

## Consequences

- On Windows, Firefox is the only browser-import source. The ruling names Chromium on macOS and
  Linux only, and Chrome and Edge on Windows stay file-only.
- On KDE, Chromium v11 rows are likely lost, because the key sits in `KWallet`.
- For a Chromium source, the SQL filter keeps every cookie the Operator did not pick encrypted.
  For a Firefox source, the filter decides which cookies Birdbrain loads, but Firefox stores
  values as plaintext, so the temporary copy holds every site's values until Birdbrain deletes
  it.
- On Linux and for Firefox, Birdbrain's own dialog would be the only consent (the research,
  "What adopting it changes"). What the macOS keychain prompt shows for an unsigned Birdbrain is
  not verified.
- The research found that the macOS Chrome key probably also decrypts saved passwords, so the
  reader must touch the cookie table and nothing else.
- Imported values land in the partition's `Cookies` database as plain text, as file-imported
  values do, until #88 turns cookie encryption on.
- The importer on its own follows phase 1's precedent and is not evidence-affecting. Once #1499
  renders through the partition, the seeded session shapes what a target serves, and the
  research says `src/main/services/persona/**` should then join the evidence-affecting paths. A
  signed seed field, the verifiers, and a migration that records the source on the `personas`
  row are blocking tier (the research, "What adopting it changes").
- The research lists `CONTEXT.md` and `SECURITY.md` as changing when the code ships, not before.
- Ruling 72 raises a question for each of three open issues:
  - #546 (the Persona threat-model delta) takes the import threats: a lasting grant to another
    app's key if the Operator picks Always Allow, Birdbrain's own dialog as the only consent on
    Linux and for Firefox, the temporary copy, and a whole-profile import that carries the
    Operator's own sessions into a Persona.
  - #543 (export disclosure) takes the question of whether an export discloses the seed source.
  - #1498 (Persona Manifest fields) decides whether a seed field ships in its release. The
    research advises signing one only if #543 wants it, shipping it with both verifiers in
    #1498's release, and having it state what Birdbrain last loaded, never the profile name or
    the site list.
- The build is a new ticket under #541, grilled with the maintainer before it is
  `ready-for-agent`. It is not part of step 5 of the stage-2 spec's proposed PR split. It waits
  for the maintainer to accept this record and for the grilling; the at-rest condition of ruling
  73 is met. Its Chromium phase also waits for the key-reader dependency decision.
- Two questions stay unverified: whether imported Google cookies trigger Google's stolen-cookie
  detection or fail under Device Bound Session Credentials, and whether any law or terms of
  service forbid reading the same user's cookie store (the research, "Not verified").
