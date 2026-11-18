# An entry point for Investigate

**Status:** active

The design critique of 2026-11-15 found that the Investigate section has a route and a screen
and nothing that links to it (finding U10 in
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md`, #2201). That plan left the gap
out. This one records why the gap exists, and what adding the entry takes once it is allowed.
Code references are to `origin/main` at `ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan, which lists the entry point under "Not
planned here" and leaves it to the investigation engine work.

## The gap is ruled, not missed

`docs/plans/2026-10-10-case-investigation-engine.md` settles it in its gates table:

- **How the section stays out of releases** was ruled on 2026-10-10: brief CI-V1 registers the
  route and components, and the entries in `Sidebar.tsx` and the command palette land in
  CI-V5.
- **Any release showing the section** waits on one open gate: confirming the base-layer bar and
  the safety gate on the synthetic Case, read from CI-B's results. #1892 builds the evaluation
  Case, answer key and scoring runner that run needs.

What the screen shows today comes from the fake engine: the Subjects in the run setup are
`src/shared/investigationFixture.ts`. The same plan registers the fake only while
`app.isPackaged` is false, and CI-V5 removes it.

So the critique's finding stands as an observation and needs no fix of its own. This plan does
not ask for the entry sooner. It lists what CI-V5's entry has to cover that the engine plan
could not know, because the chrome is changing under it.

## What the entry touches

Each line is a place that knows the list of sections today.

| Place | What it holds | Investigate today |
| --- | --- | --- |
| `Sidebar.tsx`, `NAV_ITEMS` and `SECTION_PATHS` | The rail's items | Absent |
| `CommandPalette.tsx` | Navigation and action rows | Absent |
| `CaseActionBar.tsx`, `SECTIONS` | The section name in the row under the top bar | Present |
| `CaseWorkspace.tsx`, `isInvestigate` | Which sections own their scroll | Present |
| `CaseWorkspace.tsx`, the `lastActiveSection` effect | The section restored at next launch | Falls back to Overview |
| `BirdbrainSettings['lastActiveSection']` | The stored value's type | No `investigate` member |
| `tourSteps.ts` | The walkthrough | No step |

## Steps, when CI-V5 is allowed to land

- [ ] **Confirm the gate.** CI-B's results are read and the maintainer has confirmed the bar.
  Until then nothing below starts.
- [ ] **The rail.** Add Investigate to `NAV_ITEMS` and `SECTION_PATHS` in `Sidebar.tsx`, after
  Data, with a `nav-investigate` tour anchor. If slice 5.2 of the consolidation plan has
  landed, the item has a label like the others; if not, it is icon-only with a tooltip, and
  5.2 picks it up.
- [ ] **The command palette.** A row that opens Investigate for the Case on screen.
- [ ] **Session restore.** Add `investigate` to `lastActiveSection` in `src/shared/schemas.ts`
  and `src/shared/types.ts`, and to the effect in `CaseWorkspace.tsx`, so a restart returns to
  it.
- [ ] **The fake is gone.** `src/shared/investigationFixture.ts` is not reachable from a
  packaged build. CI-V5 already owns this; the entry's pull request checks it.
- [ ] **Tests.** `tests/components/Sidebar.test.tsx` if 5.2 has added it, otherwise a new case
  beside `CaseSettingsEntryPoints.test.tsx`; `CommandPalette.test.tsx`; an end-to-end step that
  reaches the section from the rail.
- [ ] **Screenshots.** The rail with the item active, and the section it opens.
- [ ] **Docs.** `features.mdx` gains the section. The tour gains a step only if the maintainer
  wants one.

## Acceptance

- [ ] Investigate is reachable from the rail and the command palette on a packaged build, and
  only after the gate is confirmed.
- [ ] Closing and reopening the app on Investigate returns to it.
- [ ] No name from the fixture appears in a packaged build.

## Not decided here

- Whether Investigate takes a rail slot of its own or sits inside another section. The engine
  plan assumes a slot; the design bundle in
  `docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md` draws the rail without it,
  and adding a seventh item is cheap once labels exist.
- The Withheld from analysis mark and the "not read" count, which the engine plan routes to
  other briefs.
