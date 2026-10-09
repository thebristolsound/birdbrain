# Move releases into the main repository

**Status:** active

Releases publish to `thebristolsound/birdbrain` instead of `thebristolsound/birdbrain-releases`.
The separate repository exists because the main repository was private when #567 split it out.
Both repositories are public now, so that reason no longer applies.

## What constrains the order

- **Installed builds keep their old feed.** electron-builder writes `resources/app-update.yml`
  from `build.publish` at package time, and electron-updater reads only that file. The shipped
  `1.0.1-beta.22` deb contains `repo: birdbrain-releases`. A tester on beta.18 to beta.22 gets
  only releases published to `birdbrain-releases`, so one bridge release must go to both
  repositories.
- **The main repository's feed lists bare tags.** On 2026-10-09, `releases.atom` on the main
  repository listed `v1.0.1-beta.22` and `diag/curator-marker`, which have no releases. Run against
  that feed, electron-updater 6.8.9 picks `v1.0.1-beta.22` and fails with a 404 on
  `latest-linux.yml`. A tag pushed before its assets exist puts testers into the updater error
  state.
- **The release jobs gain write access to the main repository.** The maintainer chose the
  workflow token with `contents: write`, scoped to jobs that run no build or install step, over
  widening `RELEASES_REPO_TOKEN`.
- **The "Get a release by tag name" endpoint does not return drafts.** `checksums.sh` reads the
  release by tag, so on a draft it must read by release ID, or run after publication.

## Step 1: measure the feed (maintainer approval needed)

Whether a draft release hides its tag from `releases.atom`, and whether the feed lists bare tags
once a repository has published releases, decides how much the draft-then-publish flow closes
the error window. Measure both on a scratch public repository, or a fork, which the maintainer
creates. Run `/tmp/br-probe/probe.cjs` (the real `GitHubProvider.getLatestVersion`) against it in
three states: a bare tag with no release, a tag with a draft release, and a tag with a published
prerelease.

Record the result in this plan. If the bare tag stays in the feed while the release is a draft,
the remaining option is to push the tag last: create the draft against a commit, and let
publication create the tag. The `on: push: tags` trigger would then need replacing, so that
outcome goes back to the maintainer before step 2.

### Result (2026-10-09)

Measured on `thebristolsound/feed-probe` (public, scratch) with electron-updater 6.8.9, starting
from a published prerelease `v1.0.1-beta.30` that carried `latest-linux.yml`:

| State | `releases.atom` | Probe |
| --- | --- | --- |
| Bare tag `v1.0.1-beta.31` pushed | lists beta.31 first | 404 on beta.31 `latest-linux.yml` |
| Draft release on that tag | still lists beta.31 | 404 on beta.31 |
| Draft for `v1.0.1-beta.32` against `main`, no tag | no beta.32 entry, no tag | unchanged |
| That draft published | lists beta.32 first | finds `1.0.1-beta.32` |

- **A draft does not hide its tag.** The feed lists every version tag, including in a
  repository that already has published releases. Draft-then-publish under `on: push: tags` leaves the error
  window open.
- **An untagged draft closes the window.** GitHub creates the tag at publication, when the
  assets are already attached.
- **The window under a tag push lasts one release run.** The beta.22 run took 6 minutes.
- **Non-semver tags are harmless.** `GitHubProvider` skips any tag that fails `semver.valid`, so
  `diag/curator-marker` never reaches the updater.

The trigger therefore changes, and that choice goes to the maintainer.

## Step 2: the decision record (PR 1)

Add ADR-0046, titled "Releases publish from the source repository." It records three things:

- **Reversal:** it reverses the #567 split and the reasoning at ADR-0008 line 424, which deleted
  the main repository's releases to avoid a second download surface. After the archive in step 6
  there is still one surface.
- **Token posture:** only the publish jobs get `contents: write`, and those jobs check out
  nothing they execute. They run no `pnpm install`, no build and no project scripts other than
  `.github/scripts/release/`.
- **Bridge and archive:** one release is published to both repositories, and `birdbrain-releases`
  is archived after it rather than deleted, so older installs get "no update" instead of an
  error.

## Step 3: the workflows (PR 1)

- **`release.yml`:**
  - The build legs (`build-app`, `build-extension`) keep `contents: read`. Instead of uploading
    to a release, they upload their files with `actions/upload-artifact`.
  - A new `publish` job runs after the builds and is the only job with `contents: write`. It
    downloads the artifacts and creates the release as a draft prerelease in the main
    repository. It uploads every file and exports the bill of materials (`sbom.sh`). It checks
    that `latest.yml` and `latest-linux.yml` are present, publishes the release, and then runs
    `checksums.sh` and uploads `SHA256SUMS.txt`.
  - The Windows and Linux feed files gate publication, and `latest-mac.yml` does not, which
    matches today's experimental macOS leg.
  - Bridge release only: the same job also creates the release in `birdbrain-releases` with
    `RELEASES_REPO_TOKEN`. PR 3 removes this.
- **`release-macos.yml`:** split the job the same way, into a read-only macOS build job and a
  `contents: write` upload job that targets the main repository.
- **`create-release`:** the job goes away, because `publish` creates the release.

## Step 4: code and tests (PR 1)

- **Publish target and constant:** `package.json` `build.publish.repo` and `GITHUB_REPO_SLUG` in
  `src/shared/constants.ts` change to `birdbrain`.
- **Release note URLs:** `tests/main/services/updater.test.ts` lines 127 and 394 follow the
  constant.
- **Workflow assertions:** `tests/releaseSbomChecksums.test.ts` replaces the "single read-only
  `permissions:`" assertion at line 311. The new assertion says that the top-level permissions
  are `contents: read`, that only `publish` widens to `contents: write`, and that `publish` has
  no `pnpm` or `checkout`-then-run step. Changing this test is deliberate, because the property
  it guarded is the one ADR-0046 replaces. The repository strings at lines 305 and 333 follow
  the move.
- **Spend guard:** `tests/spendGuardWorkflows.test.ts:23` lists `RELEASES_REPO_TOKEN`, and that
  entry stays until PR 3.

PR 1 changes more than 10 files and widens a workflow permission, so it waits for plan approval
under ADR-0016.

## Step 5: cut and verify the bridge release (maintainer)

1. Tag `v1.0.1-beta.23` after PR 1 merges.
2. Extract `resources/app-update.yml` from the published deb and confirm it says
   `repo: birdbrain`.
3. Run the probe against both repositories. Both report `1.0.1-beta.23`.
4. Install beta.22 on a Linux machine, check for updates, and confirm it offers beta.23. After
   installing, a second check reads the main repository.

## Step 6: links, cleanup and archive (PR 2, then the maintainer)

- **PR 2:** point the links at the main repository. They are in `README.md` (badge, releases
  page and issues), `SECURITY.md:5`, `website/content/docs.json`, `download.mdx` and
  `tester-guide.mdx`. Outside bug reports go to the main repository's issues.
  `stale-agent-issues.yml` closes only issues filed by the machine account, so it does not touch
  them.
- **PR 3:** remove the bridge upload to `birdbrain-releases` and every `RELEASES_REPO_TOKEN`
  reference, including the spend guard entry. Then the maintainer deletes the secret from the
  `paid-runs` environment.
- **Maintainer:** edit the `birdbrain-releases` README to point at the main repository, then
  archive it. Do not delete it.

## Out of scope

- **ADR-0008's deletion of the four leaked pre-releases (line 627).** That decision stands as
  written, and this move leaves its trigger ("once the next beta has updated testers") unchanged.
- **Copying beta.18 to beta.22 into the main repository.** Nothing reads them there.
