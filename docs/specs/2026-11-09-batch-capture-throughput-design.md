# Batch capture throughput: stored jobs and bounded parallel renders

**Date:** 2026-11-09

**Status:** Draft, grilled with the maintainer on 2026-11-09; awaiting maintainer review. Slices 1
to 6 are built on stacked pull requests, none merged yet.

**Frame of reference:** `origin/main` at `c1ed8ed8`. This spec cites code by symbol, per
[`docs/README.md`](../README.md). The measured figures come from one batch on 2026-11-09 and from
the validation record named beside each figure.

**Related:** the [Recapture design](2026-07-03-recapture-design.md), which this extends. Its v1
non-goals deferred queue persistence, retries and a queue view; this spec takes up the first two
and defines the state the third will read. Issue #2121 (Transaction Records lost to a time bound),
PR #2122 (a stopgap pending count on the capture status button), and issue #2124 (batch entry and
batch view, which reads the job state defined here).

**Terms:** a **Background Job** is one URL accepted for a background render, and a **Batch** is the
Background Jobs one Operator action queued, always into one Case. Both are defined in
[`CONTEXT.md`](../../CONTEXT.md). The code names the queue after Recapture
(`createRecaptureService`, the `recapture:*` channels, `source: 'recapture'` on every event), but it
also runs pasted URLs and link Captures, which supersede nothing. This spec says background job
queue for the queue and keeps the code's names for symbols.

## Problem

On 2026-11-09 the maintainer pasted 25 URLs into **Capture -> Paste URLs** (`AddUrlsBox`). The
Captures arrived one at a time over 11 minutes, and nothing in the app showed that the batch was
still running. 22 Captures were stored. The three that were not left no trace: the background job
queue emits a `failed` event to the renderer and logs nothing, so neither the log nor the database
says what happened to them.

Four properties of the current queue produce this:

- **Serial.** `createRecaptureService` in `src/main/services/recapture.ts` runs one job at a time
  (`drain()`), as the Recapture design chose for predictable resource use.
- **Held in memory.** Queued jobs live in an array and are lost when the app closes.
- **Invisible until it starts.** `runJob` emits the `received` event when a job starts, not when it
  is queued, so a queued job has no row anywhere in the app. `status()` returns only
  `{ pending, activeUrl }`.
- **Matched by URL.** `addCaptureEvent` in `src/renderer/stores/appStore.ts` removes a `received`
  row when a terminal event arrives with the same `url` and `source`. Two jobs for the same URL can
  clear each other's row. The store keeps 50 events, so a large batch pushes its own early rows
  out.

## What the batch measured

### Measured: whole-job durations

The source is a read-only copy of the maintainer's local database. For a background Capture,
`captures.timestamp` is set in `runJob` before the render starts, and `captures.created_at` is set
when `insertCapture` writes the row inside the ingest. Their difference is the job's time from
start to stored row. This section reproduces no URL from that database.

| Quantity | Value |
| --- | --- |
| URLs queued | 25 |
| Captures stored | 22 |
| Wall time, first job start to last row | 673 s |
| Sum of the 22 stored jobs | 310 s |
| Stored job, median / mean | 11.6 s / 14.1 s |
| Stored job, 90th percentile / maximum | 21.3 s / 33.4 s |
| Fastest stored jobs | 5.7 s to 6.7 s |
| Time between one row and the next job's start | 0.07 s to 0.29 s |
| Gap with no stored Capture, mid-batch | 360.1 s |

The 360.1 s gap is three times the 120 s Recapture timeout (`DEFAULT_TIMEOUT_MS`), and three
Captures were not stored. The likeliest reading is that three jobs ran to the timeout, back to
back. Because failed jobs are not logged, this is an inference, not a measurement. **Three timed-out
jobs used 53% of the batch's wall time and produced nothing.**

Two further facts bear on #2121. The three Captures stored without a Transaction Record took
16.5 s, 13.5 s and 19.8 s from start to row. Each finished far inside its 120 s, so the time left
before the deadline (`timeLeftMs` in `finishTransactionRecord`) was not what cut them short. The
fixed bound of one of the two end phases expired: `BODY_COLLECT_TIMEOUT_MS` (5 s) or
`RECORD_WRITE_TIMEOUT_MS` (10 s). The log does not say which.

