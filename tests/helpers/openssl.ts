import { execFileSync } from 'child_process'

// When set (e.g. on CI), the absence of openssl is a HARD FAILURE rather than a
// silent skip. This is the keystone of G2: the canonical `openssl ts -verify`
// proof must never turn green-but-skipped on a CI image that lacks openssl.
const REQUIRE_OPENSSL = process.env.BIRDBRAIN_REQUIRE_OPENSSL === '1'

function detectOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const detected = detectOpenssl()

if (REQUIRE_OPENSSL && !detected) {
  throw new Error(
    'BIRDBRAIN_REQUIRE_OPENSSL=1 but the `openssl` CLI is not available. ' +
      'The canonical RFC 3161 verification tests cannot run, which would silently ' +
      'skip the keystone court-admissibility proof. Install OpenSSL 3.x in this environment.'
  )
}

// True when openssl-dependent tests should run. With the require flag set this is
// always true (the throw above guarantees openssl exists); otherwise it reflects
// local availability so `it.skipIf(!HAS_OPENSSL)` skips gracefully off CI.
export const HAS_OPENSSL = detected
