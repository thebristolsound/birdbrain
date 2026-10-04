import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAPTURE_PACKAGE_DIRECTORY,
  PACKAGE_ROOT_FILES,
  SCREENSHOT_PACKAGE_DIRECTORY,
  TIMESTAMP_PACKAGE_DIRECTORY
} from '../index'

// The seam only holds while no consumer spells a path itself. This fails the
// moment a directory is followed by a variable, a template hole, a glob or a
// placeholder, or a directory or root document appears as a quoted TS string,
// anywhere the package is meant to be read from. Prose mentions in comments
// and messages are not path construction and pass. A line marked
// `layout-exempt:` with its reason is skipped; the Working Copy's id-addressed
// screenshot is the one such line (ADR-0010).

const ROOT = join(__dirname, '..', '..', '..', '..')
const CONSUMERS = [
  'src/main/services/export.ts',
  'src/main/services/exhibits.ts',
  'src/main/services/verifyRunbook.ts',
  'src/main/services/verifyScript.ts',
  'src/main/services/reportHtml.ts',
  'src/main/services/certification.ts',
  'src/main/services/tsaTrust.ts',
  'src/shared/verify/evidencePackage.ts',
  'src/shared/verify/exhibitBinding.ts'
]

const directories = [
  CAPTURE_PACKAGE_DIRECTORY,
  SCREENSHOT_PACKAGE_DIRECTORY,
  TIMESTAMP_PACKAGE_DIRECTORY
].join('|')
const CONSTRUCTED_PATH = new RegExp(`\\b(${directories})/(\\$|\\{|<|\\*|['"\`])`)
const QUOTED_DIRECTORY = new RegExp(`(['"\`])(${directories})\\1`)
const roots = Object.values(PACKAGE_ROOT_FILES)
  .map((name) => name.replace(/[.]/g, '\\.'))
  .join('|')
const QUOTED_ROOT = new RegExp(`(['"\`])(${roots})\\1`)

describe('Package Layout consumers', () => {
  for (const file of CONSUMERS) {
    it(`${file} constructs no package path of its own`, () => {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
      const offenders = lines
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => {
          // A closed /* */ span goes first, so code after it on the line is still read.
          const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*(\/\/|\/\*|#|\*).*$/, '')
          if (code.includes('layout-exempt:')) return false
          return (
            CONSTRUCTED_PATH.test(code) || QUOTED_DIRECTORY.test(code) || QUOTED_ROOT.test(code)
          )
        })
        .map(({ line, n }) => `${n}: ${line.trim()}`)
      expect(offenders).toEqual([])
    })
  }
})
