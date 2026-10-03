import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  VERIFY_RECIPES,
  VERIFY_STEPS,
  sentenceStart,
  stepRange,
  stepRef,
  verifyStep
} from '@main/services/verifyProcedure'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'

const ROOT = join(__dirname, '..', '..', '..')

// The shipped text these files render cites steps only through the helpers. A
// TypeScript comment ships nowhere and may say what it likes; a `#` comment
// inside the script template ships, so it is checked like any other line.
const CITERS = [
  'src/main/services/verifyScript.ts',
  'src/main/services/verifyRunbook.ts',
  'src/main/services/reportHtml.ts'
]
const HAND_WRITTEN_STEP = /\b[Ss]teps? \d|\bbegin \d/
const TS_COMMENT = /^\s*(\/\/|\/\*|\*\s|\*\/|\*$)/

function handWrittenSteps(source: string): string[] {
  return source
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !TS_COMMENT.test(line) && HAND_WRITTEN_STEP.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`)
}

describe('the verification step list', () => {
  it('numbers its steps 1 to 6 in order', () => {
    expect(VERIFY_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(verifyStep(4).runbookTitle).toBe('Chain linkage')
  })

  it("keeps every script title free of the quote verify.sh's begin call wraps it in", () => {
    for (const step of VERIFY_STEPS) expect(step.scriptTitle).not.toContain("'")
  })

  it('renders each step under its number in verify.sh and VERIFY.md', () => {
    for (const { number, scriptTitle, runbookTitle } of VERIFY_STEPS) {
      expect(VERIFY_SCRIPT).toContain(`\nbegin ${number} '${scriptTitle}'\n`)
      expect(VERIFY_RUNBOOK).toContain(`\n## Step ${number} — ${runbookTitle}\n`)
    }
  })

  it('spells each recipe the same way in both documents', () => {
    for (const recipe of Object.values(VERIFY_RECIPES)) {
      expect(VERIFY_SCRIPT).toContain(recipe)
      expect(VERIFY_RUNBOOK).toContain(recipe)
    }
    // A backslash lost to template escaping would turn `\(` into `(`.
    expect(VERIFY_RECIPES.indexCheckFilter).toContain('"\\(.sha256)  \\(.path)"')
    expect(VERIFY_RECIPES.canonicalEntryBody).toContain("tr -d '\\n'")
  })
})

describe('step citations', () => {
  it('cites one step, several, a sub-step and a range', () => {
    expect(stepRef(2)).toBe('step 2')
    expect(stepRef('6a')).toBe('step 6a')
    expect(stepRef(3, 4)).toBe('steps 3 and 4')
    expect(stepRef(3, 4, 6)).toBe('steps 3, 4 and 6')
    expect(stepRange(2, 4)).toBe('steps 2 to 4')
    expect(sentenceStart(stepRef(6))).toBe('Step 6')
  })

  for (const file of CITERS) {
    it(`has no hand-written step number in ${file}`, () => {
      expect(handWrittenSteps(readFileSync(join(ROOT, file), 'utf-8'))).toEqual([])
    })
  }

  it('catches a hand-written citation, including one in a shipped # comment', () => {
    const source = [
      '// step 3 in a TypeScript comment ships nowhere',
      '# --- Step 1 ----',
      "begin 2 'entry signatures'",
      'covered by steps 3, 4 and 6',
      'see ${stepRef(5)}'
    ].join('\n')
    expect(handWrittenSteps(source)).toEqual([
      '2: # --- Step 1 ----',
      "3: begin 2 'entry signatures'",
      '4: covered by steps 3, 4 and 6'
    ])
  })
})
