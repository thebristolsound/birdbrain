import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const SCRIPT = resolve(__dirname, '../scripts/install-tools.sh')

let home: string
let root: string
let bin: string

const tool = (name: string, body: string) => {
  const path = join(bin, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

const logOf = (name: string) => {
  const path = join(home, name)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

// The script runs from a checkout of its own, so the pins and the Google style are the test's.
// Stand-ins come first on PATH for every tool it runs, so a mise or curl in /usr/bin is shadowed.
const run = (args: string[], input = '') =>
  spawnSync('bash', [join(root, 'scripts/install-tools.sh'), ...args], {
    cwd: home,
    encoding: 'utf8',
    input,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      BIRDBRAIN_TOOLS_DIR: join(home, 'tools')
    }
  })

const MISE_SHIM = 'echo "mise ERROR No version is set for shim: pnpm" >&2; exit 1'
// A corepack pnpm shim whose pinned version is not cached: it needs the network to run.
const UNCACHED_SHIM = [
  '[ "$COREPACK_ENABLE_NETWORK" = 0 ] && exit 1',
  'touch "$HOME/downloaded"',
  'echo 10.28.2'
].join('\n')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'install-tools-'))
  root = join(home, 'checkout')
  bin = join(home, 'bin')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, '.vale/styles/Google'), { recursive: true })
  mkdirSync(bin)
  copyFileSync(SCRIPT, join(root, 'scripts/install-tools.sh'))
  writeFileSync(join(root, '.nvmrc'), '24\n')
  writeFileSync(join(root, '.mise.toml'), '[tools]\nvale = "3.24.0"\n')
  tool('node', 'echo v24.0.0')
  tool('vale', 'echo vale version v3.24.0')
  tool('mise', 'exit 1')
  tool('curl', 'exit 1')
  // `enable` writes a pnpm that runs, as corepack's does once `install` has cached the pin.
  tool(
    'corepack',
    [
      'echo "$*" >>"$HOME/corepack.log"',
      'if [ "$1" = enable ]; then',
      '  printf "#!/bin/sh\\necho 10.28.2\\n" >"$4/pnpm"',
      '  chmod +x "$4/pnpm"',
      'fi'
    ].join('\n')
  )
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('install-tools.sh pnpm check', () => {
  it('reports pnpm missing when the pnpm on PATH resolves but does not run', () => {
    tool('pnpm', MISE_SHIM)
    const { status, stderr } = run(['--no-install'])
    expect(stderr).toMatch(/missing: pnpm$/m)
    expect(status).toBe(1)
  })

  it('accepts a pnpm on PATH that runs', () => {
    tool('pnpm', 'echo 10.28.2')
    const { status, stderr } = run(['--no-install'])
    expect(stderr).not.toMatch(/missing:/)
    expect(status).toBe(0)
  })

  it('installs pnpm through corepack when the pnpm on PATH does not run', () => {
    tool('pnpm', MISE_SHIM)
    const { status, stderr } = run([])
    expect(stderr).not.toMatch(/missing:/)
    expect(status).toBe(0)
    expect(logOf('corepack.log')).toBe(`enable pnpm --install-directory ${bin}\ninstall\n`)
  })

  it('runs pnpm from the checkout root, with no stdin and no download question', () => {
    tool(
      'pnpm',
      [
        'echo "$(pwd) prompt=$COREPACK_ENABLE_DOWNLOAD_PROMPT" >>"$HOME/pnpm.log"',
        'if read -r answer; then echo "read $answer" >>"$HOME/pnpm.log"; fi',
        'echo 10.28.2'
      ].join('\n')
    )
    const { status } = run([], 'y\n')
    expect(status).toBe(0)
    // Once before the corepack step and once in the final check.
    expect(logOf('pnpm.log')).toBe(`${root} prompt=0\n`.repeat(2))
    expect(logOf('corepack.log')).toBe('')
  })

  it('does not let a check-only run download pnpm', () => {
    tool('pnpm', UNCACHED_SHIM)
    const { status, stderr } = run(['--no-install'])
    expect(stderr).toMatch(/missing: pnpm$/m)
    expect(status).toBe(1)
    expect(existsSync(join(home, 'downloaded'))).toBe(false)
  })

  it('leaves the download of an uncached pnpm to corepack install', () => {
    tool('pnpm', UNCACHED_SHIM)
    const { status } = run([])
    expect(status).toBe(0)
    expect(existsSync(join(home, 'downloaded'))).toBe(false)
    expect(logOf('corepack.log')).toBe(`enable pnpm --install-directory ${bin}\ninstall\n`)
  })
})
