import { execFileSync } from 'child_process'

// Same shape and the same purpose as helpers/openssl.ts: a suite whose whole job
// is executing the shipped VERIFY.md runbook (#584) cannot do that job without
// jq, so a silent skip there restores the exact hole the runbook execution
// closes — a runbook nobody ran.
//
// It differs from the openssl helper in where the requirement comes from.
// BIRDBRAIN_REQUIRE_OPENSSL=1 is set on the `test` job in ci.yml; this one
// defaults to required whenever CI is set (GitHub Actions sets CI=true), so the
// guarantee lives in the repository rather than in a workflow file. That is
// deliberate: the machine account's token carries no `workflow` scope, so an
// agent branch cannot land a `.github/workflows/**` edit, and a guard that only
// exists in a file agents cannot touch is a guard that will not be there when it
// is needed. Off CI it stays a graceful skip. BIRDBRAIN_REQUIRE_JQ=1 forces it
// on anywhere (pnpm preflight does), =0 forces it off.
export const jqIsRequired = (env: NodeJS.ProcessEnv): boolean => {
  const flag = env.BIRDBRAIN_REQUIRE_JQ
  return flag === '1' || (flag !== '0' && env.CI === 'true')
}

const REQUIRE_JQ = jqIsRequired(process.env)

function detectJq(): boolean {
  try {
    execFileSync('jq', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const detected = detectJq()

if (REQUIRE_JQ && !detected) {
  throw new Error(
    'jq is required here but the `jq` CLI is not available. The tests that execute the ' +
      'shipped VERIFY.md runbook against a real evidence package cannot run, which would ' +
      'leave the runbook unexecuted — the drift #584 exists to prevent. Install jq, or set ' +
      'BIRDBRAIN_REQUIRE_JQ=0 to accept a skip and the gap that comes with it.'
  )
}

/**
 * True when jq-dependent tests should run. Where jq is required the throw above
 * guarantees it exists; otherwise this reflects local availability so
 * `it.skipIf(!HAS_JQ)` skips gracefully.
 */
export const HAS_JQ = detected
