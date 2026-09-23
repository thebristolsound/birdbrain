import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import {
  CAPTURE_PACKAGE_DIRECTORY,
  PACKAGE_ROOT_FILES,
  SCREENSHOT_PACKAGE_DIRECTORY,
  TIMESTAMP_PACKAGE_DIRECTORY,
  capturePagePath,
  inCasePath,
  screenshotPath,
  timestampTokenPath
} from '../index'
import {
  SHELL_DIRECTORY_VARS,
  SHELL_PATH_HELPERS,
  SHELL_ROOT_FILE_VARS,
  renderShellPathHelpers
} from '../shell'

// verify.sh and the binary verifier have to derive the SAME package path from
// the same input, or one of them reports files missing that the other binds
// (#1156 fix round). Run through a shell rather than reasoned about: the tool
// shell here is zsh on the maintainer's machine, and this block ships to a
// reader's `sh`.

const HELPERS = renderShellPathHelpers()
const SHELLS = ['/bin/sh', '/bin/bash']

function sh(shell: string, script: string, arg = ''): string {
  return execFileSync(shell, ['-c', `${HELPERS}\n${script}`, 'sh', arg], { encoding: 'utf-8' })
}

const IDS = ['cap-1', 'a b', '3f2e', 'x_y.z']
const STORAGE_PATHS: Array<[string, string]> = [
  ['case-id/documents/exhibit.pdf', 'documents/exhibit.pdf'],
  ['case-id\\documents\\exhibit.pdf', 'documents/exhibit.pdf'],
  ['case-id\\attachments\\a b.zip', 'attachments/a b.zip'],
  ['case-id/documents\\exhibit.pdf', 'documents/exhibit.pdf'],
  ['exhibit.pdf', 'exhibit.pdf']
]

describe('Package Layout as sh', () => {
  for (const shell of SHELLS) {
    describe(shell, () => {
      it('prints the same Capture paths as the TS functions', () => {
        for (const id of IDS) {
          expect(sh(shell, `${SHELL_PATH_HELPERS.capturePagePath} "$1"`, id)).toBe(
            capturePagePath(id)
          )
          expect(sh(shell, `${SHELL_PATH_HELPERS.screenshotPath} "$1"`, id)).toBe(
            screenshotPath(id)
          )
          expect(sh(shell, `${SHELL_PATH_HELPERS.timestampTokenPath} "$1"`, id)).toBe(
            timestampTokenPath(id)
          )
        }
      })

      it('maps a storage path into the Case like inCasePath', () => {
        for (const [input, expected] of STORAGE_PATHS) {
          expect(inCasePath(input), input).toBe(expected)
          expect(sh(shell, `${SHELL_PATH_HELPERS.inCasePath} "$1"`, input), input).toBe(expected)
        }
      })

      it('names the root documents and directories the package does', () => {
        const read = (name: string): string => sh(shell, `printf '%s' "$${name}"`)
        for (const [key, variable] of Object.entries(SHELL_ROOT_FILE_VARS)) {
          expect(read(variable), key).toBe(
            PACKAGE_ROOT_FILES[key as keyof typeof SHELL_ROOT_FILE_VARS]
          )
        }
        expect(read(SHELL_DIRECTORY_VARS.pages)).toBe(CAPTURE_PACKAGE_DIRECTORY)
        expect(read(SHELL_DIRECTORY_VARS.screenshots)).toBe(SCREENSHOT_PACKAGE_DIRECTORY)
        expect(read(SHELL_DIRECTORY_VARS.timestamps)).toBe(TIMESTAMP_PACKAGE_DIRECTORY)
      })
    })
  }

  it('is POSIX sh: no bashisms the BSD sh would reject', () => {
    expect(HELPERS).not.toMatch(/\[\[|\$\(\(|function /)
  })
})
