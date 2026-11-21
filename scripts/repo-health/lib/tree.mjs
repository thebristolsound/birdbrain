// Path helpers the signal modules share. ctx.paths is the tracked file list and
// ctx.read reads one of them.

import { CODE_EXTENSIONS } from '../../slop-audit/lib/files.mjs'

// The tool's own source and tests spell out the patterns they count, in regular
// expressions and in fixtures. Counting them would make the report measure itself.
const OWN_PREFIXES = ['scripts/repo-health/', 'tests/repoHealth/']

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const PACKAGE_TESTS = /^src\/packages\/[^/]+\/tests\//

export const isCode = (path) => CODE_EXTENSIONS.some((ext) => path.endsWith(ext))

export const isOwn = (path) => OWN_PREFIXES.some((prefix) => path.startsWith(prefix))

export const isTestFile = (path) =>
  path.startsWith('tests/') ||
  path.startsWith('e2e/') ||
  TEST_FILE.test(path) ||
  PACKAGE_TESTS.test(path)

export const under = (path, roots) => roots.some((root) => path.startsWith(root))

export const countMatches = (text, pattern) => (text.match(pattern) ?? []).length
