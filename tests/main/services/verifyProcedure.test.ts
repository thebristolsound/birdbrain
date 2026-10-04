import { describe, expect, it } from 'vitest'
import ts from 'typescript'
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

// The text these files ship cites steps only through the helpers. Comments
// come out through the compiler, so only real TypeScript comments are exempt:
// a template line that starts with `*`, `//` or `#` ships and is checked.
const CITERS = [
  'src/main/services/verifyScript.ts',
  'src/main/services/verifyRunbook.ts',
  'src/main/services/reportHtml.ts'
]
// "step" then a digit, across a line break, an HTML tag or entity, or the
// opening of a template hole holding a literal.
const HAND_WRITTEN_STEP =
  /\b[Ss]teps?(?:(?:\s|&nbsp;|&#160;|<[^>]*>)+(?:\$\{\s*)?|\$\{\s*)['"]?\d[^\n]{0,20}|\bbegin\s+\d[^\n]{0,20}/g

function handWrittenSteps(source: string): string[] {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext }
  })
  return [...outputText.matchAll(HAND_WRITTEN_STEP)].map((match) => match[0].replace(/\s+/g, ' '))
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
    expect(() => stepRange(6, 2)).toThrow('runs backwards')
    expect(sentenceStart(stepRef(6))).toBe('Step 6')
  })

  for (const file of CITERS) {
    it(`has no hand-written step number in ${file}`, () => {
      expect(handWrittenSteps(readFileSync(join(ROOT, file), 'utf-8'))).toEqual([])
    })
  }

  it('catches a hand-written citation however the shipped text spells it', () => {
    const source = [
      '// step 1 in a TypeScript comment ships nowhere',
      '/* nor does step 2 */',
      'export const T = `',
      '# --- Step 1 ----',
      "begin 2 'entry signatures'",
      '* see step 3',
      '// see step 4',
      'covered by steps 3, 4 and 6',
      'wrapped across a line at step',
      '5 and on',
      'Step&nbsp;6',
      'step ${6}',
      'Step <strong>6</strong>',
      'see ${stepRef(5)} and ## Step ${number}',
      '`'
    ].join('\n')
    expect(handWrittenSteps(source).map((found) => found.slice(0, 12))).toEqual([
      'Step 1 ----',
      "begin 2 'ent",
      'step 3',
      'step 4',
      'steps 3, 4 a',
      'step 5 and o',
      'Step&nbsp;6',
      'step ${6}',
      'Step <strong'
    ])
  })
})
