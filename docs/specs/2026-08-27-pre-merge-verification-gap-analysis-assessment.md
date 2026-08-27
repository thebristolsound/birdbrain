# Pre-merge verification and review gap analysis

**Date:** 2026-08-27
**Type:** Assessment
**Scope:** Repository-wide audit of pre-merge verification and review practice, benchmarked against a
six-pillar quality and security standard: policy artifacts, deterministic CI, adversarial testing,
scoped review agents, release operability, and merge gates.

**Method:** Direct inspection of `.github/workflows/`, `.github/pull_request_template.md`,
`.github/dependabot.yml`, `.coderabbit.yaml`, `.claude/agents/`, `eslint.config.js`, the six tsconfig
projects, `vitest.config.ts`, `tests/` (233 test files), `e2e/` (26 specs plus charters), `docs/`,
`CONTEXT.md`, `SECURITY.md`, `CONTRIBUTING.md`, `src/main/services/`, and the live branch ruleset read
through `gh api repos/thebristolsound/birdbrain/rulesets/14967088`. Every claim below cites the file it
came from.

**What this assessment is not:** it does not score the quality of the code under the gates, and it does
not re-verify the gates by running them. It reports which controls exist, which do not, and what the
absence costs.

---

## 1. What is implemented

The short version: the process and policy layer is unusually strong for a solo-maintained project, the
CI layer is strong and well-reasoned, and the enforcement layer is where the gap sits — several
existing controls run on every pull request and block nothing.

### Repository context and policy artifacts

- **`CONTEXT.md`** carries the assurance baseline (the canonical definition of an evidence-affecting
  change) and a glossary with explicit `_Avoid_` synonym lists.
- **`CLAUDE.md`** is the architecture map: process model, key directories, path aliases, the IPC
  pattern, the data-access layer, the theme system, and the testing topology.
- **`SECURITY.md`** enumerates the complete outbound network egress list (six destinations), the
  loopback-bind and per-installation-token model, renderer isolation, secrets at rest, and a
  pre-declared known-limitations list — unsigned release artifacts, the `unsafe-inline` CSP, the
  `safeStorage` plaintext fallback, and unauthenticated loopback GET endpoints.
- **`website/content/docs/threat-model.mdx`** is the published threat model for the forensic
  guarantees, and `SECURITY.md` points at it as the authority on what they do not defend against.
- **`CONTRIBUTING.md`** gives development setup, the five-command validation loop, the
  evidence-affecting policy with the strict-mode `BIRDBRAIN_REQUIRE_OPENSSL=1` variant, and inbound
  licensing.
