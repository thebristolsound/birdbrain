# Capture engine stage 2: the launched browser, Personas and passive capture

**Status:** active, awaiting the maintainer's approval

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
  ([comment on #1498][c1498]). The ADR-0030 amendment that records it is in PR #2029, which has not
  merged, so ADR-0030 on `main` still says "no schema bump" until it does.
- CE-AR's check merged as #1841, and ADR-0052:166-167 records the at-rest condition as met. Its
  issue, #1824, stays open for two Settings questions (question 10).
- #1726 (`localAddressPolicy.ts`), #1512 (MemoryTransport, so #600's two-peer test is now
  required) and #545 (the bot-detection probe) are closed.
- The only open PR is #2029, which is docs only. None of the stage 2 issues carries `queued`.
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

## Order of work

Every code step except CE-4 (#1696) and #1501 is evidence-affecting at the blocking tier, so the
maintainer reviews and merges each one. Dispatch runs two slots, counted as open `agent-pr` PRs
plus live `agent-wip` claims (ADR-0045:40-41), and the roadmap gives slot 2 to the defect lane;
a PR from an interactive session takes no slot. Only one migration PR may be open at a time. A
tagged release whose verifier reads a field ships before any writer of that field merges
(ADR-0023).

### Step 1: the probe (#1828, docs only)

The Linux answers the code steps need are already merged in #1842. #1828 stays open for P3 and for
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
frozen-digest test. It merges after #2029, so that ADR-0030 on `main` agrees with it. After it
merges, the maintainer tags a release carrying schema 7. That release gates the merges of steps 4,
5 and 6 and of every Persona writer. Linux is enough for this step.

### Step 3: launcher, profiles and Egress, with no Capture (#1831)

Its prerequisites are on main: CE-10, CE-3, the Linux probe, the mock and the D rulings it relies
on. Its body names #1828 as its last open blocker. Three things hold it back:

- It has no `queued` label.
- Its body still says "Blocked by #1828"; step 3 reads only network events, so the open P3
  question does not bear on it (question 1).
- The maintainer has not decided whether it waits for the designer's revision (question 2).

CE-4 (#1696, the no-VPN warning) merges first: #1831's body says it "merges after #1696", and the
start dialog shows CE-4's warning. CE-4 is not evidence-affecting.

The scope includes the D23 Chrome for Testing download script (no such script exists under
`scripts/`) and a SOCKS5 fixture proxy. The probe contradicts three of #1831's validation criteria
(probe :854-864): the `unshare -rn` wrapper, the IPv6 UDP sockets and the Unix singleton socket.
This host has Chromium 154 and Brave Origin 155. Branded Chrome and Edge are absent, so the D23
manual runs against them need another machine or a sudo install.

### Step 4: clicked launched Captures (#1832)

This step builds inside step 3's module, so it cannot start until #1831 merges. It can merge only
after the schema 7 release (spec :1288-1290). ADR-0051, the D3 ADR it needs, is accepted. Two gates
block it outright:

- P7 on Windows and macOS (probe :297-326, :894). This Linux-only host cannot measure it.
- P3 (spec :479-485, :904). Step 4 is the first step that enables `Page`.

The probe also contradicts parts of the step 4 design (probe :788-809, :858-864):

- Setup commands must be sent with the resume.
- Tabs opened by Ctrl-click or middle-click miss their first request.
- The service worker attaches twice.
- Shared workers belong to no tab.

The spec gates step 4 on the feasibility pass only (:1304-1306), so whether the designer's revision
also blocks it is the maintainer's call (question 2).

### Step 5: a profile per Persona (#1833) and Persona phases 2, 3 and 5

- **#1498 (phase 2) splits in two.** Its verifier half goes into step 2. The writer half carries
  DB migration 45, `captureRepo` and the `persona` ingest parameter, and needs the migration lane
  and its turn on `captureLifecycle.ts`. It is built on step 2's merged schema, and it can merge
  before the schema 7 release only while no caller passes a Persona. Its first callers are #1833
  and #1499.
- **#1833 waits** on #1831, on #1830 merging, and on the schema 7 release; its other blocker,
  #1829, is closed. It can merge before #1832 and leave the stamp wiring to it (#1833, "Order and
  lanes"). It adds the leak-check block from the 2026-10-17 ruling.
- **#1499 (phase 3)** keeps the Electron partition for background Recapture and add-URL only (spec
  :97-98, ADR-0034:93-96). Its body says it is blocked by #1498 and by #545; #545 is closed. It does
  not start until #1498's writer half merges or the maintainer lifts that block for the plumbing,
  and until question 7 settles whether it keeps its own sign-in window. Its anchors are stale:
  `RenderPage` is now at `recapture.ts:81`.
- **#1501 (phase 5)** counts cookies per store and is not evidence-affecting. Its body says it is
  blocked by #1499. For a launched profile, the count and the expiry come from the import result,
  because S2 (spec :186-187) forbids reading cookie values from the launched browser.
- **#1628** (the orphan sweep deletes Persona sign-ins) is in the same sweep that #1831 and #1833
  extend. It is labelled ready-for-human.

### Step 6: passive capture (#600 with #599)

Passive capture waits for step 4 (spec :1326) and for the schema 7 release (D5). The ADR-0037
amendment is already merged. Three changes are still needed:

- Move `selectorMatchesText` out of `selectorRepo.ts:145` into a shared module.
- Make `safeRegex.ts:26-41` report a timeout separately from no match.
- Add a blocking row for the new module to the evidence-affecting paths assessment (:281-284).

D18 holds only the CONTEXT.md part. Both issues are labelled ready-for-human, not ready-for-agent.

### Persona phases 6 and 4

- **#543** (export disclosure, in wayfinder:grilling) takes the `launched` wording (D11) and the
  seed-source question from ADR-0052.
- **#546** takes the threat-model change, which ships with the code that makes it true (spec
  :1534-1535).
- **The tester guide** has no issue yet.
- **#1500 (phase 4)** becomes the declared Persona on a stage 3 `companion` Capture and leaves this
  programme. Its body says it is blocked by #1498.

## Lanes and hot files

- **Manifest schema lane.** Schema 7 is free: #586 waits on design approval (roadmap ruling of
  2026-10-26), and nothing else holds a number. #1830 and #1498's verifier half share 7 in one PR.
