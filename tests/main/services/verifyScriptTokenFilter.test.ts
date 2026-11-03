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

// The filter above skips a stamp whose tsaToken is present but not a string,
// and Package Verification rejects that entry's whole chain as malformed, so
// verify.sh has to fail it rather than report no trusted-time claim (#1725).
// The schema rejects JSON null as well, so a null token counts as present.
describe('verify.sh malformed_token_filter', () => {
  const MALFORMED_FILTER = VERIFY_RECIPES.malformedTokenFilter

  const malformed = (lines: string[]): string[] =>
    execFileSync('jq', ['-c', `${MALFORMED_FILTER} | .tsaToken`], {
      input: lines.join('\n') + '\n',
      encoding: 'utf-8'
    })
      .split('\n')
      .filter((line) => line.length > 0)

  it('is defined once in the script, under its own name', () => {
    expect(VERIFY_SCRIPT).toContain(`malformed_token_filter='${MALFORMED_FILTER}'\n`)
    expect(VERIFY_SCRIPT.split(MALFORMED_FILTER).length - 1).toBe(1)
    expect(VERIFY_SCRIPT.split('$malformed_token_filter').length - 1).toBe(1)
  })

  it.skipIf(!HAS_JQ)('takes a content stamp whose tsaToken is any non-string value', () => {
    expect(
      malformed([
        stamp('content', 7),
        stamp('content', null),
        stamp('content', {}),
        stamp(undefined, true)
      ])
    ).toEqual(['7', 'null', '{}', 'true'])
  })

  it.skipIf(!HAS_JQ)('takes an entry stamp whose tsaToken is not a string', () => {
    expect(malformed([stamp('entry', 7)])).toEqual(['7'])
  })

  it.skipIf(!HAS_JQ)('takes no stamp with a string tsaToken or none at all', () => {
    const tokenless = JSON.stringify({ type: 'timestamp', captureContentHash: HASH })
    expect(malformed([stamp('content'), stamp('entry'), tokenless])).toEqual([])
  })

  it('gives the runbook reader the same command and says the script runs it', () => {
    const prose = VERIFY_RUNBOOK.replace(/\s+/g, ' ')
    expect(VERIFY_RUNBOOK).toContain(`jq -r '${MALFORMED_FILTER} | .index' <chain>`)
    expect(prose).toContain(
      '`verify.sh` fails the package for such an entry in any chain it reads to its end'
    )
    expect(prose).toContain('any index it prints is a failure')
  })
})
