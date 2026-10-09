# Releases publish from the source repository

**Status:** Accepted

**Date:** 2026-10-09

Reverses the split #567 made, which published releases to `thebristolsound/birdbrain-releases`.
Amends [ADR-0008](0008-public-release-decisions.md) where it records deleting the legacy releases
on `thebristolsound/birdbrain` because they "would have become a second public download
surface." ADR-0008 Decision 3, that every release is a pre-release while artifacts are unsigned,
is unchanged.

## Context

#567 moved releases to a separate repository because the source repository was private, and
electron-updater's GitHub provider reads the unauthenticated `releases.atom` feed. Both
repositories are public now, so that reason no longer holds, and the split leaves testers with
two places to file issues and two places to look for advisories.

Three facts constrain the move. Each was measured on 2026-10-09.

- **An installed build keeps the feed it was built with.** electron-builder writes
  `resources/app-update.yml` from `build.publish` at package time, and electron-updater reads only
  that file. The published `1.0.1-beta.22` deb names `repo: birdbrain-releases`.
- **The feed lists every version tag, including tags with no release.** On a scratch public
  repository that already had a published release, a pushed `v1.0.1-beta.31` tag with no release
  went to the top of `releases.atom`. electron-updater 6.8.9, run with a beta install's settings,
  then failed with a 404 on that tag's `latest-linux.yml`. A draft release on the tag left it in
  the feed. A draft created against a commit with no tag stayed out of the feed, and publishing it
  created the tag with its files already attached.
- **The tag-push trigger opens that window on every release.** The `1.0.1-beta.22` run took 6
  minutes from tag to last upload.

## Decision

- **Releases publish to `thebristolsound/birdbrain`.** `build.publish` in `package.json` and
  `GITHUB_REPO_SLUG` name it.
- **The maintainer starts a release by hand from main.** `release.yml` runs on
  `workflow_dispatch`, releases the version in `package.json`, and refuses a version that is
  already tagged. No tag is pushed. The `publish` job uploads every file to a draft with no tag and
  then publishes it, so GitHub creates the tag after the files are attached.
- **One job per workflow can write to the repository.** The workflow token stays at
  `contents: read`, and only the `publish` jobs of `release.yml` and `release-macos.yml` widen it
  to `contents: write`. Those jobs check out the repository but run no install, no build, and no
  project code other than `.github/scripts/release/`. The build jobs hand their files over as
  workflow artifacts and never hold a token that can write.
- **One release goes to both repositories.** The first release after this change is also copied,
  byte for byte, to `birdbrain-releases` by the `bridge` job, so installs from `1.0.1-beta.18` to
  `1.0.1-beta.22` reach a build that reads the new feed. The `bridge` job and
  `RELEASES_REPO_TOKEN` are then removed.
- **`birdbrain-releases` is archived, not deleted.** An archived repository still serves its
  feed, so an install that never took the bridge release finds no update. A deleted one would
  answer 404, and the install would show an update error.

## Consequences

- **The build legs lose access to the paid environment.** They read no stored secret, so they no
  longer name `paid-runs`. The spend guard moves from the tag ruleset to an actor check on the
  `prepare` job, which every other job needs, and on the `bridge` job, which reads the secret.
- **A bare version tag still breaks updates.** Anyone who pushes a `v*` tag to
  `thebristolsound/birdbrain` by hand puts it in the feed. The tag ruleset that lets only the
  maintainer create one stays in place.
- **The 22 older tags stay in the feed.** `v0.1.0-alpha.2` through `v1.0.1-beta.22` have no
  release in this repository. The feed orders entries newest first, so a new release heads it
  and electron-updater reads that entry.
- **The `paid-runs` environment no longer needs to admit `v*` tags.** Removing that rule is the
  maintainer's call and is not part of this change.

## Alternatives rejected

- **Keep the tag push and accept the window.** A beta that checks for updates during the build
  shows an update error, and every release repeats it.
- **Push a non-version tag such as `release/1.0.1-beta.23`.** electron-updater skips tags that are
  not valid versions, so this also closes the window. It keeps a tag push, but the `paid-runs`
  environment would have to admit the new pattern, and the trigger would differ from the tag
  readers expect.
- **Widen `RELEASES_REPO_TOKEN` to the source repository.** A stored secret with write access to
  the source repository is a larger standing credential than a workflow token scoped to one job.
