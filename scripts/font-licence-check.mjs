#!/usr/bin/env node
// Fails when a tracked folder holds font files and no licence file beside them.
//
// The committed fonts are copies of SIL Open Font License packages, and a copy
// that loses its licence text renders exactly like one that kept it, so nothing
// else notices the gap (#1624).
//
// It reads `git ls-files`, so untracked build output and node_modules are out of
// scope, and it needs no install. The Security workflow runs it because ci.yml's
// code jobs skip a pull request that touches only docs/, and two of the font
// folders are under docs/.
//
// Usage: node scripts/font-licence-check.mjs
// Exit codes: 0 every font folder has a licence file, 1 at least one has none.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const FONT_FILE = /\.(woff2?|ttf|otf)$/i

// OFL, LICENSE, LICENCE or COPYING, with an optional version suffix (OFL-1.1)
// and an optional .txt or .md extension.
export const LICENCE_FILE = /^(ofl|licen[cs]e|copying)(-\d+(\.\d+)*)?(\.(txt|md))?$/i

const folderOf = (path) => {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '.' : path.slice(0, slash)
}

const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1)

// Folders are compared as exact paths: a licence in a parent or child folder
// does not cover fonts that sit somewhere else.
export const checkFontLicences = (paths) => {
  const fontFolders = new Set()
  const licensed = new Set()
  for (const path of paths) {
    if (FONT_FILE.test(path)) fontFolders.add(folderOf(path))
    if (LICENCE_FILE.test(nameOf(path))) licensed.add(folderOf(path))
  }
  const folders = [...fontFolders].sort()
  return { folders, missing: folders.filter((folder) => !licensed.has(folder)) }
}

// -z keeps paths with spaces or non-ASCII names unquoted.
export const trackedFiles = (cwd) =>
  execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0')
    .filter(Boolean)

export const main = (cwd = process.cwd()) => {
  const { folders, missing } = checkFontLicences(trackedFiles(cwd))
  if (missing.length === 0) {
    console.log(
      `font-licence-check: ${folders.length} tracked font folder(s), each with a licence file.`
    )
    return 0
  }
  for (const folder of missing) console.error(`  no licence file beside the fonts in ${folder}/`)
  console.error(
    `font-licence-check: ${missing.length} of ${folders.length} tracked font folder(s) have no ` +
      'licence file. Add the font licence (for example OFL.txt, copied from the LICENSE file of ' +
      'the package the fonts came from) in the same folder as the fonts.'
  )
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
