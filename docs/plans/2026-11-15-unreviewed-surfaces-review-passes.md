# Review passes for the surfaces the critique did not cover

**Status:** active

The design critique of 2026-11-15 reviewed the desktop app in the dark theme on the demo Case,
which holds three Captures. It did not look at the extension's own pages, the light theme on
screen, or a Case large enough to show what a list of hundreds does. The consolidation plan
(`docs/plans/2026-11-15-chrome-capture-export-consolidation.md`, #2201) lists the three under
"Not planned here" and says each wants its own pass before any change. This plan sets up those
passes. Code references are to `origin/main` at `ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan and its two open questions.

A pass is a review, not a change. Each one ends in a written assessment under `docs/specs/`
with its findings ranked, and stops there. Fixes are planned afterwards, from the findings.

## What every pass produces

- [ ] An assessment at `docs/specs/YYYY-MM-DD-<slug>-assessment.md`, dated the day it is
  written, stating the commit reviewed, how each screen was reached, and what was not reached.
- [ ] A findings table with a severity per finding, in the critique's three levels: critical,
  moderate, minor.
- [ ] Screenshots as evidence, taken with invented data only. They are attached where the
  assessment is reviewed and are not committed, unless the pass becomes a design bundle.
- [ ] For each finding, the consolidation slice that already covers it, or "new".

## Pass 1: the extension's own pages

- **Surfaces.** The popup (`extension/src/popup/`), the options page
  (`extension/src/options/`), and what the content script draws on a page: the selection bar
  (`selectionBar.ts`) and the capture toast (`toast.ts`). `extension/src/theme.css` holds the
  extension's own tokens, with a light default and an `html.dark` override.
- **Why it matters to the consolidation.** The critique counted eleven capture controls in the
  app and left out the extension's. The parent plan's open question 1 asks how a Capture
  Session starts when only the extension is connected: the app's switch is the only control
  that starts one, slice 5.5 removes it, and the popup can stop a session but not start one
  (`startSession()` in `extension/src/utils/api.ts` has no caller). This pass shows the
  maintainer what the popup offers today, so it informs that answer, and the extension's
  wording should agree with whatever the app says afterwards.
- **Method.**
  - Build with `pnpm build:extension` and load the output unpacked into a Chromium profile.
    Nothing under `e2e/` loads the extension today, so the pass starts by finding out whether
    Playwright's persistent context can, in this environment. If it cannot, the pass is run by
    hand on the maintainer's machine and says so.
  - Run the app beside it, so the popup can reach the Capture Server and show its connected
    states.
  - Capture each surface in both themes and in each state it has: not connected, connected with
    no Active Case, connected with one, a Capture running, a Capture refused, a Capture
    Session running.
- **Questions to answer.**
  - Do the popup's words for a Capture Session, the Active Case and a Capture match
    `CONTEXT.md` and the app?
  - Does the popup restate anything the app's status control already says, or leave out
    something the Operator needs while the app is behind another window?
  - Is the popup the right place to start an extension-only Capture Session, given that it
    already stops one?
  - Do the selection bar and the toast keep out of the captured page, as #2172 intends for the
    selection highlight?
  - Contrast, focus order and target sizes on each surface.
- **Acceptance.**
  - [ ] Every state listed has a screenshot or a stated reason it could not be reached.
  - [ ] Each wording difference between the extension and the app is listed with both strings.

## Pass 2: the light theme

- **Surfaces.** Every section of a Case, the dashboard, Settings, and the dialogs the critique
  captured in dark: launch, the VPN warning, export, paste URLs.
- **What is known already.** The light tokens in `src/renderer/styles/globals.css` pass for
  text: faint text is 5.17:1 or better. #1524 reports two export notices unreadable in light;
  slice 1.2 of the consolidation plan fixes those. Sixteen lines under `src/renderer` use a
  raw palette utility such as `bg-emerald-500/10` in place of a semantic token, which
  `CLAUDE.md` allows only for overlays and status colours.
- **Method.**
  - `e2e/theme-screenshots.spec.ts` already switches theme and photographs the dashboard and
    the Overview. Extend the same approach, or drive the app through
    `.claude/skills/run-birdbrain/`, to take each screen in both themes from one seeded Case.
  - Compare pairs side by side for anything that loses its edge, its emphasis or its state
    colour in light.
  - Measure the status triples (`-fg` on `-surface`, and `-fg` on the plain surfaces) in light,
    since phases 1 and 6 of the consolidation plan move status colour from filled boxes to text
    and dots, and the launch dialog's no-VPN line is already `-fg` text on a plain surface.
  - List each of the sixteen raw utilities with whether it falls under the allowed exceptions.
- **Questions to answer.**
  - Does any control that reads as primary in dark lose that in light?
  - Is every status colour at least 4.5:1 as text on the surface it will sit on after the
    consolidation's changes?
  - Do screenshots of captured pages, which are mostly light, still stand apart from the app's
    own light surfaces?
- **Acceptance.**
  - [ ] Each screen has a light and a dark image from the same state.
  - [ ] Each status colour has a measured ratio on each surface it is used on.

## Pass 3: a large Case

- **Surfaces.** The Captures list and viewer, search, the Data screen's table and tree, the
  Overview's Link Map and counts, Signals with many Selectors and Tags, the export dialog's
  preflight, and the capture log in the status popover.
- **Why it matters to the consolidation.** Slice 7.2 replaces the list rows' Selector chips
  with a count, on the evidence of three rows that all matched the same Selectors. A Case
  whose rows differ may show the chips doing useful work. Nothing under `src/renderer` uses a
  virtualised list, so the pass also finds out what several hundred rows cost.
- **Method.**
  - Seed a Case with invented Captures at three sizes: 50, 500 and 2,000. The driver's
    `capture` command in `.claude/skills/run-birdbrain/` posts one Capture to the Capture
    Server; `scripts/dev-seed/` shows how a profile is filled without Chrome. Vary hosts,
    titles, dates, Tags and which Selectors match, so rows differ.
  - Add 20 Selectors, 30 Tags and 100 Notes with Mentions.
  - At each size, record how long each section takes to become usable and whether scrolling,
    selection and search stay responsive, with the method written down so the numbers can be
    taken again.
  - Look at what truncates, wraps or overflows: long titles, long hosts, many chips, large
    counts in the chrome and the Overview tiles.
- **Questions to answer.**
  - At what size does each list stop being comfortable, and what breaks first?
  - Do the list row's chips help tell rows apart when rows differ? This decides slice 7.2.
  - Does the Link Map stay readable past a few dozen nodes?
  - Does the export preflight's notice still fit the dialog when hundreds of Captures lack
    Trusted Time?
- **Acceptance.**
  - [ ] The assessment gives a time and a verdict per section at each size.
  - [ ] It says whether slice 7.2 should go ahead as written.

## Order

Pass 3 first: it decides whether a slice of the consolidation plan is right. Pass 2 before
slices 1.2 and 6.1 are reviewed, since each moves status colour onto plain surfaces or dots.
Pass 1 before the maintainer answers the parent plan's open question 1, and so before slices
5.4 and 5.5.

## Not in these passes

- Fixing anything. Each assessment feeds a later plan.
- The docs site and the standalone verifier, which have their own audiences.