- **Migration lane.** No open PR touches `db/migrations.ts` or `db/core.ts`. #1498's writer half
  takes DB 45. #1833 and #1501 may need a `personas` row migration and queue behind it.
- **`settings.ts`.** #1696 first, then #1831.
- **`manifest.ts`, `schemas.ts`, `src/shared/verify/**` and `src/verifier/**`.** Step 2 only.
- **`captureLifecycle.ts`.** #1498's writer half, then #1832, then #600. Every earlier holder in the
  briefs plan's order has merged, CI-4 as #1855.
- **`selectorRepo.ts` and `safeRegex.ts`.** Step 6, or a separate refactor if question 6 says so.

## Gates the maintainer owes

| Gate | Blocks | Who clears it | Status | Evidence |
| --- | --- | --- | --- | --- |
| Approve this plan | Code steps 3 to 6 | Maintainer | open | Spec :1533-1534; ADR-0016 |
| Merge #2029 (ADR-0030 amendment, roadmap) | Step 2 merge | Maintainer | open | #2029 open |
| Designer revision before steps 3 and 4 (Q2) | Steps 3, 4 | Maintainer, then designer | open | Assessment :396-401; no newer bundle |
| P3: may the engine enable `Page` (Q3) | Step 4, so step 6 | Maintainer | open | [c1828][c1828] item 3; probe :805-809 |
| Fold the probe contradictions into the spec (Q4) | Step 4 | Maintainer | open | Probe :788-809, :858-864 |
| P7 pipe on Windows and macOS (Q5) | Step 4, so step 6 | Hardware: a maintainer run | open | Probe :317-318, :894 |
| Edge, regular Brave, Snap and Flatpak rows (Q5) | #1828 closure; branded manual checks | Maintainer (needs sudo or another machine) | open | Probe :46-47, :315, :707-710 |
| Tag the schema 7 release | Merges of steps 4 to 6 and Persona writers | Maintainer | open | Spec :1288-1290; `constants.ts:111` is 6 |
| `queued` on the stage 2 issues | Unattended dispatch only | Maintainer | open | Labels read 2026-10-31 |
| #600 and #599 moved to ready-for-agent (Q9) | Dispatch of step 6 | Maintainer | open | Both are ready-for-human |
| v10 key-store warning (Q8) | #1833 | Maintainer | open | Probe :609; #1833's acceptance criteria |
| Persona tree in the blocking tier (Q8) | #1833 | Maintainer | open | ADR-0052 consequences |
| #1499's sign-in window, and its block on #1498 (Q7) | #1499, then #1501 | Maintainer | open | #1499 body line 32 |
| D18 glossary | #600's CONTEXT.md part | Maintainer | open | Spec :1405; briefs :84 |
| CI job for the known-answer suite (ADR-0048) | #1831 sign-off | Maintainer | open | #1831 "CI job" bullet |
| #1824 remainder (Q10) | Persona Settings copy | Maintainer | open | `PersonasSection.tsx:247-249` |
| ADR-0052 accepted, key-reader dependency chosen | Browser cookie import only | Maintainer | open | ADR-0052:3, :168-171 |

