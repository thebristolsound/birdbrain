// The verification procedure as one ordered list of steps. verify.sh, VERIFY.md
// and the report's verification section all number the same six steps and cite
// each other's numbers; they read every number, title and citation from here,
// so renumbering a step or inserting one is one edit. The citation guard in
// tests/main/services/verifyProcedure.test.ts fails on a step number spelled by
// hand in any of the three.
//
// It holds no step bodies: the script's steps share shell state (step 4's head
// hash feeds step 5), so per-step strings here would hide that coupling.

export type VerifyStepNumber = 1 | 2 | 3 | 4 | 5 | 6
export type VerifySubStep = '6a' | '6b' | '6c'

export interface VerifyStep {
  number: VerifyStepNumber
  /** `begin N '<scriptTitle>'` in verify.sh; never contains `'`. */
  scriptTitle: string
  /** `## Step N — <runbookTitle>` in VERIFY.md. */
  runbookTitle: string
}

export const VERIFY_STEPS: readonly VerifyStep[] = [
  {
    number: 1,
    scriptTitle: 'file integrity against the unsigned index',
    runbookTitle: 'File integrity (index self-consistency)'
  },
  {
    number: 2,
    scriptTitle: 'entry signatures',
    runbookTitle: 'Entry signature (`schemaVersion` 2 and above)'
  },
  {
    number: 3,
    scriptTitle: 'recomputed entry hashes',
    runbookTitle: 'Recompute `entryHash` (canonicalization recipe)'
  },
  { number: 4, scriptTitle: 'chain linkage', runbookTitle: 'Chain linkage' },
  {
    number: 5,
    scriptTitle: 'content bind to the signed chain',
    runbookTitle: 'Content bind (load-bearing for the evidence itself)'
  },
  {
    number: 6,
    scriptTitle: 'timestamp, the canonical TSA verification',
    runbookTitle: 'Timestamp (canonical TSA verification)'
  }
]

export function verifyStep(number: VerifyStepNumber): VerifyStep {
  return VERIFY_STEPS[number - 1]
}

/** "step 2", "step 6a", "steps 3 and 4", "steps 3, 4 and 6". */
export function stepRef(...refs: (VerifyStepNumber | VerifySubStep)[]): string {
  if (refs.length === 1) return `step ${refs[0]}`
  return `steps ${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}`
}

/** "steps 2 to 4". */
export function stepRange(from: VerifyStepNumber, to: VerifyStepNumber): string {
  return `steps ${from} to ${to}`
}

/** A citation opening a sentence: "Step 2 applies this rule". */
export function sentenceStart(citation: string): string {
  return citation.charAt(0).toUpperCase() + citation.slice(1)
}

/** The jq recipes verify.sh runs and VERIFY.md prints, spelled once. */
export const VERIFY_RECIPES = {
  indexCheckFilter: String.raw`.artifacts[] | "\(.sha256)  \(.path)"`,
  canonicalEntryBody: String.raw`jq -cS 'del(.entryHash, .signature)' | tr -d '\n'`
}
