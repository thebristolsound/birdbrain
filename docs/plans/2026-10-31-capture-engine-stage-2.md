# Capture engine stage 2: the launched browser, Personas and passive capture

**Status:** active, approved by the maintainer on 2026-11-01

Written 2026-10-31 against `origin/main` at 5684efd0 and PR #2029, from a readiness pass with one
reader per step and two adversarial checks of the draft. This plan carries out the current
programme in `docs/plans/2026-10-23-delivery-roadmap.md` and the "Proposed PR split" of
`docs/specs/2026-10-10-capture-engine-launched-browser-design.md` (called "the spec" below,
approved in #1804). "Probe" means
`docs/specs/2026-10-11-capture-engine-launched-browser-probe-spike.md`. Every status below comes
from GitHub or `origin/main` as read on that date. When another plan says "after X", this plan does
not count X as done. The spec says the stage 2 plan waits for approval (spec :1533-1534), and every
code step touches the blocking tier, so ADR-0016 does not let a session run this plan's code steps
on its own say; step 2 runs as a draft that merges only on the maintainer's review.

## Goal

Ship the launched browser with clicked and passive Captures (#1832, #600) and a browser profile
per Persona (#1833). Finish `docs/plans/2026-09-19-persona-cookie-import.md` with phases 2, 3, 5
and 6 rewritten around the launched browser. Phase 4 (#1500) moves to the stage 3 Companion pipe.
The programme is done when passive capture and Personas ship in a packaged build and the Persona
plan reads `**Status:** done`.

## What exists today

- The first slice has shipped. CE-10 merged as #1917 (closes #598). CE-3 Egress merged as #1896
  (closes #1695). CE-7 merged as #1911, #1979 and #1999, and CE-8 as #1996 and #2000, with the
  package halves in #1984. All of it is in `v1.0.1-beta.25`, released 2026-10-31.
- The schema 6 verifier (#1978, #1981) is in `v1.0.1-beta.24`. `MANIFEST_SCHEMA_VERSION = 6` at
  `src/shared/constants.ts:111`. `src/shared/schemas.ts` has no `persona` field, and no `launched`
  value exists in `src/`. The next free number is 7.
- The Linux probe merged as #1842 (18aa728b). It has an entry for every P question, measured on
  Chrome 150 and Chrome for Testing 149 on Ubuntu 24.04 under WSL2 (probe :22-24, :41-49). Edge,
  Brave, Chromium, Windows and macOS are unmeasured (probe :5-7, :52-56).
- #1839 (fdfde973) merged ADR-0051 (a launched record holds no request body, Accepted), which is
  the ADR the ruling on decision D3 needs before step 4, and the ADR-0037 amendment for D13. It
  closed #1829.
- The designer's UI brief (#1825) is closed, and the panel mock and its feasibility assessment
  merged in #1851 (273ecd2d). The assessment rates the panel "Modify (L)" (assessment :131-165),
  and no revised mock is in `docs/design-handoff/`.
- The spec records every decision except D18 as ruled on 2026-10-10 (:1346-1347, :1354-1433).
- On 2026-10-17 the maintainer ruled on #1828 ([comment][c1828]) that durable messages are ruled
  out and that the launched browser blocks the password leak check as well as the save offer.
  Neither ruling has reached the spec or #1831, #1832 and #1833.
- On 2026-10-31 the maintainer ruled that the Persona fields raise the schema number
  ([comment on #1498][c1498]). The ADR-0030 amendment that records it merged in #2029 on
  2026-11-01.
- CE-AR's check merged as #1841, and ADR-0052:166-167 records the at-rest condition as met. Its
  issue, #1824, stays open for two Settings questions (question 10).
- #1726 (`localAddressPolicy.ts`), #1512 (MemoryTransport, so #600's two-peer test is now
  required) and #545 (the bot-detection probe) are closed.
- Step 2 is open as #2031 and awaits the maintainer's review. None of the stage 2 issues carries
  `queued`.
- Some records are stale:
  - The spec's status line (:5) still reads "awaiting approval", though #1804 merged approved.
  - Three places still put the Persona fields under CE-5's number or say "no schema bump": spec
    step 2 (:1279-1283), the briefs plan (:49-50, :83), and Persona plan decision 9 (:73-77). The
    Persona plan's header (:4-5) reads "not yet scheduled" and has no `**Status:**` line.
  - #1830, #1831, #1832 and #600 cite line numbers that have moved and describe merged work as
    unfiled.

[c1828]: https://github.com/thebristolsound/birdbrain/issues/1828#issuecomment-6229202489
[c1498]: https://github.com/thebristolsound/birdbrain/issues/1498#issuecomment-6553134700

## Rulings, 2026-10-31

The maintainer ruled on the shape of schema 7 in the session that wrote this plan.

1. The Persona fields raise the manifest schema number (ADR-0030 as amended in #2029).
2. Schema 7 drops the "tab not visible" reason: the probe found Chrome screenshots a tab that is
   not in front, so no writer would produce it. A later number adds it if another browser needs it.
3. Schema 7 drops "loaded speculatively": pre-rendering is off while Birdbrain drives the browser,
   and a prefetch records as an ordinary exchange. "Served by a service worker" becomes an integer
   count of such exchanges, not a reason the record is missing.
4. Request bodies the launched browser withholds (ADR-0051) are a count on the signed entry. The
   WARC's request records show which requests they were; no request identifier or URL enters the
   Manifest.
5. Schema 7 carries `personaId` and `personaLabel` only. A seed-source field takes a later number
   once ADR-0052 is accepted and #543 decides disclosure.
6. The Persona verifier fields and the launched-browser verifier fields go in one PR that moves
   the number from 6 to 7.
7. #1830 no longer waits on #1828. The open P3 question changes how pages are read, not what the
   record holds, and the answers step 2 needs merged in #1842.

The maintainer ruled the same day on six points the step 2 review raised:

8. The browser family list keeps a fifth value, `chrome-for-testing`, beside `chrome`, `edge`,
   `brave` and `chromium`, because D23 treats Chrome for Testing apart from branded Chrome.
9. The report gains one sentence for each new absence reason in the step 2 PR, though #1830 said
   the report stays unchanged: the reason-to-sentence map must be complete to typecheck.
10. The verifier refuses a passive rule unless the method is `launched-passive` or `duplicate`.
11. A passive Capture's missing Scroll-to-load is stated by leaving its record out; schema 7 adds
    no Scroll-to-load absence reason.
12. The verifier accepts the Persona fields on an exhibit entry whatever its origin; the writer
    holds the three-origin rule of ADR-0030.
13. The step 2 PR corrects the Transaction Record glossary entry to say the inventory counts
    withheld request bodies.

## Rulings, 2026-11-05

The maintainer ruled on the open gates and questions in an interactive session on 2026-11-05.
Between this plan and these rulings, #2031 (step 2) merged on 2026-11-02, #2051 merged #1498's
writer half on 2026-11-03, #2046 folded the probe's attach findings into the spec, #2053 added the
Chromium 154 probe rows and a working P3 control, #2037 merged CE-4, and #2056 merged step 3's code
on 2026-11-04. #1831 stays open for the designer's review and its hand-run statements.

1. **P3.** The capture engine may enable the `Page` domain and read from isolated worlds. The
   basis is the `Runtime.enable` detector on Chromium 154 that #2053 added: it detects
   `Runtime.enable` and saw nothing for `Page.enable` or isolated-world reads.
2. **P7.** Clicked Captures (#1832) do not wait for a macOS pipe run. The pipe passed on Windows on
   2026-11-03 for Chrome, Edge and Brave 156 ([comment on #1828][c1828p7]). Birdbrain does not
   offer the launched browser on macOS until a macOS run and the known-answer validation pass
   there.
3. **The no-VPN warning in the start dialog.** The session warning folds into the start dialog, as
   the designer drew it in `1c`
   (`docs/design-handoff/2026-11-04-launcher-build-review/DESIGN_REVIEW.md:31`).
   A "Set up a proxy" link and a "Stop warning on this network" checkbox go under the no-VPN line,
   and **Launch** acts as Continue. The separate warning dialog stays for Recapture, add-URL and
   Wayback. #2065's description records the same ruling.
4. **A Duplicate of a Persona Capture** carries the source's Persona id and label, on its signed
   entry and on its row.
5. **A Persona Capture received into a Shared Case** fills both `persona_id` and `persona_label` on
   the receiver's row from the signed entry.
6. **The Linux fixed-key fallback** (probe P16). When a launch reports that a launched profile fell
   back to the fixed-key store on this machine, the Persona's row in Settings shows one warning
   line. Nothing shows otherwise.
7. **`src/main/services/persona/**` stays advisory.** It does not join the blocking tier.
8. **#1499's sign-in window is dropped.** The cookie import is the only way to seed a Persona's
   in-app session. #1501's re-seed action points at the import.
9. **#600 and #599** move to ready-for-agent once #1832 merges, and are built with the maintainer's
   evidence review. #1500 comes off ready-for-agent until stage 3.
10. **#1824's remainder.** The warning that cookies sit on disk unencrypted shows on every machine.
    The PR proposes new hover text to replace "Checking whether the cookie store is protected", for
    the maintainer to accept at review, and corrects the seven places the at-rest assessment lists.
11. **#1498 closes.** The rule that puts a Persona on an exhibit entry becomes an acceptance
    criterion of whichever future change first adds an exhibit writer for the `extension`,
    `background` or `extension-image` origin. The Persona plan records it.
12. **#543 (export disclosure).** An agent drafts it from the spec's wording table
    (`docs/specs/2026-10-10-capture-engine-launched-browser-design.md` around :1090-1099) and
    ADR-0030, lists the open choices with a recommendation for each, and waits for the
    maintainer's explicit yes before building.
13. **#1831's hand-run checks are agent work.** An agent launches branded Chrome, Edge and Brave on
    the maintainer's Windows machine and reports each version. On this Linux host an agent checks
    the Wayland pop-out and the keyboard shortcut (P17) on the live Hyprland desktop; key injection
    into the live desktop is allowed for these checks.
14. **The CI job for the known-answer suite** goes in its own PR, which states the estimated CI
    minutes per run in its description and stops for the maintainer's review, because it changes
    `.github/workflows/` (ADR-0048).
15. **#1828 closes after one more Windows pass.** An agent on the Windows machine measures the
    Windows rows it can. One follow-up issue then takes macOS, Linux Edge, regular Brave, Snap and
    Flatpak, and #1828 closes.

[c1828p7]: https://github.com/thebristolsound/birdbrain/issues/1828#issuecomment-6615435372

## Order of work

Every code step except CE-4 (#1696) and #1501 is evidence-affecting at the blocking tier, so the
maintainer reviews and merges each one. Dispatch runs two slots, counted as open `agent-pr` PRs
plus live `agent-wip` claims (ADR-0045:40-41), and the roadmap gives slot 2 to the defect lane;
a PR from an interactive session takes no slot. Only one migration PR may be open at a time. A
tagged release whose verifier reads a field ships before any writer of that field merges
(ADR-0023).

### Step 1: the probe (#1828, docs only)

The Linux answers the code steps need are already merged in #1842. #1828 stayed open for P3 and for
the browsers and platforms nobody has measured. Whether step 1's done criterion (spec :1266-1271)
is met is not settled: the probe lists Edge, Brave and Chromium as "not installed" rather than "not
measurable" (:52-56), and this host has `/usr/bin/chromium` 154 and Brave Origin 155.

The agent work left in this step:

- Measure the Chromium rows on Linux with `--probe-browser`.
- Build a P3 control that does detect `Runtime.enable`, then rerun the `Page` and isolated-world
  variants with it.
- Add a Hyprland row for P17. Ask Matt first, because the probe injects keys into the live
  desktop.
- Draft a follow-up issue for the remaining rows.

Since 2026-11-05: #2053 measured the Chromium 154 rows and built a P3 control that works, and
ruling 1 of 2026-11-05 settled P3 on it. Ruling 13 allows the P17 Hyprland check with key
injection, and ruling 15 closes #1828 after one more Windows pass and a follow-up issue.

No document states the browser floor version (spec :311-312). The oldest build the probe passed
on is Chrome for Testing 149.0.7827.55 (probe :43-44).

### Step 2: the verifier at schema 7 (#1830 with #1498's verifier half)

One PR adds:

- The methods `launched` and `launched-passive`. `companion` stays out until stage 3, and
  `persona-window` stays rejected.
- The browser product, version and family.
- A passive rule enum that carries no Selector data.
- The cache-disabled flag (D6).
- The stage 2 inventory: the reasons that stay after rulings 2 and 3 in enums of their own, not
  added to `INVENTORY_ABSENCE_REASONS` (`types.ts:108`), and the two counts from rulings 3 and 4.
- `personaId` and `personaLabel` on capture and exhibit entries.

Each new value gets a refine that requires schema 7 and a stamp in `fieldMinReaderSchemaVersion`
(`manifest.ts:1022-1052`). The step also moves the five ceiling assertions from 6 to 7 and adds a
frozen-digest test. It merged as #2031 (6c488f05) on 2026-11-02. The next tag after it is the
release carrying schema 7, which the maintainer delegated to the orchestrating session in a
message on 2026-11-05, apart from the rulings; it gates steps 4 to 6 and every Persona writer.

### Step 3: launcher, profiles and Egress, with no Capture (#1831)

Its code merged in #2056 on 2026-11-04, built from the designer's 2026-11-01 revision, after CE-4
(#1696) merged in #2037. #1831 stays open for what #2056 did not deliver:

- The designer's review of the build, which merged in #2065. Its Change verdicts, ruling 3 of
  2026-11-05 among them, go in a follow-up change.
- The hand-run statements, which agents take under ruling 13.
- The CI job for the known-answer suite, which goes in its own PR under ruling 14.

The scope includes the D23 Chrome for Testing download script (no such script exists under
`scripts/`) and a SOCKS5 fixture proxy. The probe contradicts three of #1831's validation criteria
(probe :854-864): the `unshare -rn` wrapper, the IPv6 UDP sockets and the Unix singleton socket.
This host has Chromium 154 and Brave Origin 155. Branded Chrome and Edge are absent, so the D23
manual runs against them need another machine or a sudo install.

### Step 4: clicked launched Captures (#1832)

This step builds inside step 3's module, which merged in #2056. It can merge only after the schema
7 release (spec :1288-1290). ADR-0051, the D3 ADR it needs, is accepted. Its two hard gates are
ruled:

- P7 passed on Windows on 2026-11-03, and ruling 2 of 2026-11-05 lets step 4 go without a macOS
  run; Birdbrain does not offer the launched browser on macOS until one passes.
- P3 is settled by ruling 1 of 2026-11-05: step 4 may enable `Page`.

#2046 folded the probe's contradictions of the step 4 design into the spec (probe :788-809,
:858-864):

- Setup commands must be sent with the resume.
- Tabs opened by Ctrl-click or middle-click miss their first request.
- The service worker attaches twice.
- Shared workers belong to no tab.

The spec gates step 4 on the feasibility pass only (:1304-1306), and the designer's revision
landed in #2043.

### Step 5: a profile per Persona (#1833) and Persona phases 2, 3 and 5

- **#1498 (phase 2) split in two.** Its verifier half merged in step 2 (#2031), and its writer
  half, with DB migration 45, merged in #2051. Rulings 4, 5 and 11 of 2026-11-05 give the
  Duplicate and received-row cases their own change, which merges before any caller passes a
  Persona, and close #1498.
- **#1833 waits** on the schema 7 release and on that change; #1831's code, #1830 and #1829 are
  done. It can merge before #1832 and leave the stamp wiring to it (#1833, "Order and lanes"). It
  adds the leak-check block from the 2026-10-17 ruling, and rulings 6 and 7 of 2026-11-05 settle
  its warning line and its tier.
- **#1499 (phase 3)** keeps the Electron partition for background Recapture and add-URL only (spec
  :97-98, ADR-0034:93-96). #545 is closed and #1498's writer half has merged. Ruling 8 of
  2026-11-05 drops its sign-in window, so the cookie import is the only way to seed the partition.
  Its anchors are stale: `RenderPage` is now at `recapture.ts:81`.
- **#1501 (phase 5)** counts cookies per store and is not evidence-affecting. Its body says it is
  blocked by #1499. For a launched profile, the count and the expiry come from the import result,
  because S2 (spec :186-187) forbids reading cookie values from the launched browser.
- **#1628** (the orphan sweep deletes Persona sign-ins) is in the same sweep that #1831 and #1833
  extend. It is labelled ready-for-human.

### Step 6: passive capture (#600 with #599)

Passive capture waits for step 4 (spec :1326) and for the schema 7 release (D5). The ADR-0037
amendment is already merged. #2052 moved the Selector matcher into a shared module, made the safe
regex report a timeout apart from no match, and added the module to the evidence-affecting paths
at the blocking tier. #2045 added the D18 glossary entries. Under ruling 9 of 2026-11-05 both
issues move to ready-for-agent once #1832 merges, and are built with the maintainer's evidence
review.

### Persona phases 6 and 4

- **#543** (export disclosure, in wayfinder:grilling) takes the `launched` wording (D11) and the
  seed-source question from ADR-0052. Under ruling 12 of 2026-11-05 an agent drafts it and waits
  for the maintainer's yes before building.
- **#546** takes the threat-model change, which ships with the code that makes it true (spec
  :1534-1535).
- **The tester guide** has no issue yet.
- **#1500 (phase 4)** becomes the declared Persona on a stage 3 `companion` Capture and leaves this
  programme. Its body says it is blocked by #1498. Ruling 9 of 2026-11-05 took it off
  ready-for-agent until stage 3.

## Lanes and hot files

- **Manifest schema lane.** #2031 took schema 7. #586 waits on design approval (roadmap ruling of
  2026-10-26), and nothing else holds a number.
- **Migration lane.** #2051 took DB 45. #1833 and #1501 may need a `personas` row migration, which
  takes DB 46.
- **`settings.ts`.** #1696 and #1831's code have merged (#2037, #2056).
- **`manifest.ts`, `schemas.ts`, `src/shared/verify/**` and `src/verifier/**`.** Step 2 only.
- **`captureLifecycle.ts`.** #1498's writer half merged in #2051; #1832, then the Duplicate and
  received-row change, then #600, hold it next.
  Every earlier holder in the briefs plan's order has merged, CI-4 as #1855.
- **`selectorRepo.ts` and `safeRegex.ts`.** Done in #2052.

## Gates the maintainer owes

| Gate | Blocks | Who clears it | Status | Evidence |
| --- | --- | --- | --- | --- |
| Approve this plan | Code steps 3 to 6 | Maintainer | cleared 2026-11-01 | Status line above |
| Review and merge #2031 (step 2) | The schema 7 release | Maintainer | cleared 2026-11-02 | Merged as 6c488f05 |
| Designer revision before steps 3 and 4 (Q2) | Steps 3, 4 | Maintainer, then designer | cleared 2026-11-03 | #2043; the designer reviewed the build in #2065 |
| P3: may the engine enable `Page` (Q3) | Step 4, so step 6 | Maintainer | cleared 2026-11-05 | Ruling 1 of 2026-11-05; #2053 |
| Fold the probe contradictions into the spec (Q4) | Step 4 | Maintainer | cleared 2026-11-03 | #2046 |
| P7 pipe on Windows (Q5) | Step 4, so step 6 | Hardware: a maintainer run | cleared 2026-11-03 | [c1828p7][c1828p7] |
| P7 pipe and known-answer validation on macOS (Q5) | Offering the launched browser on macOS; not step 4 | Hardware: a macOS run | open | Ruling 2 of 2026-11-05 |
| Edge, regular Brave, Snap and Flatpak rows (Q5) | #1828 closure; branded manual checks | Agent on the Windows machine, then a follow-up issue | ruled 2026-11-05 | Rulings 13 and 15 of 2026-11-05 |
| Tag the schema 7 release | Merges of steps 4 to 6 and Persona writers | Maintainer; delegated to the orchestrating session on 2026-11-05 | open | Spec :1288-1290; newest tag `v1.0.1-beta.25` predates 6c488f05 |
| `queued` on the stage 2 issues | Unattended dispatch only | Maintainer | open | Labels read 2026-10-31 |
| #600 and #599 moved to ready-for-agent (Q9) | Dispatch of step 6 | Maintainer | ruled 2026-11-05: after #1832 merges | Ruling 9 of 2026-11-05 |
| Duplicate and Shared Case Persona rows | First caller that passes a Persona | Maintainer | cleared 2026-11-05 | Rulings 4 and 5 of 2026-11-05 |
| v10 key-store warning (Q8) | #1833 | Maintainer | cleared 2026-11-05 | Ruling 6 of 2026-11-05 |
| Persona tree in the blocking tier (Q8) | #1833 | Maintainer | cleared 2026-11-05: stays advisory | Ruling 7 of 2026-11-05 |
| #1499's sign-in window, and its block on #1498 (Q7) | #1499, then #1501 | Maintainer | cleared 2026-11-05: window dropped | Ruling 8 of 2026-11-05; #2051 merged the writer |
| D18 glossary | #600's CONTEXT.md part | Maintainer | cleared 2026-11-03 | #2045 |
| CI job for the known-answer suite (ADR-0048) | #1831 sign-off | Maintainer | open: its own PR, for review | Ruling 14 of 2026-11-05; #2056 description |
| #1824 remainder (Q10) | Persona Settings copy | Maintainer | cleared 2026-11-05; the hover text waits on review | Ruling 10 of 2026-11-05 |
| #543 disclosure draft | Building #543 | Maintainer | open: an explicit yes on the draft | Ruling 12 of 2026-11-05 |
| ADR-0052 accepted, key-reader dependency chosen | Browser cookie import only | Maintainer | open | ADR-0052:3, :168-171 |

The P7 macOS row is the only gate left that needs hardware this machine lacks, and since ruling 2
of 2026-11-05 it gates offering the launched browser on macOS, not a step. The Windows and macOS
rows of the other P questions, and the macOS keychain rows for P14 to P16, are also unmeasured,
but no step waits on them.

## Work an agent can start now

Since 2026-11-05 an orchestrating session runs the remaining work; its slices, the next command
and the open questions are in `docs/plans/2026-11-05-stage-2-orchestration-handoff.md`.

## Open questions

1. Can #1831 drop "Blocked by #1828", as #1830 now has? Recommended: yes, citing #1842, because
   step 3 reads only network events.
   Settled: #1831 built and merged its code in #2056 without waiting on #1828.
2. The assessment asked the designer to revise the found-browsers list, the start dialog, the panel
   rail below about 1,020 px, the Wayland pop-out, the shortcut-failure state and three state
   messages. Should steps 3 and 4 build from the 2026-10-12 mock with the assessment's constraints,
   or wait for the revision? Sending the revision request is the maintainer's job.
   Settled: #1831 built from the 2026-11-01 revision (#2043), and the designer reviewed the
   build in #2065. Ruling 3 of 2026-11-05 takes one of its changes.
3. The probe saw no page-visible change when the engine enabled `Page` or read from an isolated
   world. Its debugger-detection check failed its own control, though. Is that enough to enable
   `Page`, or should an agent first build a check that works and rerun the probe?
   Ruled 2026-11-05 (ruling 1): yes, on the working control #2053 added.
4. Should the probe's contradictions of the step 4 design be ruled on and folded into the spec
   before step 4 starts? They cover setup commands sent with the resume, Ctrl-click and
   middle-click tabs, double service-worker attaches and shared-worker ownership.
   Settled: #2046 folded them into the spec.
5. Who measures the pipe (P7) on Windows and macOS, and when? This machine has Brave Origin rather
   than regular Brave: does a Brave Origin measurement count for the Brave rows, and should Edge
   and regular Brave be installed?
   Ruled 2026-11-05 (rulings 2, 13 and 15): the maintainer measured P7 on Windows on
   2026-11-03, step 4 does not wait for macOS, and agents measure the remaining Windows rows
   before a follow-up issue takes the rest.
6. Should an agent land the timeout-aware safe-regex change and the move of the Selector matcher
   now, as a refactor that changes no behaviour, instead of inside #600? Recommended: split it
   out now, because it depends only on CE-10.
   Settled: #2052 shared the Selector matcher and made regex timeouts reportable.
7. Should #1499 keep its own "Sign in as persona" window, or should the cookie import be the only
   way to seed the in-app store? May its plumbing start before #1498's writer half merges?
   Ruled 2026-11-05 (ruling 8): the cookie import is the only way; the window is dropped.
   #2051 merged the writer half, so the block on #1498 no longer holds #1499.
8. On Linux, a launched profile falls back to Chromium's fixed-key store when the keyring is locked
   (probe P16). Should the Persona screen warn about this, and where? Should
   `src/main/services/persona/**` join the blocking tier once a Persona's cookies shape a Capture?
   Ruled 2026-11-05 (rulings 6 and 7): one warning line on the Persona's row when a launch
   reports the fallback, and the Persona tree stays advisory.
9. Should #600 and #599 move to ready-for-agent once step 4 merges, or should a human build them?
   Should #1500 come off ready-for-agent until stage 3?
   Ruled 2026-11-05 (ruling 9): ready-for-agent once #1832 merges, with the maintainer's
   evidence review; #1500 comes off ready-for-agent until stage 3.
10. Should the #1824 warning that cookies sit on disk unencrypted show on every machine, and what
    replaces the hover text "Checking whether the cookie store is protected"?
    Ruled 2026-11-05 (ruling 10): every machine; the PR proposes the hover text for review.