The P7 Windows and macOS rows are the only hard gate that needs hardware this machine lacks. The
Windows and macOS rows of the other P questions, and the macOS keychain rows for P14 to P16, are
also unmeasured, but no step waits on them.

## Work an agent can start now

1. **Open the step 2 verifier PR** (#1830 with #1498's verifier half) as a draft, built to the
   rulings of 2026-10-31. Without `queued` it runs in an interactive session. It merges after #2029
   and on the maintainer's review.
2. **Build CE-4 (#1696).** Its only blocker, #1695, has merged, and it is not evidence-affecting.
3. **Rewrite the Persona plan** (docs only): phases 2, 3, 5 and 6 as above, with phase 4 moved to
   stage 3; decision 9 replaced with the rule from the amended ADR-0030; "What exists" refreshed to
   schema 6 and DB 44; phase 3b (#1505) marked superseded; a `**Status:**` line.
4. **Extend the probe on this host** (#1828, docs only). Measure the Chromium 154 rows and build a
   P3 control that detects `Runtime.enable`. Keep `PROBE_OUT` under
   `~/worktrees/birdbrain/scratch/`.
5. **Draft without filing** a P7 runbook for Windows and macOS and a follow-up issue for the
   leftover rows (#1828).
6. **Draft without posting** refreshed bodies for #1830, #1831, #1832, #1833, #1498, #1499, #1501,
   #1500, #600 and #599. The drafts fix stale anchors, record CE-5 as shipped, move the Persona
   fields to schema 7, and add the rulings of 2026-10-17 and 2026-10-31.
7. **Draft the D18 glossary text** (#600): a Capture Scope entry, and an Active Case entry that no
   longer names only the extension.

## Open questions

1. Can #1831 drop "Blocked by #1828", as #1830 now has? Recommended: yes, citing #1842, because
   step 3 reads only network events.
2. The assessment asked the designer to revise the found-browsers list, the start dialog, the panel
   rail below about 1,020 px, the Wayland pop-out, the shortcut-failure state and three state
   messages. Should steps 3 and 4 build from the 2026-10-12 mock with the assessment's constraints,
   or wait for the revision? Sending the revision request is the maintainer's job.
3. The probe saw no page-visible change when the engine enabled `Page` or read from an isolated
   world. Its debugger-detection check failed its own control, though. Is that enough to enable
   `Page`, or should an agent first build a check that works and rerun the probe?
4. Should the probe's contradictions of the step 4 design be ruled on and folded into the spec
   before step 4 starts? They cover setup commands sent with the resume, Ctrl-click and
   middle-click tabs, double service-worker attaches and shared-worker ownership.
5. Who measures the pipe (P7) on Windows and macOS, and when? This machine has Brave Origin rather
   than regular Brave: does a Brave Origin measurement count for the Brave rows, and should Edge
   and regular Brave be installed?
6. Should an agent land the timeout-aware safe-regex change and the move of the Selector matcher
   now, as a refactor that changes no behaviour, instead of inside #600? Recommended: split it
   out now, because it depends only on CE-10.
7. Should #1499 keep its own "Sign in as persona" window, or should the cookie import be the only
   way to seed the in-app store? May its plumbing start before #1498's writer half merges?
8. On Linux, a launched profile falls back to Chromium's fixed-key store when the keyring is locked
   (probe P16). Should the Persona screen warn about this, and where? Should
   `src/main/services/persona/**` join the blocking tier once a Persona's cookies shape a Capture?
9. Should #600 and #599 move to ready-for-agent once step 4 merges, or should a human build them?
   Should #1500 come off ready-for-agent until stage 3?
10. Should the #1824 warning that cookies sit on disk unencrypted show on every machine, and what
    replaces the hover text "Checking whether the cookie store is protected"?
