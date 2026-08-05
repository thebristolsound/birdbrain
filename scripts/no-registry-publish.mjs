#!/usr/bin/env node
// Second half of the registry-publication guard (the first is "private": true).
//
// `private` alone is not demonstrable on a dry run: npm only reaches the EPRIVATE
// check inside libnpmpublish, which `npm publish --dry-run` never calls (see
// lib/commands/publish.js — `if (!dryRun) await ... libpub(...)`), so the dry run
// prints a successful-looking "+ birdbrain@x.y.z". npm does run `prepublishOnly`
// for directory publishes before packing, dry run included, so failing here makes
// the guard fire on both the real command and the rehearsal of it.
//
// Birdbrain ships as a signed-by-nobody desktop installer from GitHub releases, not
// as an npm package: the tarball would carry the whole working tree and a name that
// is unclaimed on the public registry. If registry publication is ever approved,
// remove BOTH this script and `private` deliberately, in the same change.

console.error(
  [
    'Refusing to publish: birdbrain is not distributed through an npm registry.',
    '',
    'The app is released as desktop installers by .github/workflows/release.yml.',
    'Publication is guarded twice: "private": true in package.json (which npm and',
    'pnpm enforce on a real publish) and this prepublishOnly hook (which also fires',
    'on `npm publish --dry-run`).',
    '',
    'If registry publication has been approved, remove both guards in one change.'
  ].join('\n')
)
process.exit(1)
