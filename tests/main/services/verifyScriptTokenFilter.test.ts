import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { VERIFY_RECIPES } from '@main/services/verifyProcedure'
import { HAS_JQ } from '../../helpers/jq'

// Step 6 of the shipped verify.sh takes its work set from the signed manifest,
// and schema 4 put a second kind of `timestamp` entry there: one whose subject
// is `entry`, binding a `merge` entry's Entry Hash rather than an Exhibit's
// bytes. The binary excludes those from trusted time; the script and the
// runbook prose that shipped beside it have to agree, or the manual path
// presents a sync receipt as a capture's timestamp and contradicts the binary
// on the same package (#1518 review).

const TOKEN_FILTER = VERIFY_RECIPES.signedTokenFilter

const HASH = 'a'.repeat(64)
const stamp = (subject?: string, tsaToken: unknown = `token-${subject ?? 'absent'}`): string =>
  JSON.stringify({
    type: 'timestamp',
    captureContentHash: HASH,
    tsaToken,
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
    expect(VERIFY_SCRIPT).toContain(`signed_token_filter='${TOKEN_FILTER}'\n`)
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

  it.skipIf(!HAS_JQ)('takes no stamp whose tsaToken is not a string', () => {
    expect(selected([stamp('content', 7), stamp('content', null)])).toEqual([])
  })

  it('documents the same filter in the runbook prose', () => {
    expect(VERIFY_RUNBOOK).toContain(`jq -r '${TOKEN_FILTER} | `)
  })
})
