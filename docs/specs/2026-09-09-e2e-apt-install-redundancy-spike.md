# Spike: is the e2e apt install step redundant?

Timeboxed investigation for [#476](https://github.com/thebristolsound/birdbrain/issues/476).
It answers one question and changes no workflow: does the `e2e` job's
`Install system dependencies` step
([`.github/workflows/ci.yml:298-305`](../../.github/workflows/ci.yml)) install anything the
job actually needs?

Answer: no. Every package it names is either already in the `ubuntu-24.04` runner image or is
never loaded by anything the job runs. The step can be deleted.

## What changed since the issue was written

The issue asks for a three-way classification: image baseline, installed by
`playwright install --with-deps`, or ours. The middle arm no longer exists. Commit `63ae4518`
(2026-08-17, "ci(e2e): drop playwright install --with-deps, its unguarded apt stalls the job")
removed that step, and `ci.yml:309-313` now carries a comment where it stood. The suite is
Electron-only, so no browser is downloaded and no browser dependency is installed. The
classification below is therefore two-way.

## Method

The issue proposes pushing a throwaway branch with temporary `dpkg -s` probe steps. That route
was unavailable: the machine account's token carries the `repo` scope only, and pushing any
change under `.github/workflows/` needs the `workflow` scope. Three other sources give the same
evidence without touching CI.

1. **The existing apt step's own log.** `apt-get install` prints, for each package, either
   `<pkg> is already the newest version` or a line in `The following NEW packages will be
   installed`. That is exactly the present-versus-new distinction the probe steps were meant to
   produce, and it is already in every `e2e` job log.
2. **Static inspection of the Electron binary.** `objdump -p` gives the hard `NEEDED` list;
   `strings` gives the `dlopen` names, which is how Electron reaches libnotify and libsecret.
3. **A live run.** The built app was launched with the same `_electron.launch` arguments
   `e2e/fixtures/electronApp.ts` uses, under `xvfb-run`, and `/proc/<pid>/maps` was read for
   every process in the Electron tree. All eleven packages are installed on that host, so a
   library that never appears in any map is one the app does not use.

Sources 1 and 3 are both runner-image evidence: the logs come from the `e2e` job itself, and the
live run was executed on a GitHub-hosted `ubuntu-24.04` runner, `ImageVersion=20260831.293.1`,
the same image family `runs-on: ubuntu-latest` resolves to.

## Evidence

Two `e2e` jobs on `main`, on two different image versions:

| Run | Job | Head | Image version |
| --- | --- | --- | --- |
| [34363535929](https://github.com/thebristolsound/birdbrain/actions/runs/34363535929) | 102506399839 | `155fba6b` | 20260831.293.1 |
| [34289989459](https://github.com/thebristolsound/birdbrain/actions/runs/34289989459) | 102274194809 | `c2793e0f` | 20260907.300.1 |

Both produce identical apt plans: `0 upgraded, 32 newly installed, 0 to remove`, 5827 kB
fetched, 36.0 MB on disk. The step took 21 seconds on the healthy run (14:26:24 to 14:26:45),
out of a 5m18s job.

### Per-package classification

| Package | Classification | Used by the job? |
| --- | --- | --- |
| `build-essential` | Ours — but a no-op metapackage | Its whole dependency closure is image baseline. See below. |
| `python3` | Image baseline (3.12.3-0ubuntu2.1) | Yes, node-gyp runs it. Already present. |
| `libgtk-3-0` | Image baseline via `libgtk-3-0t64` | Yes, `NEEDED` by the Electron binary. Already present. |
| `libnotify-dev` | Ours — 28 additional packages | No. Never loaded. |
| `libnss3` | Image baseline (2:3.98-1ubuntu0.2) | Yes, `NEEDED`. Already present. |
| `libxss1` | Image baseline (1:1.2.3-1build3) | No, and not referenced by Electron 42 at all. |
| `libasound2t64` | Image baseline (1.2.11-1ubuntu0.3) | Yes, `NEEDED`. Already present. |
| `libxtst6` | Image baseline (2:1.2.3-1.1build1) | No, and not referenced by Electron 42 at all. |
| `xauth` | Image baseline (1:1.1.2-1build1) | Yes, `xvfb-run` uses it. Already present. |
| `libgbm1` | Image baseline (25.2.8-0ubuntu0.24.04.2) | Yes, `NEEDED`. Already present. |
| `libsecret-1-0` | Ours — plus `libsecret-common` | No. Never loaded. See below. |

`libgtk-3-0` does not exist as a package in noble. The installed `libgtk-3-0t64` declares
`Provides: libgtk-3-0`, which is what satisfies the request; apt reports
`libgtk-3-0t64 is already the newest version`.

Only three of the eleven cause an install. Each is examined below.

### `build-essential` installs nothing but itself

apt lists `build-essential` under `The following NEW packages will be installed`, but its
dependencies — `gcc`, `g++`, `make`, `libc6-dev`, `dpkg-dev` — appear neither there nor under
`The following additional packages will be installed`. apt names every package it plans to
install, so their absence means all of them were already present. The download is 4928 bytes: the
metapackage and nothing else.

The compile is real. The root `postinstall` runs `scripts/rebuild-native.mjs`, and the `e2e` job
log shows better-sqlite3 rebuilt against the Electron 42.5.1 headers, ending `gyp info ok`. The
toolchain that compiled it, however, came from the image, not from this step.

### `libnotify-dev` is the expensive one, and nothing uses it

It pulls 28 further packages — `libglib2.0-dev`, `libgdk-pixbuf-2.0-dev`, `libtiff-dev`,
`libwebp-dev`, `libjpeg-dev` and the rest of a development toolchain for a library the job does
not compile against. It is the bulk of the 36.0 MB.

The only runtime piece in that set is `libnotify4`, which supplies `libnotify.so.4`. Electron
reaches it by `dlopen` when a notification is shown — the binary carries the strings
`libnotify.so`, `libnotify.so.1`, `libnotify.so.4` and `libnotify.so.5` and has no `NEEDED` entry
for any of them. Nothing under `src/` constructs a `Notification`, and in the live run
`libnotify.so` was mapped in none of the six Electron processes.

### `libsecret-1-0` has no consumer in this job

`libsecret-1.so.0` is likewise a `dlopen` name in the Electron binary, reached when Chromium's
`os_crypt` selects the libsecret backend. Under Playwright it never does:
`playwright-core/lib/server/electron/loader.js:69` hardcodes `--password-store=basic` in the
argument list it applies before the app's main script, so `safeStorage.isEncryptionAvailable()`
returns `false` in every e2e run regardless of the machine's credential store. The fixture says
as much at `e2e/fixtures/electronApp.ts:52-67`, and seeds a plaintext signing keypair precisely
because of it. In the live run `libsecret-1.so` was mapped in none of the six processes.

The issue frames `libsecret-1-0` as "for the credential store". The history does not support
that. It entered in `40a3ed56` (2026-04-04) as one item in a nine-package block added in a single
"CI improvements" commit, four months before any keyring work. The credential-store attempt of
2026-08-14 added `dbus-x11` and `gnome-keyring` **on top** of it (`0dd66521`, `53827cb6`) and
`35e794ee` removed those two again, leaving the April line untouched. So `libsecret-1-0` is not a
leftover from the keyring work; it is part of the original boilerplate, and it never had a
consumer in CI.

### Corroboration: a job that already does this

`.github/workflows/package-smoke.yml` has no apt step at all. Its `ubuntu-latest` leg runs
`pnpm install`, `pnpm package:linux`, and then launches the packaged AppImage under
`xvfb-run`. In its most recent run
([34164135089](https://github.com/thebristolsound/birdbrain/actions/runs/34164135089), job
101925086698, image 20260831.293.1) it rebuilt better-sqlite3 through node-gyp (`gyp info ok`),
built the AppImage, started the app, and reached the capture server:
`package-smoke: pass in 4047ms`.

That job is a standing, passing demonstration that the runner image alone supplies both the
compiler toolchain and the shared libraries an Electron app needs to start headless — the two
things the `e2e` step claims to provide.

## Recommendation

Delete the `Install system dependencies` step from the `e2e` job. Do not trim the package list
instead.

The reason to prefer deletion over trimming is that the hang this step keeps producing lives in
`apt-get update`, not in the package list. `apt-get update` runs whatever is requested after it,
so a shorter list still fetches ~12 MB of index from the Ubuntu mirror and still exposes the job
to the stall behind [#475](https://github.com/thebristolsound/birdbrain/issues/475) and
[#539](https://github.com/thebristolsound/birdbrain/issues/539). A step that does not run cannot
stall. Deleting it also removes 21 seconds and a 36.0 MB install from every e2e run, though the
time is the smaller prize.

The one thing given up is an explicit guarantee of a C++ toolchain. If the runner image ever
stopped shipping `gcc`, `g++` and `make`, the `e2e` job's `pnpm install` would fail — loudly and
immediately, at the node-gyp step, not silently. `package-smoke.yml` already carries that same
exposure and has not been bitten by it.

If the maintainer would rather keep the toolchain guarantee, the conservative variant is to
reduce the list to `build-essential python3`, matching the `test` job at `ci.yml:217-222`. State
plainly what that buys: it removes the 36.0 MB install and the nine unused packages, but it keeps
the `apt-get update` and therefore keeps the stall surface. It is a smaller win for the same
residual risk of a hang.

Two related sites, both outside this issue's scope, both worth naming so they are not
rediscovered separately:

- **`.github/workflows/dispatch.yml:108-110` carries a copy of the same eleven-package list.**
  Whatever is decided for the `e2e` job applies to it for the same reasons, and it should not be
  left behind as the last copy of a list nobody can justify.
- **The `test` job at `ci.yml:217-222` installs `build-essential python3` for the same
  better-sqlite3 rebuild.** The metapackage finding above applies to it identically. It is a
  separate judgement, because the `test` job is the one that gates coverage and is the last place
  worth taking risk.

## What this spike does not establish

- It does not prove the packages are unnecessary on a **developer machine** or in a **packaged
  install**. Electron's `safeStorage` does load `libsecret-1.so.0` on a real Linux desktop; that
  is what `src/main/services/signingKey.ts:101` warns about. The finding is scoped to the `e2e`
  job, where Playwright's loader forecloses that path.
- It does not prove the image will keep shipping these packages. Runner images move, and the two
  runs above already differ by image version. The mitigation is that a regression fails the job
  at `pnpm install` or at the first spec, not quietly.
- The live `/proc` probe observed the app at rest after `firstWindow()`. A library `dlopen`ed
  later by a specific spec would not appear. The static evidence covers that gap for libnotify
  and libsecret: both are reached only through code paths (`Notification`, `safeStorage`
  encryption) that the codebase does not call and that Playwright's loader disables,
  respectively.

## Follow-up

Removal is an implementation change and belongs on its own commit so a regression is bisectable,
per the issue's own instruction. It is tracked separately rather than applied here.
