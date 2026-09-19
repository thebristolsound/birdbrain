import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { inCasePath } from '@shared/verify/exhibitBinding'

// verify.sh and the binary verifier have to derive the SAME package path from
// the same signed storage path, or one of them reports files missing that the
// other binds (#1156 fix round). The store writes platform-native paths, so a
// Case built on Windows signs `<caseId>\documents\x.pdf` while the package
// holds `documents/x.pdf`.
//
// Run through a shell rather than reasoned about: the tool shell here is zsh
// on the maintainer's machine, and this function ships to a reader's `sh`.

/** The `in_case_path` definition as it ships, lifted out of the script. */
const IN_CASE_PATH = ((): string => {
  const start = VERIFY_SCRIPT.indexOf('in_case_path() {')
  const end = VERIFY_SCRIPT.indexOf('\n}', start)
  return VERIFY_SCRIPT.slice(start, end + 2)
})()

function runInCasePath(shell: string, input: string): string {
  return execFileSync(shell, ['-c', `${IN_CASE_PATH}\nin_case_path "$1"`, 'sh', input], {
    encoding: 'utf-8'
  })
}

const CASES: Array<[string, string]> = [
  ['case-id/documents/exhibit.pdf', 'documents/exhibit.pdf'],
  ['case-id\\documents\\exhibit.pdf', 'documents/exhibit.pdf'],
  ['case-id\\attachments\\a b.zip', 'attachments/a b.zip'],
  ['case-id/documents\\exhibit.pdf', 'documents/exhibit.pdf'],
  ['exhibit.pdf', 'exhibit.pdf']
]

describe('verify.sh in_case_path', () => {
  for (const shell of ['/bin/sh', '/bin/bash']) {
    for (const [input, expected] of CASES) {
      it(`${shell} maps ${input} to ${expected}`, () => {
        expect(runInCasePath(shell, input)).toBe(expected)
      })
    }
  }

  it('agrees with the binary verifier on every case', () => {
    for (const [input, expected] of CASES) {
      expect(inCasePath(input), input).toBe(expected)
    }
  })
})
