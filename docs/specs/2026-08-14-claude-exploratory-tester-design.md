# Claude Exploratory Tester — Design

**Status:** Accepted direction (shape 1). Shape 2 (full computer use) is deliberately
pinned as a future route — see "Pinned: full computer use" at the bottom.

## Problem

Birdbrain has two test layers today:

- **Playwright E2E** (`e2e/`) — scripted, selector-coupled, deterministic pass/fail.
  Catches regressions on flows we thought to script. Blind to visual breakage, layout
  drift, theme bugs, and anything off the scripted path.
- **Real users** — catch everything eventually, but feedback is slow, unstructured,
  and arrives after the annoyance.

The missing middle is an **exploratory tester**: something that uses the app like a
human, follows a goal rather than a script, notices "this is confusing / broken /
looks wrong", and files structured bugs. That is the slot this design fills with a
Claude agent.

## Decision

Build a **hybrid agent-tester**: a Claude agent drives the *built* Electron app
through DOM-level tooling (Playwright/CDP — fast, cheap, reliable navigation) but
takes **screenshots as evidence and judges them visually** (catches what DOM
assertions never see). Sessions are driven by **charters**, not scripts. Findings
become GitHub issues labeled `needs-triage`, feeding the existing triage/dispatch
pipeline.

Explicitly **not** chosen now: true computer use (screenshot + coordinate clicks).
It is the only shape that can test the extension-install and capture-from-live-page
flows end-to-end, but it is slower, costlier, and flakier, and needs a display
environment. Pinned below with revisit triggers.

## Design

### Launch and isolation

Reuse the launch pattern from `e2e/fixtures/electronApp.ts`:

- Launch `out/main/index.js` (built app — `pnpm build` first, same as `pretest:e2e`)
  via Playwright `_electron.launch`.
- Fresh `mkdtemp` userData directory per session, seeded `settings.json` with an
  operator name so the capture gate accepts test captures.
- Throwaway SQLite DB inside that temp dir; deleted after the run.

**Evidence rule (hard):** the tester never runs against a real profile or real case
data. Same spirit as the evidence-path gates in ADR-0005 — an exploratory agent
poking at an investigator's actual evidence store is an unacceptable failure mode,
so isolation is structural (temp dir), not behavioral (a prompt instruction).

### How the agent drives the app

The Playwright `_electron` connection exposes the renderer as a `Page`. Two viable
wirings, in preference order:

1. **Thin MCP/tool bridge over the Playwright page** — expose `snapshot` (accessibility
   tree), `click`, `type`, `screenshot`, `console_messages` as tools to a Claude agent
   session. Equivalent to what chrome-devtools MCP provides for a browser, pointed at
   the Electron renderer.
2. **`--remote-debugging-port` + chrome-devtools MCP** — launch the app with a debug
   port and attach the existing chrome-devtools MCP tooling directly. Less code, but
   the Electron target discovery is fiddlier.

Either way the agent's loop is: read accessibility snapshot → act → screenshot →
judge → continue or record a finding. Screenshots are taken at natural viewport size;
the agent is instructed to flag visual problems (clipping, contrast, theme
inconsistencies, dead space, broken states) as findings even when the DOM is "correct".

### Charters, not scripts

A session prompt is a persona + goal + reporting instruction, e.g.:

- "You are an OSINT investigator using Birdbrain for the first time. Create a case,
  add a URL capture, and try to understand what the provenance tab is telling you.
  Report anything confusing, broken, or visually wrong."
- "Exercise the notes workflow: create, anchor, edit, delete. Try to lose data."
- "Switch themes repeatedly while navigating every tab. Report visual defects."
- "Import the sample case archive, then try to break search."

Charters live in a small tracked directory (e.g. `e2e/charters/*.md`) so runs are
repeatable in intent while remaining exploratory in path.

### Findings pipeline

- Each finding: title, severity guess, repro steps as the agent actually performed
  them, expected vs observed, screenshot(s).
- Filed as GitHub issues labeled `needs-triage` (existing label taxonomy —
  `docs/agents/triage-labels.md`), screenshots attached. Humans or the dispatch
  routine take it from there.
- A run also produces a session report (what was explored, what was fine) so silence
  is distinguishable from lack of coverage.
- Dedup: before filing, the agent searches open issues for near-duplicates and
  comments on an existing issue instead of opening a new one.

### What this is not

- **Not a CI gate.** Runs are nondeterministic; a finding is a lead, not a failure.
  Playwright E2E remains the regression gate. This runs nightly or on demand, never
  blocking a PR.
- **Not a replacement for real users.** It narrows the gap; usability signal from
  actual investigators still outranks it.
- **Not autonomous fixing.** The tester files issues; the existing serial-slot agent
  pipeline (with its human-review gates) decides what gets worked.

### Cost envelope

A session is roughly 30–80 screenshots at ~1–4k tokens each plus reasoning — single-digit
dollars per nightly run at Sonnet-tier rates. Cheap relative to any human QA hour;
still worth a per-run budget cap in the harness.

## Rollout sketch

1. Harness spike: launch built app via the e2e fixture pattern, expose the five tools,
   run one charter manually from a Claude session, eyeball the findings quality.
2. Charter set: 4–6 charters covering case lifecycle, capture viewing, notes,
   selectors, theming, archive import.
3. Issue filing: wire `gh` issue creation with screenshot upload + dedup search.
4. Schedule: nightly run (CI job or scheduled agent) once signal/noise looks
   acceptable over a week of manual runs.

## Pinned: full computer use (future route)

The escalation path, deliberately not built now:

- **What it is:** Anthropic computer-use tool (`computer_20251124`, beta header
  `computer-use-2025-11-24`) — the model sees raw screenshots and emits coordinate
  clicks/keystrokes. Current models return pixel-accurate coordinates; 1080p
  screenshots are the recommended cost/perf balance.
- **What it uniquely buys:** end-to-end flows that span two applications — install
  the Chrome extension, capture from a live web page, verify the capture lands in
  the Electron app. Playwright/CDP fundamentally cannot cover this as one flow.
  Also tests the packaged app exactly as a user sees it (menus, dialogs, OS chrome).
- **What it needs:** a display environment — WSL2 + Xvfb driving the Linux build
  (build env exists; note the sharp/asarUnpack packaging caveat), or a Windows VM.
  Plus tolerance for slower, flakier, costlier runs.
- **Revisit triggers:** (a) shape 1 is running and its charters are stable;
  (b) an extension-flow regression ships that no existing layer could have caught;
  or (c) a release-qualification need for testing packaged builds on real OS targets.
