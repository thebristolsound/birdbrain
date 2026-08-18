# Pre-ship validation gate — tester builds

**Date:** 2026-08-15
**Status:** Active — run this before every build handed to a tester
**Owner:** Matt Donovan
**Decided in:** [#291](https://github.com/thebristolsound/birdbrain/issues/291) (2026-08-12), written as [#415](https://github.com/thebristolsound/birdbrain/issues/415), under map [#284](https://github.com/thebristolsound/birdbrain/issues/284)

## What this gate is for

Map #284 sets one floor: **Birdbrain must not silently lose, corrupt, or mis-attest
evidence.** UI roughness, missing features, and known architectural debt ship as-is,
deliberately. This checklist is what makes that floor enforceable at the moment a build
leaves for a tester — it is the only thing standing between a tagged release and someone
else's real case.

It is a floor, not a ceiling. Do not add steps here because they would be nice to have;
add them when a step's absence would let evidence loss, corruption, or mis-attestation
reach a tester unnoticed.

**Human-run, target ≤45 minutes**, scripted where scripting is cheap. Every item is
pass/fail. Any **must-pass** failure is a no-go: fix, re-tag, and start section 1 again.

## How to run it

Copy this file's checklist sections into the release's notes (or a scratch file) and tick
them there — do not tick the boxes in this document, which is the template. Record the
outcome in the go/no-go block at the bottom and keep it with the release.

Two machines are needed: a clean Windows VM and an Ubuntu box or VM. "Clean" means no
prior Birdbrain install for section 3, and the previous beta installed for section 5 — so
either run section 5 first on a snapshot, or roll the VM back between them.

**Preconditions**

- [ ] The candidate is a pushed `v*` tag, not a branch build.
- [ ] `release.yml` finished green for that tag and the GitHub Release carries the
      Windows `.exe`, Linux `.AppImage` and `.deb`, the `latest*.yml` update manifests, and
      `birdbrain-extension.zip`.
- [ ] The previous beta's installers are still downloadable (section 5 needs them). At the
      time of writing the previous shipped build is `v1.0.1-beta.17`, tagged 2026-07-24.

---

## 1. CI and Security green — must pass

The `CI` workflow (`.github/workflows/ci.yml`) must be green **on the tagged commit**, all
five jobs:

- [ ] `lint` — `pnpm lint`
- [ ] `typecheck` — `pnpm typecheck`
- [ ] `test` — `pnpm test:coverage` with `BIRDBRAIN_REQUIRE_OPENSSL=1`
- [ ] `build` — `pnpm build` and `pnpm build:extension`
- [ ] `e2e` — Playwright against the built app

The `Security` workflow (`.github/workflows/security.yml`) runs on the same triggers and
must be green on the same commit, all three jobs:

- [ ] `Secret scan (full history)` — gitleaks over the whole history
- [ ] `Dependency audit` — dependency advisories
- [ ] `Registry publish guard` — `package.json` still marked private

Notes worth knowing before you read a green tick as meaning more than it does:

- Both workflows run on `push` to `main` and on pull requests, **not on tags**, and neither
  declares `workflow_dispatch`. There is therefore no way to aim a run at a tag: `gh workflow
  run` has no dispatch trigger to fire, and `gh run rerun` only replays the commit its
  original run used. **Cut the tag at a commit that already has a green `main` run** — if the
  commit is not on `main` yet, push it to `main` first, wait for that run, then tag it. A
  green run on a different commit is not evidence about this build.
- Adding `workflow_dispatch` to `ci.yml` and `security.yml` would remove that constraint and
  let a run be aimed at an arbitrary ref. It is filed separately, not a prerequisite for
  running this gate.
- The `test` job's diff-coverage step is gated `if: github.event_name == 'pull_request'`
  (`.github/workflows/ci.yml:97`), so `scripts/diff-coverage.mjs` does **not** run on the
  push-to-`main` run this section reads. Diff coverage is a per-PR gate; a green `test` here
  means the suite and the project-wide coverage thresholds passed, nothing more.
- `BIRDBRAIN_REQUIRE_OPENSSL=1` is what stops the OpenSSL-dependent timestamp tests from
  turning green-by-skipping (`tests/helpers/openssl.ts`). Locally, run
  `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` for the same reason.

## 2. CI-built artifacts only — must pass

- [ ] Every installer used from here on was downloaded from the GitHub Release for this
      tag.
- [ ] No locally built installer is used anywhere in sections 3–5, including "just to
      check something".

A local build is not the artifact the tester runs: it comes from a different toolchain, a
different `node_modules`, and a working tree that may not match the tag. Testing one tells
you nothing checkable about the other.

## 3. Smoke checklist — Windows NSIS and Ubuntu AppImage must pass

`.deb` is **best-effort**: run it if there is time, record failures as ordinary issues, do
not block the release on them. macOS ships as a byproduct and is unsupported — not tested
here.

Run the same eight steps per platform.

**Windows (NSIS `.exe`) — must pass**

- [ ] Install (expect the SmartScreen "More info → Run anyway" click-through; builds are
      unsigned) → launch
- [ ] Create a case
- [ ] Sideload the extension from `birdbrain-extension.zip` (`chrome://extensions` →
      Developer mode → Load unpacked); the dashboard banner flips to **Browser Extension
      Connected** and the top-bar indicator reads **Connected**
- [ ] Capture a page as HTML
- [ ] Capture a page as MHTML
- [ ] View both captures in the app
- [ ] Export the case
- [ ] Quit, relaunch, confirm the case and both captures are still there

**Ubuntu (AppImage) — must pass**

- [ ] `chmod +x` → launch
- [ ] Create a case
- [ ] Sideload the extension; the dashboard banner flips to **Browser Extension Connected**
      and the top-bar indicator reads **Connected**
- [ ] Capture a page as HTML
- [ ] Capture a page as MHTML
- [ ] View both captures in the app
- [ ] Export the case
- [ ] Quit, relaunch, confirm the case and both captures are still there

**Ubuntu (`.deb`) — best-effort**

- [ ] `sudo apt install ./birdbrain_<version>_amd64.deb`, then the same eight steps

## 4. Verification — must pass

Two halves. The first is a known-answer check that the shipped verification path still
produces the known-good result; the second is an end-to-end pass on evidence this build
actually produced.

**4a. Known-answer timestamp fixture**

`tests/fixtures/timestamp/` holds a real DigiCert RFC 3161 token over a fixed content hash,
with the trust anchor alongside it, so this check needs no network and no system trust
store.

This decomposes #291's single "run the verifier against `tests/fixtures/timestamp/`" item
into the three boxes below, because that item was not implementable as written: the
standalone verifier has no mode that reads the fixture. `--self-check` routes to
`runSelfCheck()` (`src/verifier/cli.ts:117`), which compares a frozen canonical-JSON golden
vector, and the only other mode takes a package directory. So the fixture is exercised by
the test suite and by hand with `openssl`, and the verifier's own known-answer check is
`--self-check` — the same coverage, split across the tools that can actually deliver it.

- [ ] `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` passed on the tagged commit (section 1
      covers this) — that is what exercises the fixture through
      `parseTimestampToken` and the canonical `openssl ts -verify` path.
- [ ] By hand, from `tests/fixtures/timestamp/`:

      ```sh
      openssl ts -verify \
        -in   digicert-response.tsr \
        -queryfile request.tsq \
        -CAfile digicert-trusted-root-g4.pem
      # => Verification: OK
      ```

- [ ] The standalone verifier's self-check passes on a binary built from the tagged commit
      (`pnpm build:verifier`, then `dist/verifier/birdbrain-verify --self-check`; on Windows
      the binary is `dist\verifier\birdbrain-verify.exe`). This asserts the bundled
      canonical-JSON core is byte-identical to the in-app core; it says nothing about any
      particular package.

The verifier binary is **not** a release artifact — `release.yml` publishes installers and
the extension zip only, and Node SEA builds for the OS it runs on. Build it locally from
the tagged commit, and note that the verifier is section 2's one exception: both this step
and the re-verify step in 4b run a locally built binary rather than a CI-built one. That
exception covers the verifier and nothing else — every installer stays CI-built.

**4b. Live capture → verify → export → re-verify**

Do this on one of the section 3 platforms, using that platform's captures.

- [ ] **Capture** — take a fresh capture in the smoke case.
- [ ] **Verify in-app** — open the capture and run **Verify** on its provenance badge;
      the result is not tampered.
- [ ] **Export** — export the case as an evidence package.
- [ ] **Re-verify outside the app** — unzip the package and run
      `birdbrain-verify <package-dir>` against it. It reports PASS.
- [ ] The unzipped package contains `manifest.jsonl`, `evidence.json`, `report.html`,
      `certification.html`, `signing-public-key.pem`, `VERIFY.md`, and `tsa-ca-chain.pem`.

What a PASS here does and does not mean, so the tick is not read as more than it is: it is
an integrity and internal-consistency result. The manifest chain shows nobody edited the
manifest *without this installation's signing key* — it does not constrain the Operator,
who holds that key. The verifier's timestamp checks are structural (imprint and
byte-binding); canonical TSA authenticity is the `openssl ts -verify` path in the package's
`VERIFY.md`, which is why 4a exists separately.

