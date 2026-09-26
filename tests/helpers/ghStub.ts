import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// A `gh` first on PATH that answers `gh api <endpoint>` from canned JSON, so a shell script
// that reads GitHub can be run end to end without the network. An endpoint absent from the
// routes, or routed to null, fails the way a failed API read does (exit 1), so a script call
// the test did not anticipate shows up as a failure rather than as silent empty output.
// `--jq` is applied with the real jq, as gh does; every call is logged for assertions.
const STUB = `#!/usr/bin/env node
const fs = require('fs')
const { execFileSync } = require('child_process')
const args = process.argv.slice(2)
fs.appendFileSync(__dirname + '/calls.log', args.join(' ') + '\\n')
const routes = JSON.parse(fs.readFileSync(__dirname + '/routes.json', 'utf8'))
let endpoint
let jq
if (args[0] === 'api') {
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a === '--jq' || a === '-q') jq = args[++i]
    else if (a === '-X' || a === '--method') i++
    else if (!a.startsWith('-') && endpoint === undefined) endpoint = a
  }
}
if (endpoint === undefined || routes[endpoint] == null) {
  process.stderr.write('gh stub: no route for gh ' + args.join(' ') + '\\n')
  process.exit(1)
}
const body = JSON.stringify(routes[endpoint])
process.stdout.write(jq ? execFileSync('jq', ['-r', '-c', jq], { input: body, encoding: 'utf8' }) : body + '\\n')
`

export type GhRoutes = Record<string, unknown>

export interface GhStub {
  dir: string
  path: string
  calls: () => string[]
  cleanup: () => void
}

export function makeGhStub(routes: GhRoutes): GhStub {
  const dir = mkdtempSync(join(tmpdir(), 'gh-stub-'))
  writeFileSync(join(dir, 'gh'), STUB)
  chmodSync(join(dir, 'gh'), 0o755)
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(routes))
  writeFileSync(join(dir, 'calls.log'), '')
  return {
    dir,
    path: `${dir}:${process.env.PATH ?? ''}`,
    calls: () => readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}
