# Capture Server becomes transport, 2026-09-21

Recommendation 1 of the 2026-09-21 architecture review. `CONTEXT.md` says the Capture Server "is only the transport," but the upload route holds the admission policy: operator gate, Active Case resolution, exclusion, the manual dedup window, the screenshot cap, the session count and the activity events. The capture-then-attach route repeats most of it. This plan moves that policy behind one Capture Lifecycle method that returns an outcome, and leaves the routes to parse a request and map the outcome to a status code.

Source: `/tmp/architecture-review-20260921-210113.html`, worktree at `origin/main` `b89efc07`.

## Target

`CaptureLifecycle.admit(request)` returns an `AdmissionOutcome`:

- `{ ok: true, capture, contentHash, screenshotStatus, screenshotWarning? }` after a stored capture.
- `{ ok: false, refusal }` where `refusal.kind` is one of `operator_name_required`, `no_active_session`, `no_active_case`, `missing_case_id`, `case_not_found`, `case_archived`, `excluded` (with the pattern), `duplicate`, or `failed` (with the error).

The request names its route: the three wire sources plus `attach`, which the extension reports as a manual capture but which the dedup window must not refuse. Policy per route stays exactly what the server enforces today:

| Policy | auto | manual | selector | attach |
| --- | --- | --- | --- | --- |
| Operator name set | yes | yes | yes | yes |
| Case | Active Case, session running | named, exists, not archived | named, exists, not archived | named, exists, not archived |
| Exclusion list | yes | yes | yes | yes |
| Manual dedup window | no | yes | no | no |
| Screenshot cap | yes | yes | yes | yes |
| Session capture count | yes | no | no | no |
| Activity events | source `auto` | `manual` | `selector` | `manual` |

The order is unchanged too: operator gate, case, exclusion, dedup, then the `received` event, the screenshot cap, the ingest, the count, `new capture`, and `stored`. An excluded URL with an unusable case still answers the case error, not the exclusion one (#400).

## Steps

1. Add `src/main/services/toolVersion.ts` holding the one `resolveToolVersion`, and point the five copies at it: `captureServer.ts`, `captureLifecycle.ts`, `recapture.ts`, `timestampWorker.ts`, `certification.ts` (whose export moves, so `staging.ts`, `export.ts` and `caseArchive.ts` import the new module).
2. Add `admit` to `captureLifecycle.ts`. The lifecycle takes three new optional deps: the session service (Active Case and count), an activity-event emitter and a new-capture emitter, wired in `src/main/index.ts` the way the recapture service already is. The dedup map becomes lifecycle instance state, so `resetManualDedup` goes away; a fresh lifecycle per test is the reset. The exclusion check calls `matchCaseExclusion`, the composition `exclusionPolicy.ts` documents as what every enforcement site wants, so the rule has one shape across the extension route and recapture.
3. Rewrite the two server call sites. `POST /api/captures` parses the form, calls `admit`, and maps the refusal kind to the status and message it answers today. The capture-then-attach path keeps its own active-case discipline and candidate lookup, which are about the attach, and calls `admit` with route `attach` for the ingest branch. The pipeline self-test route is untouched: it bypasses the exclusion list on purpose and ingests into a sandbox.
4. Tests. `captureLifecycle.test.ts` gains an `admit` block covering every refusal kind, the dedup matrix, the screenshot cap, the session count and the event sequence, with no HTTP in the loop. `captureServer.test.ts` keeps one HTTP test per status mapping and loses the policy matrix it now duplicates. `perCaseExclusions.test.ts` keeps its acceptance matrix, reading events from the lifecycle dep instead of a mocked window. The two attach tests that substitute a lifecycle whose ingest throws or blocks substitute `admit` instead.
5. Docs. `CONTEXT.md` names admission as part of the Capture Lifecycle ingest step. `docs/agents/architecture.md` says the server is transport.

## Verification

`pnpm preflight` at head: lint, typecheck, unit tests, build, coverage thresholds and diff coverage. The change is evidence-affecting at the blocking tier (`captureServer.ts`, `captureLifecycle.ts`, `recapture.ts`, `timestampWorker.ts`, `certification.ts` are all listed), so the PR carries the Evidence impact section and waits for human review. No manifest entry changes shape and no byte on disk changes; the frozen fixtures under `tests/` prove backward verification.

## Out of scope

Candidates 2 to 6 of the review. The self-test route's operator gate and events. The persona-window and passive-capture producers, which are the consumers this method exists for and land under their own tickets (#1505, ADR-0013).
