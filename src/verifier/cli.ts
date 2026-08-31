// Standalone evidence-package verifier CLI (#122 §9). This is the entry point
// bundled by `scripts/build-verifier.mjs` into a single Node SEA binary.
//
// HARD CONSTRAINT: this file and everything it imports must stay fs+crypto only.
// Import ONLY from `@shared/verify/**` and `@shared/schemas` — NEVER from
// `src/main`, `electron`, `better-sqlite3`, `keytar`, `hono`, or any network
// code. The build script asserts the produced bundle contains none of these.
//
// Trust model (§3.4): a binary PASS is an INTEGRITY + INTERNAL-CONSISTENCY
// result, not an authenticity claim. Timestamp checks are STRUCTURAL ONLY
// (imprint + byte-binding); canonical TSA authenticity is the runbook's
// `openssl ts -verify` (VERIFY.md). So binary-PASS != runbook-PASS.

import { canonicalStringify } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import type { PackageVerifyResult } from '@shared/verify/evidencePackage'

// The frozen golden vector mirrored from
// tests/shared/verify/canonicalJson.test.ts. `--self-check` canonicalizes this
// and prints the bytes so a test can assert the BUNDLED core is byte-identical
// to the in-app core (proving the esbuild transform changed nothing).
const GOLDEN_BODY = {
  type: 'capture',
  url: 'https://example.com/page?q=a&b=c',
  captureId: '0196f7a2-aaaa-bbbb-cccc-000000000001',
  caseId: '0196f7a2-aaaa-bbbb-cccc-000000000002',
  timestamp: '2026-06-01T12:00:00.000Z',
  contentHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  sizeBytes: 123456,
  operatorId: 'op-1',
  operatorName: 'Casey Operator',
  toolVersion: '0.4.0',
  index: 3,
  prevHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  schemaVersion: 2
}

const GOLDEN_CANONICAL =
  '{"captureId":"0196f7a2-aaaa-bbbb-cccc-000000000001",' +
  '"caseId":"0196f7a2-aaaa-bbbb-cccc-000000000002",' +
  '"contentHash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",' +
  '"index":3,' +
  '"operatorId":"op-1",' +
  '"operatorName":"Casey Operator",' +
  '"prevHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",' +
  '"schemaVersion":2,' +
  '"sizeBytes":123456,' +
  '"timestamp":"2026-06-01T12:00:00.000Z",' +
  '"toolVersion":"0.4.0",' +
  '"type":"capture",' +
  '"url":"https://example.com/page?q=a&b=c"}'

const USAGE = `birdbrain-verify — standalone evidence-package verifier

Usage:
  birdbrain-verify <package-dir>   Verify an unzipped Birdbrain evidence package.
  birdbrain-verify --self-check    Print the canonical-JSON golden vector and
                                   assert the bundled core matches the in-app
                                   core byte-for-byte (exit 0/1).
  birdbrain-verify --help          Show this help.

A PASS means integrity + internal consistency: the signed manifest chain is
valid, every active capture's bytes bind to the chain, and every present
timestamp token's imprint + bytes match the signed entry. It is NOT a standalone
authenticity claim. Timestamp checks here are STRUCTURAL (imprint / byte-
binding) — run the documented \`openssl ts -verify\` (VERIFY.md) for canonical
TSA authenticity. So binary-PASS is not the same as runbook-PASS.

Exit codes: 0 = PASS, 1 = FAIL, 2 = not a verifiable object, 3 = verifier too
old. Exit 2 is a Birdbrain Working Copy — a deliberately non-evidentiary export
that self-identifies via WORKING-COPY.json and contains nothing to verify. Exit
3 means the package's manifest holds an entry written by a newer Birdbrain than
this verifier was built for, so this build cannot read the chain. Neither is a
PASS or a FAIL: no integrity claim is made either way.`

function runSelfCheck(): number {
  const actual = canonicalStringify(GOLDEN_BODY)
  process.stdout.write(actual + '\n')
  if (actual === GOLDEN_CANONICAL) {
    process.stderr.write(
      'self-check PASS: bundled canonical-JSON matches the frozen golden vector\n'
    )
    return 0
  }
  process.stderr.write(
    'self-check FAIL: bundled canonical-JSON does NOT match the frozen golden vector\n'
  )
  process.stderr.write(`  expected: ${GOLDEN_CANONICAL}\n`)
  process.stderr.write(`  actual:   ${actual}\n`)
  return 1
}

function printReport(dir: string, result: PackageVerifyResult): void {
  const symbol = (status: string): string =>
    status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'SKIP'
  process.stdout.write(`Birdbrain evidence-package verification\n`)
  process.stdout.write(`Package: ${dir}\n\n`)
  // Third outcome (#399): a self-identified Working Copy has nothing to
  // verify, so no checks ran and neither PASS nor FAIL would be honest.
  if (result.notVerifiable) {
    process.stdout.write(`RESULT: NOT A VERIFIABLE OBJECT — ${result.notVerifiable.reason}\n`)
    return
  }
  for (const check of result.checks) {
    const line = `  [${symbol(check.status)}] ${check.name}`
    process.stdout.write(check.reason ? `${line} — ${check.reason}\n` : `${line}\n`)
  }
  process.stdout.write('\n')
  // Fourth outcome (ADR-0023, X25): this verifier is older than the manifest it
  // was handed. Reporting FAIL here would accuse a package of tampering on the
  // strength of this binary's age, so the verdict names the real problem and
  // the remedy instead.
  if (result.unsupported) {
    process.stdout.write(`RESULT: VERIFIER TOO OLD — ${result.unsupported.reason}\n`)
    process.stdout.write(
      '\nThis is NOT a tamper verdict, and it is NOT a clean bill of health: this\n' +
        'build cannot read part of the manifest, so it makes no integrity claim\n' +
        'about the package either way. What it does say is narrower: the entries\n' +
        'below the unreadable one verified, and that entry sits where the chain\n' +
        'says it does with a hash and signature that hold. Obtain the verifier\n' +
        'from the Birdbrain release named in the package README (or later) and\n' +
        're-run.\n'
    )
    return
  }
  if (result.pass) {
    process.stdout.write('RESULT: PASS — integrity + internal consistency verified.\n')
  } else {
    process.stdout.write('RESULT: FAIL — one or more checks failed (see above).\n')
  }
  process.stdout.write(
    '\nNote: timestamp checks are STRUCTURAL (imprint / byte-binding) only. A PASS\n' +
      'is an integrity result, NOT a standalone authenticity claim. For canonical\n' +
      'TSA authenticity run the documented `openssl ts -verify` from VERIFY.md.\n' +
      'binary-PASS is not the same as runbook-PASS.\n'
  )
}

export function main(argv: string[]): number {
  const args = argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE + '\n')
    return args.length === 0 ? 1 : 0
  }

  if (args[0] === '--self-check') {
    return runSelfCheck()
  }

  const dir = args[0]
  let result: PackageVerifyResult
  try {
    result = verifyEvidencePackage(dir)
  } catch (err) {
    process.stderr.write(`error: could not verify package at ${dir}: ${(err as Error).message}\n`)
    return 1
  }
  printReport(dir, result)
  // 2, not 1, for a Working Copy: scripts must be able to distinguish
  // nothing-to-verify against failed-verification (#399).
  if (result.notVerifiable) return 2
  // 3, not 1, for a manifest this build is too old to read: a script that
  // treated it as FAIL would record a tamper result produced by the verifier's
  // age (X25).
  if (result.unsupported) return 3
  return result.pass ? 0 : 1
}

process.exit(main(process.argv))
