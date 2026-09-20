# Post-beta quality sweep: three workflows

Three workflow runs, one per pass, each read by the maintainer before the next starts. The
cut (tag, gate v1, observed sessions) is independent of this plan; the first pass flags what
would block it. Nothing here closes an issue, files a defect, or opens a PR without the
maintainer's word: each workflow returns a proposal table and stops.

## Inputs at 2026-09-19

| Input | State |
| --- | --- |
| `main` | `d48ab3fa`, CI green |
| Open issues labelled `bug` | 232 (search index count; label reads are authoritative) |
| Open issues labelled `redesign` | 23 |
| Design source | `docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html`, eleven screens, ruled the single source on 2026-09-14. The handoff README still names the 2026-08-21 standalone as current; that row is stale |
| Renderer commits since the mock | 9 on `main` since 2026-09-14 |
| App screens | Dashboard, Settings, New Case wizard, Case Overview, Captures, Notes, Signals, Data, plus the Export dialog and the extension install stepper |
| e2e | 32 Playwright specs over the packaged Electron app; no accessibility engine installed |

## Workflow 1: defect review

Purpose: turn 232 open bugs into four buckets with evidence, so the other two passes and the
cut know what the beta ships with.

- Fan out: the open `bug` list read by a direct label read, split into chunks of 20, one
  agent per chunk (12 agents). Each returns a row per issue: bucket
  (`fixed-on-main` with the merging PR or commit, `reproducible`, `beta-blocking`,
  `post-beta`, `needs-info`), the evidence line, and whether it is evidence-affecting.
- Verify: every `fixed-on-main` and `beta-blocking` claim goes to one refuter agent
  prompted to overturn it (default refuted when uncertain). Rows that fail keep their
  original bucket with a `disputed` flag.
- Synthesize: one agent merges duplicates across chunks and writes the proposal table to
  `docs/plans/2026-09-19-defect-review.md`.
- Output: the table. The maintainer picks which `fixed-on-main` rows close and which
  `beta-blocking` rows go `queued`. Closing is outward-facing and stays a separate ask.
- Agents: about 12 finders, up to 60 refuters, 1 synthesizer.

## Workflow 2: mock reconciliation

Purpose: a gap list per screen between the live mock and the app as built.

- Fan out: one agent per screen (11 mock screens mapped onto the 10 app surfaces; the
  mention-grammar flow is read from `Canvas.dc.html`). Each reads the mock markup for its
  screen, the matching components under `src/renderer/components/`, the merged
  `redesign` issues, and the defect table from workflow 1. It returns gaps typed
  `mock-ahead`, `app-ahead`, `drifted`, with mock line numbers and `file:line` in the app.
- Verify: each gap goes to one refuter reading both sides again.
- Synthesize: one agent writes `docs/plans/2026-09-19-mock-reconciliation.md`, the gap
  list grouped by screen, and a proposed direction per gap left blank for the maintainer.
- Output: the gap list. Direction per gap is a product call and is not taken by an agent.
- Agents: 11 finders, one refuter per gap, 1 synthesizer.

## Workflow 3: automated UI and UX pass

Purpose: drive the packaged app through every screen and score it against the reconciled
mock and the writing guide.

- Precondition: `pnpm build` at `main`, run under `unshare -rn` because a running Birdbrain
  holds port 19845 (see the local e2e port clash note). An accessibility engine is a new
  dependency; the maintainer decides between adding `@axe-core/playwright` or skipping the
  accessibility leg.
- Fan out: one agent per screen, each writing a throwaway Playwright script under
  `e2e/.sweep/`, ignored by git, that visits the screen in both themes and both densities,
  captures screenshots, and reads the DOM. Each scores the screen on layout against the
  mock, copy against `docs/agents/writing-guide.md`, keyboard reach, and accessibility if
  the engine is present, and returns findings with severity and a screenshot path.
- Verify: findings rated `high` go to one refuter that re-runs the script.
- Synthesize: one agent writes `docs/plans/2026-09-19-ui-ux-pass.md` and proposes at most
  two defects to file per screen area under ADR-0028, the rest kept in the report.
- Output: the report. Filing follows the maintainer's pick.
- Agents: 10 finders, refuters by finding count, 1 synthesizer.

## Rules across all three

- Every agent runs with `model: 'opus'` set explicitly, as this session's brief requires.
- Agents read; they do not edit `src/**`, close issues, or post to GitHub.
- Each workflow's script is passed inline and persisted by the tool; the run id is recorded
  in the outcome section below so a pause can resume.
- Counts in the reports come from commands run at the time, never from this plan.

## Outcome

### Workflow 1, defect review

Run `wf_37dd50cc-5e6`, 42 agents (12 bucketing, 29 refuters, 1 synthesizer), resumed once
after the session that launched it ended. Output: `docs/plans/2026-09-19-defect-review.md`.

| Bucket | Issues |
| --- | --- |
| Beta-blocking | 18 |
| Fixed on main | 11 |
| Reproducible | 106 |
| Needs info | 1 |
| Post-beta | 97 |

Refuters disputed 16 of the 17 listed beta-blocking rows and 1 of 11 fixed-on-main rows.
The dispute pattern is consistent: the code fact holds but the refuter argues the path is
off the beta floor. Those are the rows the maintainer reads first. Undisputed proposals:
close 10 as fixed on main, queue #1270.

### Workflow 2, mock reconciliation

Run `wf_7885e646-52c`, 412 agents (11 screen comparisons, 400 refuters, 1 synthesizer), resumed three
times because the background run ends with the session process. Output:
`docs/plans/2026-09-19-mock-reconciliation.md`, 400 gap rows, direction column empty.

| Type | Rows |
| --- | --- |
| Mock ahead of app | 68 |
| App ahead of mock | 83 |
| Drifted | 176 |
| Absorbed | 73 |
| Refuted (kept in place) | 53 |

The Data explorer carries the most rows (64) and the most refutations (11). Every row waits
on the maintainer's direction: mock, app, or drop.

### Workflow 3, automated UI and UX pass

Run `wf_98f2535d-61b` on 2026-09-20, 31 agents (11 screen drivers, 19 refuters, 1
synthesizer). The harness lives in the `sweep-ui` worktree on branch `agent/ui-ux-sweep`:
`@axe-core/playwright` added as a dev dependency, scratch specs under `e2e/.sweep/`, runs
under `unshare -rn` with loopback up and `xvfb-run`. Output:
`docs/plans/2026-09-19-ui-ux-pass.md`, 174 findings.

| Severity | Findings |
| --- | --- |
| High | 19 (9 refuted, kept in place) |
| Medium | 80 |
| Low | 75 |

The report proposes 22 defects, two per screen area, none filed. The extension popup and
native dialogs were out of reach.

