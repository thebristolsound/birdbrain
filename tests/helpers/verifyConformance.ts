import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { PACKAGE_ROOT_FILES } from '../../src/packages/evidence-package-layout/index'
import { runVerifyScript } from './verifyScript'

// Every Evidence Package ships two verifiers: Package Verification, which the
// standalone binary runs, and verify.sh. They are separate implementations of
// one procedure, so nothing but a test keeps them answering the same way. This
// runs both on one unpacked package and reports what each said, so a caller
// can state both verdicts in one place and see a disagreement as a failure.
// Callers gate on HAS_OPENSSL and HAS_JQ.

export type BinaryVerdict = 'pass' | 'fail' | 'unsupported'
export type ScriptVerdict = 'pass' | 'fail' | 'incomplete'

export interface Conformance {
  binary: BinaryVerdict
  /** The checks Package Verification failed, in its order. */
  binaryFailures: { name: string; reason: string }[]
  script: ScriptVerdict
  /** Steps verify.sh named in a FAIL or INCOMPLETE line, ascending, each once. */
  scriptSteps: number[]
  scriptOutput: string
}

const SCRIPT_VERDICTS: Record<number, ScriptVerdict> = { 0: 'pass', 1: 'fail', 3: 'incomplete' }
const PRINTED_VERDICTS: Record<ScriptVerdict, string> = {
  pass: `${PACKAGE_ROOT_FILES.verifyScript}: PASS`,
  fail: `${PACKAGE_ROOT_FILES.verifyScript}: FAIL`,
  incomplete: `${PACKAGE_ROOT_FILES.verifyScript}: INCOMPLETE`
}
const FINDING = /^\s*(?:FAIL|INCOMPLETE) \[step (\d+)\]/gm

export function checkConformance(dir: string): Conformance {
  const result = verifyEvidencePackage(dir)
  if (result.notVerifiable) {
    throw new Error(`not an Evidence Package: ${result.notVerifiable.reason}`)
  }
  const binary: BinaryVerdict = result.unsupported ? 'unsupported' : result.pass ? 'pass' : 'fail'

  const run = runVerifyScript(dir)
  const script = SCRIPT_VERDICTS[run.status]
  // Exit 2 means the script could not run at all, which is a broken test
  // package or environment rather than a verdict to compare.
  if (script === undefined) {
    throw new Error(`verify.sh exited ${run.status}, which is not a verdict:\n${run.output}`)
  }
  // The verdict a reader sees has to be the one the exit status reports.
  for (const [verdict, printed] of Object.entries(PRINTED_VERDICTS)) {
    if (run.output.includes(printed) !== (verdict === script)) {
      throw new Error(
        `verify.sh exited ${run.status} (${script}) but its output disagrees:\n${run.output}`
      )
    }
  }
  const steps = new Set([...run.output.matchAll(FINDING)].map((match) => Number(match[1])))

  return {
    binary,
    binaryFailures: result.checks
      .filter((c) => c.status === 'fail')
      .map(({ name, reason }) => ({ name, reason: reason ?? '' })),
    script,
    scriptSteps: [...steps].sort((a, b) => a - b),
    scriptOutput: run.output
  }
}

/** Whether the two verifiers reached the same outcome. INCOMPLETE agrees with nothing. */
export function verdictsAgree({ binary, script }: Pick<Conformance, 'binary' | 'script'>): boolean {
  return binary === script
}