- **`docs/`** holds 22 architecture decision records, six agent-convention docs including a Vale-backed
  writing guide, and 39 dated specs — among them the tiered evidence-affecting path inventory
  (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`) that the review gate keys on.
- **`.github/pull_request_template.md`** already exceeds the benchmark on every axis it was measured
  against. It requires a verification checklist tied to named commands, test coverage and manual
  checks, visual evidence, a **Risk and recovery** section, a **Security and privacy impact** section
  where "None" must be said explicitly, an **Evidence-affecting change review** with a required
  **Evidence impact** subsection covering what verification proves and does not prove and whether
  backward verification is preserved, and a four-item author checklist.

### Deterministic CI and static verification

`.github/workflows/ci.yml` runs six jobs behind a `changes` path-filter job, with per-job timeouts,
per-pull-request concurrency cancellation, every action pinned to a full commit SHA, and
`persist-credentials: false` on every checkout that does not need a token:

| Job | What it enforces |
| --- | --- |
| `lint` | `pnpm lint` — ESLint 9 flat config, typescript-eslint recommended |
| `typecheck` | `pnpm typecheck` — six tsconfig projects, including `tests/` and `e2e/` |
| `test` | `pnpm test:coverage` under `BIRDBRAIN_REQUIRE_OPENSSL=1`, then `scripts/diff-coverage.mjs` |
| `build` | `pnpm build` and `pnpm build:extension` |
| `e2e` | Playwright driving Electron under `xvfb-run` |
| `docs-build` | `website/` typecheck and static export, on pull requests that touch it |

Coverage is gated twice: `vitest.config.ts` sets a barbell of per-glob thresholds — 90% lines and
statements on `src/main/services/*.ts` and `src/shared/**/*.ts`, per-file gates on `ipcHandlers.ts` and
`ipcWrap.ts`, 90% on the React Query data layer, and a global ratchet — and `scripts/diff-coverage.mjs`
separately fails a pull request under 90% of changed lines covered.

`.github/workflows/security.yml` runs three jobs on every push and pull request:

- **Secret scan** — gitleaks over `--log-opts="--all"`, so every commit on every ref is scanned. The
  binary is verified against a recorded SHA-256 before it is executed, because a release tag is not
  immutable. False positives are allowlisted by fingerprint in `.gitleaksignore`.
- **Dependency audit** — `scripts/audit-check.mjs` audits both dependency trees and fails on any high
  or critical advisory not cleared by a `pnpm-workspace.yaml` override or covered by an unexpired
  entry in `audit-exceptions.json`. Exceptions carry an expiry capped at 180 days, so an accepted
  finding gets re-decided rather than inherited.
- **Registry publish guard** — asserts `package.json` still carries `"private": true`.

Static verification beyond the linters: TypeScript `strict` in all six projects; a
`no-restricted-imports` rule that confines raw database connection access to
`src/main/services/db/`; and a measured suppression count in `src/` of seven `eslint-disable`
comments, zero `@ts-ignore` or `@ts-expect-error`, and zero `as any` or `<any>`.

`.github/workflows/pre-pass-gate.yml` seeds an `agent/pre-pass` commit status so an agent pull request
shows a pending reviewer verdict in the merge box.

### Behavioral, adversarial, and state-integrity testing

- **233 unit test files** across two Vitest projects (Electron-runtime node, and jsdom for components
  and hooks), plus **26 Playwright specs** and six exploratory-testing charters under `e2e/charters/`.
- **Untrusted input is validated at the boundary.** `src/main/services/captureServer.ts` applies
  `zValidator` from `@hono/zod-validator` on five routes against schemas in `src/shared/schemas.ts`.
- **Known-answer tests on the forensic core**, with a fail-loud guard: the RFC 3161 proof shells out to
  `openssl ts -verify`, and `BIRDBRAIN_REQUIRE_OPENSSL=1` stops the keystone test skipping itself into
  a false green. CI asserts `openssl version` before the suite runs.
- **Round-trip and invariant tests**: `caseArchiveRoundTrip`, `exportTsaVerify`,
  `manifestPackageHash`, `reportCitationInvariants`, `reportLayoutInvariants`, and verification
  fixtures including a `pre-scope-package` manifest that proves backward verification.
- **Error-path tests** on every external boundary: `waybackMachine`, `timestamp`, `timestampWorker`,
  `tsaTrust`, `tlsCertChain`, `openrouter`, `updater`, `serverToken`, `safeRegex`, and the extraction
  `sanitizer`.
- **Migration back-compatibility tests**: `captureTextsMigration.test.ts` pins `user_version = 24` and
  migrates a minimal pre-v25 schema forward; `dbSnapshotsIntact` and `dbSnapshotsRestore` cover the
  pre-migration snapshot and its restore path; `database.test.ts` asserts `user_version` after
  individual migration blocks.
- **One concurrency test**: `tests/extension/manualCaptureConcurrency.test.ts`.

### Multi-specialist and scoped review architecture

`.coderabbit.yaml` is a genuinely scoped configuration, not a default file:

- Restrictive `path_filters` covering `src/`, `extension/`, `tests/`, `e2e/`, `docs/`, `website/`,
  `scripts/`, `.github/`, `.claude/`, and named root config files, with build output, lockfiles,
  binaries, and a vendored third-party skill excluded.
- **Ten `path_instructions` blocks** with concrete, area-specific criteria — among them append-only
  migration rules and the `LATEST_SCHEMA_VERSION` bump for `src/main/services/db/migrations.ts`;
  evidence-path and claim-discipline rules for `src/main/services/**`; Manifest V3 service-worker
  state rules and null-check discipline for `extension/**`; "flag a test that would still pass if the
  function returned a constant" for `tests/**`; and a block for `.claude/**` that flags a count
  derived through a pipe whose exit status is unchecked.
- A `knowledge_base.code_guidelines` list with `applyTo` scoping, so `SECURITY.md` governs
  `src/main/**`, `src/preload/**`, `extension/**`, and `.github/workflows/**`.

`.claude/agents/birdbrain-reviewer.md` is a stronger artifact still. It defines a three-tier severity
scheme (`blocking`, `gate`, `advisory`) with an explicit instruction not to collapse them, caps the
posted verdict at five one-sentence findings, requires the reviewer to re-derive every factual claim
from source and cite it as `file:line` — "if you did not trace it, do not assert it" — requires
confirming the reviewed SHA is still head, and makes the tiered evidence-path backstop the reviewer's
responsibility to enforce independently of triage. It also separates "I did not check" from "it
passed" as different reported outcomes.

The surrounding gates are recorded as ADRs: ADR-0005 (unattended agents on the evidence path),
ADR-0007 (merging over an unresolved verdict requires a recorded override), and ADR-0014 (tiered
backstop, three-slot dispatch).

### Release safety and operability

- **Structured logging.** `src/main/services/logger.ts` writes a durable buffered sink with rotation,
  mints a `randomUUID()` per entry, exposes `flushSync()` so an `uncaughtException` handler can drain
  it, and bounds the retry buffer. `src/main/services/logSafe.ts` sanitizes errors and context before
  they land. The entry id reaches the renderer as `correlationId` and is what
  `ReportProblemDialog` and `bugReport.ts` quote back to the operator.
- **Migration rollback.** `snapshotBeforeMigrations` in `src/main/services/db/core.ts` takes a
  pre-migration database snapshot and is deliberately fail-closed: a throw there stops `runMigrations`
  from being reached at all, so an unrecoverable upgrade never starts. It skips the cases where a
  snapshot would preserve nothing (in-memory, already current, empty first launch).
- **Settings forward-compatibility by construction.** `BirdbrainSettingsSchema` is loaded through
  `PartialBirdbrainSettingsSchema` merged over defaults, new keys are optional-with-default, and dead
  enum values are deliberately retained so an older settings file does not fail the whole parse.
- **Release channels** (`stable`, `beta`), `autoCheckForUpdates`, and electron-updater with
  `updater.test.ts` and `settingsReleaseChannel.test.ts` behind them.

### Branch protection and merge gates

Ruleset `master` (id 14967088), enforcement `active`, targeting `~DEFAULT_BRANCH`:

- Branch **deletion**, **creation**, and **non-fast-forward** pushes are all blocked.
- **Required status checks:** `lint`, `typecheck`, `test`, `build`, `e2e`.
- **`current_user_can_bypass: never`** — no bypass actors are configured.

---

## 2. Gap analysis

### Documentation and context

**Consolidated architecture document.**
Architecture is documented, but in two places aimed at other audiences: `CLAUDE.md` is written for
agents, and `website/content/docs/birdbrain-architecture-whitepaper.mdx` is written for outside
readers. Neither states dependency direction as a rule — which layers may import which. One boundary
is enforced (`no-restricted-imports` on `getDb`), and the rest are convention. The failure mode is a
reviewer with no citable rule when a renderer module reaches into main-process internals or a shared
module takes an Electron dependency, which is exactly the class of change that is hard to unwind
later. *Effort: Low.* Suggested path: `ARCHITECTURE.md` at the root, pointing at the two existing
documents and adding one layering table plus the enforcement mechanism per boundary.

**`INVARIANTS.md`.**
The invariants exist and are load-bearing, but they are scattered across `CONTEXT.md` (assurance
baseline), `.coderabbit.yaml` (append-only migrations), `src/shared/verify/` (chain rules), and named
test files. There is no one place a reviewer can check a diff against. Issue #1000 already reports one
concrete instance — manifest capture entries have no cross-field provenance invariants — and #984
reports two files holding evidence-viewer invariants that no evidence-path entry covers. The failure
mode is an invariant that only exists in one person's head being broken by a change that passes every
automated gate. *Effort: Medium.* Suggested path: `docs/INVARIANTS.md`, one line per invariant with
the code location that enforces it and the test that proves it.

**`INTEGRATIONS.md`.**
`SECURITY.md` enumerates the six outbound destinations and what each one discloses, which is the
privacy half. The reliability half is unwritten: nowhere records the timeout, retry policy, backoff,
rate limit, or failure semantics for the RFC 3161 timestamp authority, the Wayback Machine, the
consent-banner filter lists, OpenRouter, the GitHub releases feed, or the follow-up TLS probe to the
captured origin. `src/main/services/ai/openrouter.ts` implements retry and backoff; that behaviour is
described nowhere outside the code. The failure mode is a vendor changing a limit and the resulting
behaviour being rediscovered rather than looked up. *Effort: Low.* Suggested path:
`docs/INTEGRATIONS.md`, one section per destination.

**Local attack surface in the threat model.**
`website/content/docs/threat-model.mdx` covers the forensic guarantees well, and `SECURITY.md`
pre-declares the local out-of-scope boundary. What neither contains is an asset and trust-boundary
enumeration for the local surface: the loopback capture server, the preload `contextBridge`, extension
message ports, the `birdbrain://` deep-link handler, and the parsers that consume attacker-influenced
bytes (MHTML, imported case archives, TSA CMS tokens). "Out of scope" is a defensible answer for each,
but it is currently an answer given once in prose rather than per asset. *Effort: Medium.* Suggested
path: extend `website/content/docs/threat-model.mdx` with an asset table, or add
`docs/THREAT_MODEL.md` for the local surface and keep the published page for the evidence claims.

**`TESTING.md`.**
`CONTRIBUTING.md` lists five commands; `CLAUDE.md` explains the tsconfig and Vitest project topology
in agent-facing detail. Neither answers a contributor's actual questions: which tier does my change
belong in, how do I run one e2e spec, when do I need `BIRDBRAIN_REQUIRE_OPENSSL=1`, and what does the
diff-coverage gate expect. #863 already reports that the `xvfb-run` requirement is undocumented.
*Effort: Low.* Suggested path: `docs/TESTING.md`, linked from `CONTRIBUTING.md`.

### CI and static analysis

**Required checks omit the entire security workflow.** *(Highest-impact gap in this audit.)*
The ruleset requires `lint`, `typecheck`, `test`, `build`, and `e2e`. It does not require
`Secret scan (full history)`, `Dependency audit`, `Registry publish guard`, or `docs-build`. All four
run on every pull request and all four are advisory: a gitleaks hit, a new critical advisory, an
expired audit exception, or a broken MDX page produces a red badge that nothing stops anyone merging
past. The `docs-build` job's own comment already recommends requiring it and notes that the change is
the maintainer's, because the required-contexts list is in the ruleset rather than the repository.
*Effort: Low* — a ruleset edit, no code. Suggested tool: the `master` ruleset's
`required_status_checks` parameters.

**Stale-base merges are permitted.**
`strict_required_status_checks_policy` is `false`, so a pull request may merge on checks that ran
against a base that has since moved. With no merge queue, two independently green pull requests can
combine into a red `main`. *Effort: Low.* Suggested tool: set the policy to `true` in the same ruleset
edit, or enable a merge queue if the resulting re-run cost is unwelcome.

**No formatting check in CI.**
`pnpm lint` runs ESLint with `eslint-config-prettier`, which *disables* stylistic rules rather than
enforcing them; there is no `prettier --check` anywhere in `.github/workflows/`. The committed tree
consequently does not satisfy the project's own formatter — already filed as #983 and #721, where
`pnpm format` on a clean `main` rewrites about 40 files nobody edited. A side effect worth naming:
`CONTRIBUTING.md` states "Formatting is enforced by Prettier/ESLint", which is not true today.
*Effort: Low.* Tracked in #983; the acceptance criteria there already include the CI step.

**No static application security testing.**
Gitleaks covers secrets and `audit-check.mjs` covers dependency advisories. Nothing analyses
first-party code. For an application that runs a loopback HTTP server, injects a content script into
arbitrary pages, parses MHTML and ASN.1 from untrusted sources, and registers a custom URL scheme,
CodeRabbit's prose instructions are the only thing looking for injection, path traversal, or unsafe
Electron configuration — and CodeRabbit is advisory by design (`request_changes_workflow: false`).
CodeQL's JavaScript/TypeScript pack includes Electron-specific queries. *Effort: Low.* Suggested path:
`.github/workflows/codeql.yml`.

**npm dependency updates are unautomated on a stale rationale.**
`.github/dependabot.yml` covers `github-actions` only, and its stated reason for excluding the npm
ecosystems — that `security.yml` tolerates advisories `continue-on-error` — no longer holds; that job
is enforcing. Filed as **#1049** during this audit. The practical effect is that npm remediation is
entirely manual and arrives as a red build on an unrelated pull request. *Effort: Low.*

**No API or schema contract diffing across artifacts.**
The extension-to-server wire contract is shared as compile-time types — `extension/src/utils/api.ts`
imports its response types from `@shared/schemas` — and `tsc -p extension/tsconfig.json` in CI catches
drift within one tree. It cannot catch skew between independently installed artifacts, and three facts
make that reachable: the extension does no runtime validation of server responses (stated in its own
header comment, "the extension trusts the server"), `extension/manifest.json` is pinned at `1.0.0`
while the application is at `1.0.1-beta.21` with nothing syncing them, and `/api/status` reports
`npm_package_version` but nothing negotiates on it. A user running a new extension against an older
application gets undefined behaviour rather than a version error. *Effort: Medium.* Suggested path: a
wire-contract version constant in `src/shared/constants.ts`, checked at pairing time, plus a
serialized schema snapshot test under `tests/shared/`.

**No migration lint or replay check.**
Append-only-ness and the `LATEST_SCHEMA_VERSION` bump are enforced by CodeRabbit prose instructions
only — an advisory reviewer, on a repository where 33 migration blocks now exist. A test that replays
a fixture database through every historical version exists for exactly one hop (v24 to v25). *Effort:
Medium.* Suggested path: `scripts/check-migrations.mjs` (asserts no existing `if (version < N)` block
changed against the merge base, and that a new block bumps the constant), wired into the `lint` job.

**No build provenance on release artifacts.**
`SECURITY.md` correctly pre-declares that installers are unsigned and that update integrity rests on
electron-updater SHA-512 metadata. Code-signing certificates are a real cost; build provenance
attestation is not, and would let a user verify an installer came from this repository's workflow.
*Effort: Medium.* Suggested tool: `actions/attest-build-provenance` in
`.github/workflows/release.yml`.

### Testing and fuzzing

**No property-based testing.**
`fast-check` is not a dependency, and the highest-value targets are pure, deterministic, and
evidence-critical: `src/shared/verify/canonicalJson.ts` (canonicalization must be stable under key
reordering — a property, tested today by examples), `src/shared/noteAnchor.ts` resolution,
`urlCanonicalize`, `urlPatterns` and `safeRegex`, and the extraction sanitizer. The failure mode is an
input shape nobody thought to write down changing a hash. *Effort: Low to Medium.* Suggested tool:
`fast-check` in the existing Vitest node project, starting with `canonicalJson`.

**No fuzzing of untrusted-input parsers.**
Four parsers consume bytes an adversary can influence: MHTML from arbitrary pages
(`mhtmlDecoder.ts`), imported case archives (`caseArchive.ts`, `zipRead.ts`), TSA CMS and ASN.1
timestamp tokens (`@peculiar/asn1-*` via `timestamp.ts`), and manifest JSONL on the verification path.
Each has hand-written malformed-input tests; none has a generator. A malformed archive that crashes
the importer is a denial of service on the operator's own machine, and a malformed token that parses
into the wrong structure is worse. *Effort: Medium.* Suggested path: `tests/fuzz/` with corpora, run
as a scheduled workflow rather than per-pull-request so it does not add merge latency.

**No idempotency or crash-consistency tests on the capture write path.** *(Highest-value new test
class.)*
Deduplication exists (`dedupeWindowSeconds`, `captureDuplicate.test.ts`), but nothing tests the
partial-failure shape: the extension posts a capture, the connection times out after the file is
written but before the manifest entry is appended, and the extension retries. The invariant that
should hold — exactly one capture row, exactly one manifest entry, exactly one file on disk, and an
unbroken hash chain — is the product's core claim, and it is currently untested under retry. *Effort:
Medium.* Suggested path: `tests/main/services/captureIdempotency.test.ts`, driving
`captureServer` with an injected failure between each side effect.

**Thin concurrency and transaction coverage.**
One concurrency test exists, and it is extension-side. Nothing exercises two concurrent capture writes
against the same Case, a read racing a migration, or `withTransaction` under contention against the
configured `busy_timeout = 5000`. SQLite in WAL mode makes most of this well-defined, which is an
argument for writing the tests that pin the behaviour, not for assuming it. *Effort: Medium.*

**The standalone verifier is never built in CI.**
`pnpm build:verifier` has no job in any workflow — already filed as #847. The verifier binary is the
one artifact a third party uses to check evidence without installing the application, and it is the
least-verified thing the project ships. *Effort: Low.* Tracked in #847.

**No post-merge or post-release smoke verification.**
`release.yml` builds and uploads installers; nothing installs one and launches it.
`release-macos.yml` verifies that the GitHub release exists, not that the artifact runs. *Effort:
Medium.* Suggested path: a `smoke` job in `release.yml` that launches the packaged Linux build under
`xvfb-run` and asserts the capture server answers on `127.0.0.1:19845`.

### Review agents

**No explicit evidence standard in the CodeRabbit configuration.**
`.claude/agents/birdbrain-reviewer.md` states the standard precisely — re-derive every claim from
source, cite `file:line`, never report a pass you did not run — but that contract governs agent pull
requests only. Human-authored pull requests are reviewed by CodeRabbit, which is configured
`profile: chill` with `request_changes_workflow: false` and carries no instruction against speculative
findings. *Effort: Low.* Suggested path: add the standard to `tone_instructions` and to the `src/**`
block in `.coderabbit.yaml`.

**No path-scoped security and authorization review block.**
None of the ten `path_instructions` blocks targets the authorization surface as such. The token check
and DNS-rebinding Host guard in `src/main/services/captureServer.ts`, `serverToken.ts`, the preload
bridge, `deepLink.ts`, and `webviewPolicy.ts` are reviewed only under the general `src/**` and
`src/main/services/**` blocks, whose instructions are about typing, error handling, and evidence
claims. *Effort: Low.* Suggested path: a new block in `.coderabbit.yaml` scoped to those files.

**No persistence and data-integrity block beyond `migrations.ts`.**
`dbAdmin.ts` performs vacuum, restore, orphan cleanup, and raw table editing, and the per-domain repo
modules own all the SQL. None has a dedicated review instruction. *Effort: Low.*

**Review rigor is asymmetric between authors.**
ADR-0014 lets a non-evidence agent pull request merge on required checks green plus a pre-pass
verdict. A human-authored pull request gets CodeRabbit — advisory — and self-review, with no required
approval rule (see below). The strictest review path in the repository is the one that applies to
machine-written code. That may well be the right trade for a solo project, but it is currently an
emergent property rather than a recorded decision. *Effort: policy, not code.*

### Runtime safety

**No feature-flag or kill-switch mechanism.**
`BirdbrainSettingsSchema` has no flag field, and no gating mechanism exists anywhere in `src/`. A risky
change to the capture or verification path is on for every user on the release that carries it, and
containment means publishing another release. For a local-first desktop application with no
server-side control plane, the realistic form is a settings-backed local flag registry with a
default-off convention for new evidence-path behaviour, plus a documented removal deadline so flags do
not accumulate. *Effort: Medium.* Suggested path: a `featureFlags` record in
`BirdbrainSettingsSchema`, read through one accessor in `src/shared/`.

**No correlation identifier across a capture's lifecycle.**
The logging infrastructure is good, but its identifier is per log entry, not per operation. Nothing
links the extension's POST through `captureServer`, `captureStore`, `hash`, `manifest`, and
`timestamp` — so reconstructing a capture that failed halfway means matching entries on timestamps and
URLs by hand. This is the diagnostic that a partial-capture bug report most needs, and it is the same
scenario the idempotency gap above describes. *Effort: Medium.* Suggested path: mint a capture-scoped
identifier at the server route, thread it through `LogContext`, and include it in manifest diagnostics.

**Migrations are forward-only, with the downgrade case undefined.**
The pre-migration snapshot is a genuine and well-designed rollback, and for a local single-user
database it is a better fit than a generic expand-and-contract policy. Two narrower gaps remain: there
is no written convention that a migration dropping or renaming a column ships at least one release
after the code stops reading it, and `initDatabase` returns early when `user_version` is already at or
ahead of `LATEST_SCHEMA_VERSION` rather than refusing to open a database from a future version. A user
who reinstalls an older build therefore runs new-schema data through old code silently. *Effort: Low.*
Suggested path: a version guard in `src/main/services/db/core.ts` plus a convention paragraph in the
architecture or invariants document.

### Branch protection and merge gates

**No required pull-request review.**
The ruleset contains no `pull_request` rule, so there is no required approval count, no required
conversation resolution, and no dismissal of stale approvals on push. ADR-0005's guarantee that
evidence-affecting changes always get human review is therefore enforced entirely by process, and
`agent/pre-pass` is advisory too — #488 records why it cannot be required today (Dependabot workflows
receive a read-only token and cannot write the status). *Effort: Low* to add, *Medium* to live with on
a solo project, which is the real decision. Suggested tool: a `pull_request` rule with
`required_approving_review_count: 0` and `required_review_thread_resolution: true` captures the
conversation-resolution benefit without blocking a solo maintainer.

**No linear-history requirement.**
`non_fast_forward` blocks force-pushes; it does not require linear history or restrict merge method.
Given how much this repository's CI reasoning depends on reading `origin/main...HEAD`, a merge-commit
history costs more here than in most repositories. *Effort: Low.* Suggested tool: add a
`required_linear_history` rule to the same ruleset.

---

## 3. Top three high-return actions

### 1. Require the four advisory checks in the `master` ruleset

Add `Secret scan (full history)`, `Dependency audit`, `Registry publish guard`, and `docs-build` to
`required_status_checks`, and set `strict_required_status_checks_policy` to `true`.

No code, no new tooling, no added merge latency — these jobs already run on every pull request. It
converts three security gates and one build gate from "someone notices the red badge" into "cannot
merge", and it closes the stale-base window at the same time. `docs-build` is safe to require because
it reports `skipped` on pull requests that touch nothing under `website/`, which the ruleset accepts —
a property `ci.yml` was deliberately designed to have.

This is the largest gap between what the repository verifies and what it enforces, and it is the
cheapest one to close.

### 2. Test the capture write path for idempotency and crash consistency

Add `tests/main/services/captureIdempotency.test.ts` driving `captureServer` with an injected failure
between each side effect — after the file write, after the database insert, before the manifest
append, before the timestamp — and assert that a retried request converges on exactly one capture row,
one manifest entry, one file on disk, and an unbroken hash chain.

The hash-chained manifest is the product's central claim, and the partial-failure case is where it can
degrade without anything going red. Every neighbouring behaviour is already tested — deduplication,
hashing, manifest chains, timestamps — which makes this a gap in composition rather than in coverage,
and the cheapest kind of gap to close well. It also produces the diagnostic requirement that motivates
the correlation-identifier gap above.

### 3. Add CodeQL

Create `.github/workflows/codeql.yml` running the JavaScript and TypeScript pack on pull requests, and
add its context to the ruleset once it has reported clean once.

It is one file, no maintenance, and it is the only proposal here that inspects first-party code for
security defects rather than for secrets or vulnerable dependencies. The surface justifies it: a
loopback HTTP server, a content script on arbitrary pages, MHTML and ASN.1 parsing, and a custom URL
scheme handler. CodeQL's Electron-specific queries cover configuration mistakes that no current gate
looks for.

**Runner-up, and already filed:** build and smoke-test the standalone verifier in CI (#847). For an
evidence tool, an unbuilt verifier binary is arguably a larger risk than anything above — it is placed
fourth only because it is tracked and scoped already.

---

## Issues filed from this audit

- **#1049** — `.github/dependabot.yml` justifies excluding the npm ecosystems on a `continue-on-error`
  that `security.yml` no longer has.

## Existing issues this audit corroborates

- **#983** and **#721** — no `prettier --check` in CI, and the committed tree has drifted out of
  format.
- **#847** — `pnpm build:verifier` has no CI job, so the standalone verifier never ships with a
  release.
- **#1000** — manifest capture entries have no cross-field provenance invariants.
- **#984** — two files hold evidence-viewer invariants and are on no evidence-path entry.
- **#488** — `agent/pre-pass` cannot be a required check while Dependabot workflows get a read-only
  token.
- **#863** — `pnpm test:e2e` needs a display and the `xvfb-run` workaround is undocumented.
