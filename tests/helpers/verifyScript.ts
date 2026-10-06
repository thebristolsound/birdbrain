import { execFileSync } from 'child_process'
import { PACKAGE_ROOT_FILES } from '../../src/packages/evidence-package-layout/index'

export interface VerifyRun {
  status: number
  output: string
}

export interface VerifyRunOptions {
  /** Replaces the whole environment, so a test can withhold a tool from PATH. */
  env?: NodeJS.ProcessEnv
  args?: string[]
}

/**
 * Runs the verify.sh an unpacked Evidence Package ships, from the package
 * directory, under `/bin/sh`. Callers gate on HAS_OPENSSL and HAS_JQ.
 */
export function runVerifyScript(dir: string, { env, args = [] }: VerifyRunOptions = {}): VerifyRun {
  try {
    const stdout = execFileSync('/bin/sh', [PACKAGE_ROOT_FILES.verifyScript, ...args], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ?? process.env
    })
    return { status: 0, output: stdout }
  } catch (error) {
    const spawned = error as { status?: number; stdout?: string; stderr?: string }
    return { status: spawned.status ?? 1, output: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}` }
  }
}
