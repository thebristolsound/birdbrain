// `pnpm dev:seed`: starts the development app on a new throwaway profile that already holds an
// ordinary Case with Captures, Notes, Tags and a Selector, and a two-member Shared Case, so the
// captures workflow can be seen without Chrome, the extension or a live page.
//
// Three steps: prepareProfile (dev-seed/profile.mjs) writes what startup needs to clear its
// operator-name and signing-key gates, seedProfile (dev-seed/launch.mjs) fills the profile, and
// `electron-vite dev` starts against it, opening on the ordinary Case the seed writes last.
//
// The directory is left in place when the app exits, under the system temp directory. Like any
// copy of the app, the dev app binds 127.0.0.1:19845, so quit a running Birdbrain first (#513).

import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareProfile } from './dev-seed/profile.mjs'
import { devLaunch, OPERATOR_NAME, seedProfile } from './dev-seed/launch.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'birdbrain-dev-seed-'))
  console.log(`[dev:seed] profile ${dir}`)
  await prepareProfile(dir, { operatorName: OPERATOR_NAME, completedOnboarding: true })
  await seedProfile(ROOT, dir)
  const { command, args, env } = devLaunch(ROOT, dir)
  const child = spawn(command, args, { cwd: ROOT, env, stdio: 'inherit' })
  child.on('exit', (code, signal) => {
    console.log(`[dev:seed] app exited; the profile is still at ${dir}`)
    process.exit(code ?? (signal ? 1 : 0))
  })
}

main().catch((err) => {
  console.error(`[dev:seed] FAILED: ${err.message}`)
  process.exit(1)
})
