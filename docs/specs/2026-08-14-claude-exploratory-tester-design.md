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
- Seeded plaintext signing keypair, generated per run. Playwright's Electron loader pins
  Chromium's `os_crypt` to `basic_text`, so `safeStorage` is unavailable and `initSigningKey`
  would otherwise hit #414's acknowledgement gate — a native modal with no parent window and
  nothing to click it, which hangs startup until `firstWindow()` times out. Same reasoning and
  same cost as `e2e/fixtures/electronApp.ts`: the harness does not exercise key *generation*,
  which `tests/main/services/signingKey.test.ts` covers instead.
- Throwaway SQLite DB inside that temp dir; deleted after the run.

**Evidence rule (hard):** the tester never runs against a real profile or real case
data. Same spirit as the evidence-path gates in ADR-0005 — an exploratory agent
poking at an investigator's actual evidence store is an unacceptable failure mode,
so isolation is structural (temp dir), not behavioral (a prompt instruction).

**Relationship to the evidence path.** The tester *exercises* capture acquisition, hashing,
manifest and verification code; it does not change any of it. The harness is a Playwright
driver that lives outside `src/`, and the only production line it needs is the window-geometry
override in `src/main/index.ts` — which is on the evidence-affecting path list
(`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`) and therefore takes the
label and the review, even though window size enters no capture, hash, manifest entry or
signature. Two obligations follow, and structural isolation does not discharge either:

- A finding about acquisition, hashing, manifests or verification is a *lead*, not a result.
  It is reproduced against the real code path before it is believed, because the harness runs
  a deliberately degraded profile: the signing key is seeded plaintext and the machine has no
  credential store, so the key-protection state a session observes is an artifact of the
  harness, not of the app.
- Anything the tester itself adds to `src/**` is held to the same evidence gate as any other
  change to those files, including a known-answer test or an explicit justification for its
  absence.

**Control server.** The harness listens on loopback and its tools can drive the app and read
the screen, so it is authenticated the same way the capture server is
(`src/main/services/captureServer.ts`): non-loopback `Host` rejected, any `Origin` rejected,
and a per-run token required on every request. Binding to 127.0.0.1 is not access control —
a `text/plain` POST from any page open in the operator's browser is a CORS-simple request and
never sees a preflight.

### How the agent drives the app

The Playwright `_electron` connection exposes the renderer as a `Page`. Two viable
wirings, in preference order:

1. **Thin MCP/tool bridge over the Playwright page** — expose `snapshot` (accessibility
   tree), `click`, `type`, `screenshot`, `console_messages` as tools to a Claude agent
   session. Equivalent to what chrome-devtools MCP provides for a browser, pointed at
   the Electron renderer.

   **Console coverage is bounded and the bound must be stated in every session report.**
   The console listeners can only attach once `firstWindow()` resolves. Attaching there
   (rather than after the readiness wait, which is what the first two charter runs did)
   buys renderer output from the boot render onward — enough to catch the CSP `font-src`
   violation those runs could not see. Anything the main process logs before the window
   exists remains invisible. An empty drain therefore means "nothing after the window
   appeared", never "a clean session".
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

**The archive-import charter is blocked for automated execution and ships marked as such.**
Two prerequisites are missing and neither is in this rollout step. Import starts at
`dialog.showOpenDialog` (`src/main/ipcHandlers.ts`, `CASES_INSPECT_ARCHIVE`), a native OS
modal that no page-level Playwright tool can reach; and there is no sample `.birdbrain`
archive fixture, with every run starting from an empty `mkdtemp` profile. Unblocking it needs
a versioned fixture archive plus a harness action that supplies a file path to the main
process without going through the modal. Until then the charter is driven by hand.

### Findings pipeline

- Each finding: title, severity guess, repro steps as the agent actually performed
  them, expected vs observed, screenshot(s).
- A run produces a session report (what was explored, what was fine) so silence
  is distinguishable from lack of coverage. **A run never files issues itself** — that is
  why every charter says "Do not file issues during the run". Filing is rollout step 3
  below, a separate pass over a completed session report.
- Filing, once step 3 exists, opens GitHub issues labeled `needs-triage` (existing label
  taxonomy — `docs/agents/triage-labels.md`) with screenshots attached. Humans or the
  dispatch routine take it from there.
- Dedup: before filing, the agent searches open issues for near-duplicates and
  comments on an existing issue instead of opening a new one.

**Filing is an export, and gets an export gate.** A screenshot is a picture of whatever was
on screen, and a repro step is a transcript of whatever was typed. Temp-profile isolation
bounds what *should* be in them; it does not verify what *is*. Step 3 therefore requires,
before anything leaves the machine:

- A human approves the specific issue text and the specific screenshots. No unattended upload.
- The session must have run against a harness-created temp profile. A run pointed at any
  other userData directory is not eligible for filing at all.
- Anything that looks like a security defect goes to private vulnerability reporting
  (`SECURITY.md`), not a public issue.

### What this is not

- **Not a CI gate.** Runs are nondeterministic; a finding is a lead, not a failure.
  Playwright E2E remains the regression gate. This runs nightly or on demand, never
  blocking a PR.
- **Not a replacement for real users.** It narrows the gap; usability signal from
  actual investigators still outranks it.
- **Not autonomous fixing.** The tester files issues; the existing serial-slot agent
  pipeline (with its human-review gates) decides what gets worked.

### Cost envelope

A session is roughly 30–80 screenshots at ~1–4k tokens each plus reasoning. At Sonnet-tier
rates that lands in single-digit dollars per run, but the figure is an estimate that has not
been measured against a billed run, and it moves with model choice, token rates, screenshot
dimensions and retries.

The harness cannot enforce a cap: it is a Playwright control server and makes no model calls
of its own — the agent session driving it does. A cap therefore belongs to whatever schedules
the run in rollout step 4, which is where the first measurement should also be taken.

## Rollout sketch

1. Harness spike: launch built app via the e2e fixture pattern, expose the five tools,
   run one charter manually from a Claude session, eyeball the findings quality.
2. Charter set: 4–6 charters covering case lifecycle, capture viewing, notes,
   selectors, theming, archive import. Five of the six are drivable through the harness;
   archive import is blocked pending a fixture archive and a non-modal file-selection
   action, as described above.
3. Issue filing: wire `gh` issue creation with screenshot upload + dedup search, behind the
   export gate above.
4. Schedule: nightly run (CI job or scheduled agent) once signal/noise looks
   acceptable over a week of manual runs.

## Pinned: full computer use (future route)

The escalation path, deliberately not built now:

- **What it is:** Anthropic computer-use tool (`computer_20251124`, beta header
  `computer-use-2025-11-24`) — the model sees raw screenshots and emits coordinate
  clicks/keystrokes. Current models return pixel-accurate coordinates; 1080p
  screenshots are the recommended cost/perf balance. Both identifiers were recorded at
  design time (2026-08-14) and are not pinned by anything in the repo; re-check them
  against the vendor's tool-use documentation before implementing this route.
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