A list-scheduling model of the same 25 jobs, run in arrival order with the three timeouts at
120 s, reproduces the serial wall time (674 s against 673 s measured). Its estimates for more
workers are in [Concurrency](#concurrency).

### Measured elsewhere: individual steps

| Step | Figure | Source |
| --- | --- | --- |
| Full-page screenshot, fixture page | 211 ms | [renderer spike](2026-10-11-capture-engine-renderer-spike.md), `q2-savepage` timeline |
| `savePage` MHTML, fixture pages | 0 to 4 ms | renderer spike, question 2 |
| Transaction Record writer at the 50,000,000-byte cap | 1,397 ms (random bytes), 410 ms (one repeated byte) | [first-slice validation record](2026-10-26-capture-engine-first-slice-validation-assessment.md) |
| `printToPDF`, text page 1,000 to 50,000 CSS px tall | 16 ms to 111 ms | first-slice validation record |
| `printToPDF`, image page 4,000 to 50,000 CSS px tall | 172 ms to 1,915 ms | first-slice validation record |

These come from local fixture servers on an idle machine. They put an upper bound on what the
artifact steps cost when the network is not involved; they say nothing about the waits.

### Estimated: per-step cost of a typical page

No per-phase timing exists for a real page, because `renderPageInHiddenWindow` logs no phase
durations. The table gives each step's bound from the constants in
`src/main/services/backgroundRenderer.ts` and an estimated floor for a page that loads quickly and
stops growing. The floor is the time the step takes when nothing on the page holds it open.

| Step (in order) | Bound in code | Estimated floor | Basis of the floor |
| --- | --- | --- | --- |
| Window, partition, consent blocker, `about:blank`, recorder setup | none of its own; `pageSetupMs` 5 s per setup command | under 0.5 s | estimate |
| `loadURL(url)` until `did-finish-load` | **none of its own**; only the 120 s deadline | 1 s to 3 s | estimate |
| Document complete, then network idle | `INITIAL_NETWORK_IDLE_MAX_MS` 10 s | 1.2 s (`NETWORK_IDLE_MS`) | constant |
| Scroll-to-load | `MAX_SCROLL_PHASE_MS` 75 s | 2 s: three stalled steps at `SCROLL_PAUSE_MS` 500 ms, plus the reset pause | constant |
| Post-scroll network idle | `POST_SCROLL_NETWORK_IDLE_MAX_MS` 15 s | 1.2 s | constant |
| Final settle | `FINAL_SETTLE_MS` 0.5 s | 0.5 s | constant |
| Image set settle, then Image Source Pinning | `IMAGE_SET_SETTLE_MAX_MS` 5 s, `PIN_LOAD_MAX_MS` 5 s | under 0.2 s | estimate |
| Screenshot, MHTML save, text | inside the 20 s `ARTIFACT_PHASE_MS` reserve | 0.2 s to 2 s | measured on fixtures, scaled by page height |
| Transaction Record: body collection, then writer | 5 s, 10 s, each cut to the time left less 1 s | 0.1 s to 1.5 s | writer measured; collection estimated |
| PDF print | `PRINT_TIMEOUT_MS` 5 s | under 2 s | measured on fixtures |
| Ingest: hash, TLS Cert Chain fetch, files, manifest entry, row | the TLS fetch only, 10 s (`DEFAULT_TIMEOUT_MS` in `tlsCertChain.ts`) | under 1 s plus the TLS fetch | estimate |

The floors sum to about 6 s to 8 s, which matches the fastest measured jobs (5.7 s to 6.7 s). The
pre-artifact phases share 80 s, because each is clipped to the time left less
`FINAL_ARTIFACT_RESERVE_MS` (40 s); the last 40 s are held for the artifacts, the Transaction Record
and the PDF.

Two steps can hold a job until the 120 s deadline:

- **`await wc.loadURL(url)`** has no bound of its own. Electron resolves it on `did-finish-load`,
  so a page whose `load` event never fires holds the job until the deadline. This is the
  likeliest cause of the three timeouts, and it is a hypothesis: slice 1 records the phase a
  timed-out job reached.
- **A scroll that keeps growing** runs until `MAX_SCROLL_PHASE_MS` or the height cap. This ends in
  a stored Capture, not a timeout, because the phase is clipped to leave the reserve.

The October 2026 additions (#1996 Scroll-to-load record, #1999 Transaction Record, #2000 PDF,
#2002 image pinning, all merged 2026-10-30) add about 1 s to 3 s to a typical job by these
figures. The PDF reserve raised the end reserve from 35 s to 40 s (validation record, ruling of
2026-10-26), which shortens the scroll budget but does not lengthen a fast job. Serial execution
and timeouts explain the batch; the added steps do not.

## Goals

- A Batch stores its Captures in at most two-thirds of the serial wall time on the slice 6
  comparison batch, on a machine with 8 or more logical CPUs, without raising the rate of
  Transaction Records absent as `failed`. Two workers meet this by the estimate in
  [Concurrency](#concurrency). The rest of the wall time goes to jobs that hang until the 120 s
  timeout, which the page-load follow-up owns (see [Follow-ups](#follow-ups)).
- Every queued URL has a visible state from the moment it is accepted until it ends, and the state
  survives a restart.
- A job that ends without a Capture says why, in the app and in the log.
- The Operator can cancel a queued or running job and retry a failed one.

## Non-goals

- The batch entry and batch view UI. Issue #2124 owns them and reads the state defined here.
- Changing what a background Capture contains, its manifest entry, or its inventory.
- Changing any bound in the Transaction Record. Issue #2121 owns that; this design orders its work
  so that #2121's instrumentation lands first.
- Scheduled or recurring Recapture.

## Design

### Stored job table

Each accepted URL becomes one row in a new table, `background_jobs`. A row is the job's state, not
evidence: it never enters the Manifest, a Case Archive, or an export, and nothing that verifies a
Capture reads it. It sits outside the Manifest for the reasons
[ADR-0042](../adr/0042-investigation-records-are-case-data-outside-the-manifest.md) and
[ADR-0044](../adr/0044-case-search-indexes-are-rebuildable-caches-outside-the-manifest.md) give for
other operational rows, and it lives in the encrypted live store
([ADR-0049](../adr/0049-the-live-store-is-encrypted-at-rest.md)) because it holds URLs.

```sql
CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  url TEXT NOT NULL,
  supersedes_capture_id TEXT,
  linked_from_capture_id TEXT,
  link_href TEXT,
  state TEXT NOT NULL
    CHECK (state IN ('queued', 'held', 'running', 'stored', 'skipped', 'failed', 'cancelled')),
  phase TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL,
  resumed_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  capture_id TEXT,
  failure_kind TEXT,
  error TEXT,
  warning TEXT,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE INDEX idx_background_jobs_state ON background_jobs(state, queued_at);
CREATE INDEX idx_background_jobs_batch ON background_jobs(batch_id);
```

| Column | Meaning |
| --- | --- |
| `id` | The job id, a UUID. Every event about the job carries it. |
| `batch_id` | The job's Batch: one per `recapture:enqueue` or `recapture:enqueueCaptures` call, so #2124 can group a paste. A retry keeps it. |
| `supersedes_capture_id`, `linked_from_capture_id`, `link_href` | The `RecaptureJob` fields today, so a job read back after a restart runs exactly as it was queued. `linked_from_capture_id` has no foreign key: `readLinkSource` already refuses a job whose source is gone. |
| `phase` | The last progress phase while `running`; see [Events](#events-and-the-renderer-contract). |
| `attempts` | Attempts the worker has claimed for this job. Each claim adds one, the claim after a retry included; the retry itself adds nothing. |
| `queued_at`, `resumed_at` | When the job was accepted, and when the Operator last resumed its Batch or retried the job. The worker claims by `resumed_at` when set, otherwise `queued_at`, so a resumed or retried job runs after the jobs already queued at that moment and ahead of later ones; `queued_at` never changes. |
| `capture_id` | Set when the attempt starts, to the id `runJob` generates and the Transaction Record's `warcinfo` names. It names a stored Capture only in state `stored`. No foreign key, so deleting the Capture keeps the job's history. |
| `failure_kind` | For `failed`: `timeout`, `render`, `ingest`, `link-source-error` (the link source check threw), or `interrupted`. For `skipped`: `excluded`, `refused-address`, or `link-source`. |
| `error`, `warning` | The message the terminal event carries today (`error`, `skipReason`, `warning`). |

#### States

```text
queued -> running -> stored
                  -> skipped     (exclusion, refused address, link source refused)
                  -> failed      (timeout, render error, ingest error)
queued -> held                   (startup, for a job queued in an earlier session)
held -> queued                   (Operator resumes the job's Batch)
queued | held -> cancelled
running -> cancelled             (Operator cancel before ingest starts)
failed | cancelled -> queued     (Operator retry; attempts + 1)
```

`stored`, `skipped`, `failed` and `cancelled` are terminal until the Operator retries. A job in
`skipped` is not retried: the same rule would refuse it again. Retries are the Operator's only: a
timed-out job ends `failed` with `failure_kind = 'timeout'` and waits, because a retry is a new
observation at a later time and a page that hung once usually hangs again.

#### Restart and snapshot restore

At startup, before the queue runs:

1. A `running` row whose `capture_id` names a Capture in the row's Case becomes `stored`: the app
   closed after the ingest committed and before the row was finished. Every other `running` row
   becomes `failed` with `failure_kind = 'interrupted'`. The app closed during its render or
   ingest. The ingest's write-ahead seam (`withManifestEntry`) already rolls back a manifest entry
   whose row never landed, so an interrupted job leaves no partial Capture. It is not re-run
   without the Operator, because a re-run is a new observation at a later time.
2. Every `queued` row becomes `held`. A held job runs only after the Operator resumes its Batch.
   Between sessions the Egress setting, the network, or the Operator's intent can change, and a
   held job sends no request the Operator did not start in this session. The hold is per Batch,
   not on the queue: a Batch queued in this session runs at once, ahead of held ones, so a fresh
   paste never waits behind work from an earlier session.

Restoring a database snapshot or a backup file can bring back rows from the past. A restore
re-opens the database in the running app, so the same pass runs right after a restore that
succeeds, before the queue can claim a restored row.

Deleting a Case deletes its jobs through the foreign key. A running job whose Case is deleted
fails at ingest, as it does today.

The exclusion list is checked at enqueue, and again on the final URL after the render. With jobs
that survive a restart, the list can change between the two, so the worker also checks `job.url`
before it renders. A job refused there ends `skipped` with `failure_kind = 'excluded'`, and no
request is sent.

Retention depends on how the job ended. A `stored` row is deleted at startup once it is older than
7 days, because its Capture is the lasting record and the row only repeats a URL outside the
Manifest. A `failed`, `skipped` or `cancelled` row is the only record of why a URL never became a
Capture, so it stays until the Operator dismisses it, retries it, or deletes its Case.

#### Migration

The table is one new schema version, scaffolded with `pnpm db:migration:new background-jobs`,
which appends a fail-closed `if (version < N)` block to `src/main/services/db/migrations.ts` and
bumps `LATEST_SCHEMA_VERSION` in `src/main/services/db/core.ts` (45 at the frame of reference, so
46 unless another migration lands first). The block creates the table and indexes inside
`db.transaction`, uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` so that a
restored copy marked one version back can run it again (the precedent of the v43 to v45 blocks),
and sets `user_version`. It reads and alters no existing table, so it carries no data migration.
A new repository, `src/main/services/db/backgroundJobRepo.ts`, owns every read and write. The
table is not added to `ALLOWED_TABLES` in `dbAdmin.ts`, so Settings -> Database cannot edit it.

### Bounded parallel workers

#### Shape

`drain()` becomes a pool of up to `concurrency` worker loops. Each loop claims the next `queued`
row in claim order (`resumed_at`, then `queued_at`) in one synchronous statement (better-sqlite3
runs in the main process, so two loops cannot claim the same row), sets it `running`, and calls `runJob`. Each job keeps its own hidden window
and its own in-memory partition, as the Recapture design requires; nothing is shared between
renders.

**One running job per site.** A loop claims the next `queued` row whose site has no job
`running`, so a Batch with several pages on one site never loads that site twice at once.
Concurrent requests to one server can trip rate limits or bot checks, which changes what a Capture
holds. The site is the registrable domain from `tldts` (already a dependency), so
`www.example.com` and `example.com` share a slot; an IP address or a host with no registrable
domain is its own site. The cost falls on single-site Batches, which run one at a time as today.

Rendering runs in parallel. **Ingest runs one at a time per Case.** `withManifestEntry` rolls a
failed ingest back by truncating `manifest.jsonl` to the byte offset taken before its append
(`rollbackManifestEntry`). Today the ingest callback in `captureLifecycle.ts` makes no `await`
between the append and the row insert, and `nextExhibitNumber` relies on that, so two ingests
into one Case can interleave only within one microtask. A pool makes concurrent ingests into one
Case the normal case, because every job in a batch targets the same Case, and a truncation that
lands after another job's append would remove that job's entry while its row survives. The
lifecycle therefore runs the step from `nextExhibitNumber` through the row insert under a per-Case
slot, the pattern `withCaseSlot` already applies to deletes (#394). The hashing and the TLS Cert
Chain fetch before it, which can take up to 10 s, stay outside the slot. The section inside it
writes files and one row, so the slot costs little. Slice 5 moved `withCaseSlot` to module scope in
`captureLifecycle.ts`, so an ingest into a Case also waits for that Case's deletes and duplicates,
and they wait for it.

With parallel renders, Manifest order is ingest order, and a Capture's `timestamp` is its job's
start. Two adjacent entries can therefore carry timestamps out of order: job B starts after job A
and is stored first. This already happens when an extension Capture arrives during a background
render. A search of `src/shared/verify/` and `src/main/services/manifest.ts` found no check that
compares a capture entry's timestamp with the previous entry's; the reviewer of the pool slice
confirms that.

#### The consent blocker

The comment on `cleanup` in `renderPageInHiddenWindow` records that
`ElectronBlocker.enableBlockingInSession` registers global `ipcMain` handlers, and that a second
session enabling them while they are registered throws. The render catches that throw, logs
`backgroundRenderer.consent_blocker_enable_failed`, and continues without Consent Suppression. With
two concurrent renders, the second would store a Capture that records no Consent Suppression, and
nothing would fail.

Before concurrency rises above 1, the pool slice confirms the behaviour against the pinned
`@ghostery/adblocker-electron` (`^2.20.3`) and either:

- enables the blocker in more than one session at a time, if the pinned version supports it, with
  a test that two concurrent renders both record `consentSuppression: 'filter-list'`; or
- holds a process-wide lease on the blocker, so a second render waits for it before loading its
  page. That lease serializes the load phase of renders, and would remove most of the gain.

If neither works, concurrency stays at 1 and this spec's pool slice stops at that finding.

Slice 5 checked the pinned version (2.20.3) and took the first option. `BlockingContext.enable`
registers a preload script and the network filters on the session, and two handlers on the global
`ipcMain`; `disable` removes all of them. The two handlers forward to the engine and answer the
frame that called them, so one registration serves every session. `enableConsentBlocking` and
`disableConsentBlocking` in `consentBlocker.ts` own that registration: they remove it before the
library registers it again for a second session, and register it again after a disable while
another session is still enabled. A render whose engine differs from the one already enabled is
refused, and records no suppression.

A one-off probe on 2026-11-09, a script run once in Electron 45.2.1 and not kept in the repository,
showed what that second render held. Two offscreen windows in two sessions loaded a local page with
an element a cosmetic filter hides and a script a network filter blocks. With the library alone, the
second session's enable threw after its preload script was registered and before its network
filters were: its cosmetic filters still applied through the first render's handlers, its network
filter did not, and the render would have recorded no Consent Suppression. With the two functions
above, both kinds of filter applied in both sessions, and in the second after the first ended. The
unit tests that pin this behaviour run the pinned library against a test double of `ipcMain`.

If the library's undo of a failed enable also fails, the session may keep some filters, so the
render ends with `ConsentBlockingUndoFailed` rather than storing a Capture that records none.

The lease was not needed. Had it been, it would have serialized more than the load phase: the
render keeps the blocker enabled until its cleanup, after the PDF.

#### Concurrency

**Recommended default: 2.** Computed at startup as
`clamp(floor(os.availableParallelism() / 4), 1, 2)`, so a machine with fewer than 8 logical CPUs
runs 1. A worker does not start another job while `os.freemem()` is under 1.5 GB. The 4-CPUs-per-
render ratio and the 1.5 GB floor are estimates to check against slice 1's timings, not
measurements. Settings has no control for it. `BIRDBRAIN_BACKGROUND_WORKERS`, clamped to 1 and 2,
overrides the formula, as `BIRDBRAIN_CONSENT_LISTS` and `BIRDBRAIN_WINDOW_SIZE` override their
defaults; slice 6 uses it for its comparison, and support can use it to force 1.

Estimated wall time for the 2026-11-09 batch, from the list-scheduling model. The slowdown factor
stretches every non-timeout job when workers compete; the timeouts stay at 120 s. The model
ignores the one-job-per-site rule, so it assumes no two jobs that would run together share a site.

| Workers | No slowdown | 1.25x slowdown | 1.5x slowdown |
| --- | --- | --- | --- |
| 1 | 674 s | 674 s | 674 s |
| 2 | 350 s | 377 s | 424 s |
| 3 | 234 s | 262 s | 290 s |
| 4 | 190 s | 207 s | 226 s |

Reasons for 2 rather than more:

- **Returns fall off.** Two workers remove about half the wall time. Past that, the three 120 s
  timeouts form the long pole, and the next gain comes from finding out why pages hang, not from
  more workers.
- **Each worker costs a renderer process and main-process work.** Every render is an offscreen
  window compositing at 30 frames per second (`setFrameRate(30)`), and its screenshot can reach
  `MAX_CAPTURE_PIXELS` (32,000,000 pixels, about 128 MB as a raw bitmap). Its Transaction Record
  can hold up to `TRANSACTION_RECORD_TOTAL_BYTES` (50,000,000 bytes) in the main process before
  the writer runs. Hashing, gzip and sharp share Node's libuv thread pool, which has 4 threads
  unless `UV_THREADPOOL_SIZE` changes it.
- **The #2121 bounds are wall-clock.** See the next section.

Slice 6 built the pool with these choices:

- **The site is worked out at claim time**, not stored with the row. A slot skips a queued row
  whose site matches one of the jobs this process is running, and claims the first row that does
  not, in one transaction. The running set comes from the process rather than the rows, because a
  restore can replace the rows while a render goes on. No column is added, so a database already
  at version 46 needs nothing more. `tldts` reads the public suffix list's ICANN section only, so
  `a.github.io` and `b.github.io` share one site.
- **The memory floor holds only a second job.** The first job of an idle queue always starts, as a
  single worker's would; otherwise a machine with less than 1.5 GiB available would never capture
  in the background. A held slot looks again every 2 s and whenever a running job ends. On Linux,
  `os.freemem()` under the bundled Node 24.22 returns MemAvailable, which counts reclaimable page
  cache, not MemFree.

Slice 6 ran the comparison on 2026-11-09 on the built app, on a machine with 18 logical CPUs. Each
pair ran back to back, once with 1 first and once with 2 first. The 1-minute load average stayed
under 3 during every run.

| Batch | Workers | Wall time, first start to last end | Stored / failed / skipped | Transaction Record `failed` |
| --- | --- | --- | --- | --- |
| 10 local fixture pages | 1 | 54.9 s, 54.8 s | 10 / 0 / 0 | 0 of 10 |
| 10 local fixture pages | 2 | 31.2 s, 31.2 s | 10 / 0 / 0 | 0 of 10 |
| 20 public pages on 20 sites | 1 | 218.4 s, 215.8 s | 20 / 0 / 0 | 0 of 20 |
| 20 public pages on 20 sites | 2 | 110.7 s, 110.1 s | 20 / 0 / 0 | 0 of 20 |

Two workers took 57% of the serial wall time on the fixture batch and 51% on the public batch,
inside the two-thirds goal, and each job took within 1.5 s of its serial time. No Transaction
Record was absent as `failed` in either run, so the default stays the formula. With no failures at
either concurrency, the runs cannot show a small rise in the rate; the per-job logging from slice 1
is what would show one in use.

#### Effect on the #2121 time bounds

The Transaction Record's end phases run under fixed wall-clock bounds (`withinMs` in
`src/main/services/transactionRecorder.ts`), each also cut to the time the render has left. CPU
contention stretches both phases without moving their bounds:

- **The writer** (10 s) is CPU-bound gzip in the main process. Measured at 1,397 ms for the
  50,000,000-byte cap on an idle machine, it has about 7 times headroom. Two workers are unlikely
  to use that; four rendering heavy pages could.
- **Body collection** (5 s) waits on the network and on CDP messages the main process handles.
  The 2026-11-09 failures happened at concurrency 1 in jobs that had plenty of time left, so this
  bound already expires without contention. Contention adds delay to every message the collector
  waits on.

This design does not change either bound. It orders the work so that the evidence comes first:

1. Slice 1 lands #2121's first step: log which bound expired and the time left when the finish
   started, and log every phase's duration.
2. The pool slice runs a fixed batch of fixture pages and a recorded set of public pages at
   concurrency 1 and 2, and reports the rate of Transaction Records absent as `failed` at each. If
   the rate at 2 is higher, concurrency stays at 1 by default until #2121 resolves the cause.

The inventory already records a lost Transaction Record honestly as `failed`, so contention cannot
make a Capture claim a record it lacks. It can make the record absent more often, which is a loss
of evidence the Operator asked for.

#### The 120 s timeout when jobs compete

The deadline timer in `renderPageInHiddenWindow`, and the fallback timer in `runJob`, both start
when the render starts. Time a job spends `queued` never counts against its 120 s. Under contention
each phase takes longer, and the phases before the artifacts are clipped to leave the 40 s reserve,
so a slow job ends with a shorter Scroll-to-load (recorded in its `scrollToLoad` outcome), not a
timeout. The two places a slow machine can still turn into a timeout are the unbounded `loadURL`
and the artifact steps overrunning their reserve.

The timeout stays 120 s and does not scale with concurrency. Scaling it would let a hung page hold
a worker longer, which the batch shows is the costliest failure. Slice 1's phase log shows whether
the reserve holds at concurrency 2.

### Events and the renderer contract

#### Job identity

`RecaptureJob` gains `jobId` and `batchId`. `CaptureEvent` in `src/shared/types.ts` gains two
optional fields, `jobId` and `batchId`, set on every event a background job emits. The renderer
matches a terminal event to its `received` row by `jobId` when present, and falls back to `url`
and `source` for events from other sources (the extension and the launched browser), which carry
no job.

`supersedesCaptureId` and `linkedFrom` stay on the events, so `CaptureDetailsPanel` and
`CaptureMenu` keep working while they move to the job view.

#### A queued event

`CaptureEvent.type` gains `'queued'`, emitted once per accepted job at enqueue. The activity feed
shows it; it does not count toward `captureStats`. The 50-event cap stays for the feed, so job state
does not live in `captureEvents`.

#### Job state for #2124

A second channel, `RECAPTURE_JOB`, sends a `BackgroundJobView` whenever a job's state or phase
changes. This is the state model #2124 reads:

```ts
type BackgroundJobState =
  'queued' | 'held' | 'running' | 'stored' | 'skipped' | 'failed' | 'cancelled'

type BackgroundJobPhase =
  | 'loading' // window setup, loadURL, document complete, first network idle
  | 'scrolling' // Scroll-to-load and the network idle after it
  | 'settling' // final settle, image set settle, Image Source Pinning
  | 'artifacts' // screenshot, MHTML save, text
  | 'transaction-record'
  | 'pdf'
  | 'ingesting'

interface BackgroundJobView {
  jobId: string
  batchId: string
  caseId: string
  url: string
  state: BackgroundJobState
  phase?: BackgroundJobPhase // only while running
  attempts: number
  queuedAt: string
  startedAt?: string
  finishedAt?: string
  captureId?: string // only when stored
  failureKind?: string
  error?: string
  warning?: string
  supersedesCaptureId?: string
  linkedFrom?: LinkedFrom
}
```

Slice 1 added an optional `onStep(step)` callback to `RenderPage`'s options, which the renderer
calls as it starts each of its ten steps. Slice 4 maps those steps onto the seven phases above
rather than adding a second callback, and adds an optional `AbortSignal`. The service writes the
phase to the row and emits the view; it does not write timing into the row.

#### IPC

| Channel | Change |
| --- | --- |
| `recapture:enqueue`, `recapture:enqueueCaptures` | `EnqueueResult` gains `batchId` and the accepted `jobIds`. |
| `recapture:queueStatus` | `RecaptureQueueStatus` gains the counts `queued`, `running` and `held`, and `concurrency`. `pending` stays `queued + running`, which #2122 reads. `activeUrl` stays, as the first running job's URL, until its readers move. `e2e/vpn-warning.spec.ts` asserts the exact status object with `toEqual`, so slice 2 updates that assertion. |
| `recapture:listJobs` (new) | Returns `BackgroundJobView[]` for a Case or a batch, so the renderer can load state after a reload or a restart. |
| `recapture:cancel` (new) | Takes a `jobId` or a `batchId`. A queued or held job becomes `cancelled`. A running job is aborted through its `AbortSignal`, which takes the render's existing deadline path (window destroyed, temp file removed, nothing stored), and ends `cancelled`. A job is ingesting from the moment its render returns its page, when its phase becomes `ingesting`; a cancel from then on is refused and the job ends as the ingest does, so cancel never interrupts the manifest seam. A cancel that arrives after the deadline or a refused hop has already ended the render is refused too, and the job ends as that ending decided. The result counts the jobs cancelled and the running job refused. A cancelled job's feed row ends with a `skipped` event whose reason is `Cancelled`. |
| `recapture:retry` (new) | Takes a `jobId` in `failed` or `cancelled`, or a `batchId`, which retries that Batch's `failed` and `cancelled` jobs. Sets each `queued`, behind the jobs already queued, and clears the last attempt's fields. The claim of the next attempt adds one to `attempts` and generates a new `capture_id`. |
| `recapture:resume` (new) | Takes a `batchId`, sets its `held` jobs `queued` and records the resume in `resumed_at`. |
| `recapture:dismiss` (new) | Takes a `jobId` or a `batchId` and deletes `failed`, `skipped` and `cancelled` rows. It never deletes a `stored`, `queued`, `held` or `running` row. |

Retries are Operator-initiated only; see [States](#states).

## Evidence-path impact

Tiers are from the include list in the
[evidence-affecting path assessment](2026-07-31-evidence-affecting-paths-assessment.md), as tiered
by [ADR-0014](../adr/0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md).

| File | Tier | What the implementation changes there |
| --- | --- | --- |
| `src/main/services/recapture.ts` | blocking | Job ids, the stored queue, the worker pool, per-Case ingest slots, cancel, retry, the pre-render exclusion check |
| `src/main/services/backgroundRenderer.ts` | blocking | Phase callback, abort signal, phase-duration logging, the consent blocker lease or multi-session enable |
| `src/main/services/consentBlocker.ts` | blocking | The multi-session enable and disable (slice 5) |
| `src/main/services/transactionRecorder.ts` | blocking | Slice 1 only: name the bound that expired in its error. No bound changes |
| `src/main/services/captureLifecycle.ts` | blocking | The per-Case slot around the manifest append and row insert in the ingest |
| `src/main/services/db/**` | blocking | The migration, `core.ts`, and `backgroundJobRepo.ts` |
| `src/main/index.ts` | blocking | Wiring: concurrency, the job channel, the startup pass |
| `src/main/ipcHandlers.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/shared/constants.ts` | advisory | New channels and fields |
| `src/renderer/stores/**`, `src/renderer/components/status/**`, `src/renderer/components/captures/CaptureDetailsPanel.tsx`, `src/renderer/lib/api/**` | excluded | Job-id matching and the job view |

Every slice except the renderer-only work touches a blocking path. Each such PR carries the
`evidence-affecting` label and owes the ADR-0004 obligations: an Evidence impact section, a
known-answer test or a written justification, and preserved backward verification. It gets the
maintainer's review, never auto-merges, and needs the maintainer's approving review or the
`approved` label at head ([ADR-0041](../adr/0041-merges-are-requested-by-label.md)). If an agent
implements a slice, the gates of
[ADR-0005](../adr/0005-unattended-agents-on-the-evidence-path.md) apply to it.

What each Evidence impact section has to answer:

- **Content.** The pool changes when observations happen, not what a Capture holds. The
  known-answer test runs the Recapture end-to-end specs at concurrency 2 and asserts the same
  inventory, `scrollToLoad` and `consentSuppression` as at concurrency 1 for each fixture page.
- **Consent Suppression.** Two concurrent renders both record `filter-list`.
- **Manifest integrity.** A unit test runs two jobs into one Case, fails the first ingest after
  the second render finishes, and asserts the second's entry survives and the chain verifies.
- **Absence rates.** The Transaction Record `failed` rate at concurrency 1 and 2 on the same batch.
- **Backward verification.** No manifest entry, schema or verifier changes, so existing Cases
  verify as before. The migration adds a table and alters none.

## Alternatives rejected

- **Keep the queue serial and shorten the steps.** The fixed waits add about 6 s per job; the batch
  lost 360 s to three timeouts. Shortening the waits also shortens what the page has to load lazy
  content, which changes Captures.
- **One worker per logical CPU.** Uncapped renders compete for the main process and the libuv pool,
  stretching the #2121 bounds and the artifact reserve on the machines least able to absorb it.
- **Reuse one hidden window across jobs.** A fresh window and partition per job is a security
  property of the Recapture design: a hostile page must not see state from an earlier job.
- **Persist the queue in a JSON file under `userData`.** The database already has migrations, the
  restore path, encryption at rest, and Case delete through foreign keys. A file would need each of
  those again.
- **Scale the 120 s timeout with concurrency.** It lets a hung page hold a worker longer, the
  failure that cost this batch the most.
- **Resume queued jobs automatically at startup.** Requests could go out under an Egress or an
  intent that changed since the Operator queued them.
- **Hold the whole queue at startup until one resume.** A Batch pasted in the new session would sit
  behind held jobs and look stuck.
- **Retry a timed-out job once on its own.** A hung page usually hangs again, costing another
  120 s of a worker, and the retry is an observation the Operator did not ask for.
- **A concurrency control in Settings.** Values above 2 are untested against the #2121 bounds; the
  environment override covers testing and support until the formula proves wrong.
- **Delete every terminal row after 7 days.** A failure could disappear before the Operator saw
  it.

## Slice plan

Each slice ships on its own and leaves the app working.

1. **Instrument the render and the queue.** Log each phase's duration per job, the phase a
   timed-out or failed job reached, which Transaction Record bound expired and the time left, and
   every `failed` and `skipped` job. No behaviour change. Covers #2121's suggested first step.
   Blocking tier.
2. **Job ids and the queued event, in memory.** `jobId` and `batchId` on jobs and events, the
   `queued` event, renderer matching by `jobId`, and the extra `RecaptureQueueStatus` counts. Fixes
   same-URL rows clearing each other. Blocking tier (`recapture.ts`), no evidence change.
3. **Stored job table.** The migration, `backgroundJobRepo.ts`, the service reading and writing
   rows, the startup pass with per-Batch holds and retention, `recapture:listJobs`,
   `recapture:resume`, `recapture:dismiss`, the job channel, the pre-render exclusion check, and a
   minimal resume control for held Batches on the capture status button. The check comes here
   because this is the first slice where a job can wait across a session while the list changes.
   Concurrency stays 1. Blocking tier (`db/**`).
4. **Progress, cancel and retry.** The phase, mapped from slice 1's `onStep` steps, the
   `AbortSignal`, `recapture:cancel`, and `recapture:retry` for a job or a Batch. Blocking tier.
5. **Make parallel renders safe at concurrency 1.** The per-Case ingest slot and the consent blocker
   fix, each with its test, while the pool still runs one worker. Blocking tier.
6. **Turn on the pool.** Concurrency from the formula, the `BIRDBRAIN_BACKGROUND_WORKERS`
   override, the one-job-per-site claim, the free-memory gate, and the concurrency 1 against 2
   comparison in the PR's Evidence impact section. If the comparison fails,
   the default stays 1 and the pool ships switched off. Blocking tier.

Issue #2124's batch view can start after slice 3, and gets progress and cancel after slice 4.

## Decisions

The maintainer answered these in a Claude Code grilling session on 2026-11-09. The sections above
already reflect them.

1. **Restored queue at startup.** The maintainer chose to hold jobs from an earlier session per
   Batch until resumed, with new Batches running at once, over holding the whole queue or resuming
   automatically.
2. **Concurrency control.** The maintainer chose the fixed formula with an environment override
   and no Settings control.
3. **Automatic retry.** The maintainer chose retries by the Operator only.
4. **Retention.** The maintainer chose to delete `stored` rows after 7 days and keep `failed`,
   `skipped` and `cancelled` rows until dismissed, retried, or removed with their Case.
5. **One running job per site.** The maintainer chose to add the per-site limit.
6. **Speed goal.** The maintainer chose at most two-thirds of serial wall time over keeping "less
   than half" with 3 workers.
7. **Glossary.** The maintainer chose **Background Job** and **Batch** as the terms, now in
   `CONTEXT.md`.

## Follow-ups

- **A bound for the page load.** `loadURL` has no bound of its own, so a page whose `load` event
  never fires holds a worker until the 120 s deadline. A bound would store such a page as rendered
  instead of failing it, which changes what that Capture holds. The maintainer chose to decide it
  after slice 1 logs the phase each timed-out job reached, in its own evidence-affecting design,
  with an ADR if a bound is adopted.
