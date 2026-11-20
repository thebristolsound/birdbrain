import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const SCRIPT = resolve(__dirname, '../scripts/install-tools.sh')

let home: string
let bin: string

const tool = (name: string, body: string) => {
  const path = join(bin, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

// Resolve only, with a PATH of stand-ins ahead of the system's, and no mise in reach.
const resolveTools = () =>
  spawnSync('bash', [SCRIPT, '--no-install'], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      BIRDBRAIN_TOOLS_DIR: join(home, 'tools')
    }
  })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'install-tools-'))
  bin = join(home, 'bin')
  mkdirSync(bin)
  tool('node', 'echo v24.0.0')
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('install-tools.sh pnpm resolution', () => {
  it('reports pnpm missing when the pnpm on PATH resolves but does not run', () => {
    tool('pnpm', 'echo "mise ERROR No version is set for shim: pnpm" >&2; exit 1')
    const { status, stderr } = resolveTools()
    expect(status).toBe(1)
    expect(stderr).toMatch(/missing: .*\bpnpm\b/)
  })

  it('accepts a pnpm on PATH that runs', () => {
    tool('pnpm', 'echo 10.28.2')
    const { stderr } = resolveTools()
    expect(stderr).not.toMatch(/missing: .*\bpnpm\b/)
  })
})