## 5. Upgrade path — must pass

The gate item that exists because the durability contract from
[#286](https://github.com/thebristolsound/birdbrain/issues/286) is only worth what a real
upgrade demonstrates.

- [ ] Install the **previous** beta on a clean machine.
- [ ] Create a case and take at least one capture in it.
- [ ] Install the candidate over the top. **Use the in-app path when the previous beta is on
      the same public update feed** — **Settings → Updates → Check for updates**, then
      **Download**, then **Restart to update**. Manual installation (Windows: run the new
      installer; AppImage: replace the file; do not remove user data) is the fallback, and is
      the only option when the previous beta predates the feed.
- [ ] Launch. The case and its capture are still there, and the capture still opens.
- [ ] A pre-migration snapshot exists in the `db-snapshots` folder next to the database in
      the user data directory, and it is listed under **Settings → Database → Utilities →
      Pre-Migration Snapshots**.

**Why the in-app path is now first.** Until `1.0.1-beta.18` every shipped build had the
private source repository baked into its `app-update.yml`, so electron-updater's
unauthenticated GitHub provider could never reach a feed and no gate run could exercise the
update mechanism (#567). Builds from `1.0.1-beta.18` onward point at the public
`thebristolsound/birdbrain-releases` feed, so an upgrade between two of them tests what a
tester will actually do. A manual install-over-the-top proves the data survives; it proves
nothing about the mechanism that is meant to deliver the upgrade.

Record which path was used. On the `.deb`, the download is automatic but the install runs
`dpkg` behind a system password prompt, so it happens only on **Restart to update** — that is
expected, not a failure.

If the candidate carries no schema change, no snapshot is taken and none is expected —
record that rather than ticking the last box. Check `LATEST_SCHEMA_VERSION` in
`src/main/services/db/core.ts` against the previous beta if you need to know which case you
are in.

Run this section on at least one must-pass platform. Running it on both is better and is
where the 45-minute target usually goes; one is the floor.

---

## Deliberately not in gate v1

Named here so nobody re-litigates them mid-release:

- **Known-answer capture corpus** — a fixed corpus with known hashes, manifest chain and
  tokens is filed as an ordinary follow-up, not a blocker
  ([#417](https://github.com/thebristolsound/birdbrain/issues/417)). Gate v1 leans on the
  timestamp fixture plus the live pass in 4b.
- **macOS** — ships as a byproduct, unsupported for round 1, untested here.
- **Code signing / notarization** — out of scope per map #284; the SmartScreen
  click-through in section 3 is expected, not a failure.
- **Anything above the floor** — performance, UI polish, feature gaps. Not this gate's
  business.

## Go / no-go record

| Field | Value |
| --- | --- |
| Candidate tag | |
| CI run (link) | |
| Security run (link) | |
| Section 1 CI + Security green | pass / fail |
| Section 2 CI artifacts only | pass / fail |
| Section 3 Windows NSIS | pass / fail |
| Section 3 Ubuntu AppImage | pass / fail |
| Section 3 Ubuntu `.deb` (best-effort) | pass / fail / not run |
| Section 4a known-answer fixture | pass / fail |
| Section 4b live capture → re-verify | pass / fail |
| Section 5 upgrade path | pass / fail |
| Elapsed | |
| Verdict | **go / no-go** |
| Run by / date | |

Anything that failed and was accepted anyway belongs in the release notes, not in a memory.
