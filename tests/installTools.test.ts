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
let early: string
let bin: string
let shims: string

const tool = (name: string, body: string, dir = bin) => {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

const logOf = (name: string) => {
  const path = join(home, name)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

const marker = (name: string) => existsSync(join(home, name))

// The script runs from a checkout of its own, so the pins and the Google style are the test's.
// Stand-ins come first on PATH for every tool it runs, so a mise or curl in /usr/bin is shadowed.
// `bin` holds node, so it is the script's Node folder; `early` and `shims` stand for folders
// before and after it on PATH, and are empty unless a test puts a pnpm there.
const run = (args: string[], input = '') =>
  spawnSync('bash', [join(root, 'scripts/install-tools.sh'), ...args], {
    cwd: home,
    encoding: 'utf8',
    input,
    env: {
      PATH: `${early}:${bin}:${shims}:/usr/bin:/bin`,
      HOME: home,
      BIRDBRAIN_TOOLS_DIR: join(home, 'tools')
    }
  })

const MISE_SHIM = 'echo "mise ERROR No version is set for shim: pnpm" >&2; exit 1'
// A corepack pnpm shim: it runs once `corepack install` has cached the pin, and otherwise needs
// the network, which the `offline` marker takes away.
const COREPACK_SHIM = [
  '[ -e "$HOME/cached" ] && { echo 10.28.2; exit 0; }',
  '{ [ "$COREPACK_ENABLE_NETWORK" = 0 ] || [ -e "$HOME/offline" ]; } && exit 1',
  'touch "$HOME/downloaded"',
  'echo 10.28.2'
].join('\n')
// Standalone pnpm of another version than the pin: each switches to the pin, downloading it,
// unless the setting its major version reads turns the switch off.
const OTHER_PNPM = {
  'pnpm 10': [
    '[ "$npm_config_manage_package_manager_versions" = false ] || touch "$HOME/downloaded"',
    'echo 10.24.0'
  ].join('\n'),
  'pnpm 11': [
    '[ "$pnpm_config_pm_on_fail" = ignore ] || touch "$HOME/downloaded"',
    'echo 11.20.0'
  ].join('\n')
}
const ENABLE = (dir: string) => `enable pnpm --install-directory ${dir}`

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'install-tools-'))
  root = join(home, 'checkout')
  early = join(home, 'early')
  bin = join(home, 'bin')
  shims = join(home, 'shims')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, '.vale/styles/Google'), { recursive: true })
  for (const dir of [early, bin, shims]) mkdirSync(dir)
  copyFileSync(SCRIPT, join(root, 'scripts/install-tools.sh'))
  writeFileSync(join(root, '.nvmrc'), '24\n')
  writeFileSync(join(root, '.mise.toml'), '[tools]\nvale = "3.24.0"\n')
  writeFileSync(join(home, 'shim'), `#!/bin/sh\n${COREPACK_SHIM}\n`)
  tool('node', 'echo v24.0.0')
  tool('vale', 'echo vale version v3.24.0')
  tool('mise', 'exit 1')
  tool('curl', 'exit 1')
  // `enable` replaces whatever pnpm and pnpx are there, as corepack does with any entry that is
  // not its own link, and `install` caches the pin unless the host is offline.
  tool(
    'corepack',
    [
      'echo "$*" >>"$HOME/corepack.log"',
      'case "$1" in',
      '  enable)',
      '    for f in pnpm pnpx; do',
      '      rm -f "$4/$f"; cp "$HOME/shim" "$4/$f"; chmod +x "$4/$f"',
      '    done ;;',
      '  install) [ -e "$HOME/offline" ] && exit 1; touch "$HOME/cached" ;;',
      'esac'
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
    tool('pnpm', MISE_SHIM, shims)
    const { status, stderr } = run([])
    expect(stderr).not.toMatch(/missing:/)
    expect(status).toBe(0)
    expect(logOf('corepack.log')).toBe(`install\n${ENABLE(bin)}\n`)
  })

  it('puts the Node folder first when a pnpm that fails comes before it on PATH', () => {
    tool('pnpm', MISE_SHIM, early)
    const { status, stdout } = run([])
    expect(status).toBe(0)
    expect(stdout.trim().split(':')).toContain(bin)
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

  it('does not let a check-only run download pnpm through corepack', () => {
    tool('pnpm', COREPACK_SHIM)
    const { status, stderr } = run(['--no-install'])
    expect(stderr).toMatch(/missing: pnpm$/m)
    expect(status).toBe(1)
    expect(marker('downloaded')).toBe(false)
  })

  for (const [version, body] of Object.entries(OTHER_PNPM)) {
    it(`keeps a ${version} of another version from switching to the pin`, () => {
      tool('pnpm', body)
      for (const args of [['--no-install'], []]) {
        const { status } = run(args)
        expect(status).toBe(0)
        expect(marker('downloaded')).toBe(false)
      }
    })
  }

  it('leaves the download of an uncached pnpm to corepack install', () => {
    tool('pnpm', COREPACK_SHIM)
    const { status } = run([])
    expect(status).toBe(0)
    expect(marker('downloaded')).toBe(false)
    expect(logOf('corepack.log')).toBe(`install\n${ENABLE(bin)}\n`)
  })

  it('lets the final check fetch the pin when the corepack step cannot run', () => {
    rmSync(join(bin, 'corepack'))
    tool('pnpm', COREPACK_SHIM)
    const { status } = run([])
    expect(status).toBe(0)
    expect(marker('downloaded')).toBe(true)
  })

  it('leaves the pnpm and pnpx already there untouched when corepack install fails', () => {
    tool('pnpm', `# their own pnpm\n${COREPACK_SHIM}`)
    tool('pnpx', `# their own pnpx\n${COREPACK_SHIM}`)
    const before = ['pnpm', 'pnpx'].map((f) => readFileSync(join(bin, f), 'utf8'))
    writeFileSync(join(home, 'offline'), '')
    const { status, stderr } = run([])
    expect(stderr).toMatch(/corepack could not provide pnpm/)
    expect(stderr).toMatch(/missing: pnpm$/m)
    expect(status).toBe(1)
    expect(logOf('corepack.log')).toBe('install\n')
    expect(['pnpm', 'pnpx'].map((f) => readFileSync(join(bin, f), 'utf8'))).toEqual(before)
  })

  it('writes no shims when corepack install fails', () => {
    tool('pnpm', MISE_SHIM, shims)
    writeFileSync(join(home, 'offline'), '')
    const { status, stderr } = run([])
    expect(stderr).toMatch(/corepack could not provide pnpm/)
    expect(status).toBe(1)
    expect(logOf('corepack.log')).toBe('install\n')
    expect(existsSync(join(bin, 'pnpm'))).toBe(false)
    expect(existsSync(join(bin, 'pnpx'))).toBe(false)
  })
})
