import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { HAS_JQ } from '../../helpers/jq'

// Step 6 of the shipped verify.sh takes its work set from the signed manifest,
// and schema 4 put a second kind of `timestamp` entry there: one whose subject
// is `entry`, binding a `merge` entry's Entry Hash rather than an Exhibit's
// bytes. The binary excludes those from trusted time; the script and the
// runbook prose that shipped beside it have to agree, or the manual path
// presents a sync receipt as a capture's timestamp and contradicts the binary
// on the same package (#1518 review).

/** The `signed_token_filter` definition as it ships, lifted out of the script. */
const TOKEN_FILTER = ((): string => {
  const start = VERIFY_SCRIPT.indexOf("signed_token_filter='")
  const end = VERIFY_SCRIPT.indexOf("'\n", start + "signed_token_filter='".length)
  return VERIFY_SCRIPT.slice(start + "signed_token_filter='".length, end)
})()

const HASH = 'a'.repeat(64)
const stamp = (subject?: string): string =>
  JSON.stringify({
    type: 'timestamp',
    captureContentHash: HASH,
    tsaToken: `token-${subject ?? 'absent'}`,
    ...(subject === undefined ? {} : { subject })
  })

function selected(lines: string[]): string[] {
  const out = execFileSync('jq', ['-r', `${TOKEN_FILTER} | .tsaToken`], {
    input: lines.join('\n') + '\n',
    encoding: 'utf-8'
  })
  return out.split('\n').filter((line) => line.length > 0)
}

describe('verify.sh signed_token_filter', () => {
  it('is the one definition the script uses everywhere it selects a token', () => {
    expect(TOKEN_FILTER).toContain('"timestamp"')
    // Three sites read it: the work set and the two per-capture lookups.
    expect(VERIFY_SCRIPT.split('$signed_token_filter').length - 1).toBe(3)
  })

  it.skipIf(!HAS_JQ)('takes a content stamp and an omitted subject, never an entry stamp', () => {
    expect(selected([stamp(), stamp('content'), stamp('entry')])).toEqual([
      'token-absent',
      'token-content'
    ])
  })

  it.skipIf(!HAS_JQ)('takes no stamp whose subject is a value no schema defines', () => {
    expect(selected([stamp('exhibit')])).toEqual([])
  })

  it('documents the same filter in the runbook prose', () => {
    expect(VERIFY_RUNBOOK).toContain('(.subject // "content") == "content"')
  })
})
