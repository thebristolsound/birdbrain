// The entry launch.mjs bundles: seeds the profile directory named on the command line.

import { seedProfile } from './seed'

seedProfile(process.argv[2]).then(
  ({ caseId, sharedCaseId }) => {
    process.stdout.write(`[dev:seed] seeded case ${caseId} and shared case ${sharedCaseId}\n`)
  },
  (err: unknown) => {
    process.stderr.write(`[dev:seed] FAILED: ${err instanceof Error ? err.stack : String(err)}\n`)
    process.exit(1)
  }
)
