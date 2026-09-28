import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const LIB = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'redact.sh')

// Synthetic values, assembled at runtime so no credential-shaped literal sits in this file for
// the secret scan to flag. Each seed differs, so no two values share a body.
const fill = (length: number, seed: string) => seed.repeat(length).slice(0, length)

const CREDENTIALS = [
  { prefix: 'sk-ant-', value: `sk-ant-oat01-${fill(95, 'Qx7_Lm2-')}` },
  { prefix: 'ghp_', value: `ghp_${fill(36, 'Ab3')}` },
  { prefix: 'gho_', value: `gho_${fill(36, 'Cd4')}` },
  { prefix: 'ghs_', value: `ghs_${fill(36, 'Ef5')}` },
  // GitHub's stateless installation-token format, ghs_APPID_JWT: a JWT's three parts joined by dots
  {
    prefix: 'ghs_',
    value: `ghs_1234567_${fill(36, 'Mn9')}.${fill(120, 'Op0')}.${fill(43, 'Qr1')}`
  },
  { prefix: 'ghu_', value: `ghu_${fill(36, 'Gh6')}` },
  { prefix: 'github_pat_', value: `github_pat_${fill(22, 'Ij7')}_${fill(59, 'Kl8')}` }
]

// Sources the file in a fresh bash, as run.sh does, and pipes the input through the function.
const redact = (input: string) =>
  spawnSync('bash', ['-c', '. "$1" && redact', 'redact-test', LIB], { encoding: 'utf8', input })

describe('dispatch redact.sh', () => {
  it('keeps each of the six prefixes and replaces the rest of the value', () => {
    const line = (credential: string) => `API error: ${credential} was rejected\n`

    const { status, stdout, stderr } = redact(CREDENTIALS.map(({ value }) => line(value)).join(''))

    expect(status, stderr).toBe(0)
    for (const { value } of CREDENTIALS) expect(stdout).not.toContain(value)
    expect(stdout).toBe(CREDENTIALS.map(({ prefix }) => line(`${prefix}<REDACTED>`)).join(''))
  })

  it('redacts every value on a line, not only the first', () => {
    const { stdout } = redact(`${CREDENTIALS.map(({ value }) => value).join(' ')}\n`)

    expect(stdout).toBe(`${CREDENTIALS.map(({ prefix }) => `${prefix}<REDACTED>`).join(' ')}\n`)
  })

  it('leaves a dot that ends a sentence after a value', () => {
    const { stdout } = redact(`${CREDENTIALS.map(({ value }) => `Rejected ${value}.`).join(' ')}\n`)

    expect(stdout).toBe(
      `${CREDENTIALS.map(({ prefix }) => `Rejected ${prefix}<REDACTED>.`).join(' ')}\n`
    )
  })

  it('passes text that only names a prefix through unchanged', () => {
    const prose =
      'The prefixes are sk-ant- ghp_ gho_ ghs_ ghu_ and github_pat_; ghp_short is too short.\n'

    expect(redact(prose).stdout).toBe(prose)
  })

  it('defines redact and nothing else when sourced', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-redact-'))
    // Options, working directory, umask, IFS, traps, exported values, and function and variable
    // names, printed before and after the source with a '#' line between the three parts.
    const script = [
      'state() {',
      '  printf "%s\\n" "$SHELLOPTS" "$BASHOPTS" "$PWD" "$(umask)"',
      '  declare -p IFS; trap -p; export -p; compgen -A function; compgen -v',
      '}',
      'state; echo "#"; . "$1"; echo "#"; state'
    ].join('\n')
    try {
      const { status, stdout, stderr } = spawnSync('bash', ['-c', script, 'redact-test', LIB], {
        cwd,
        encoding: 'utf8',
        env: { PATH: process.env.PATH }
      })

      expect(status, stderr).toBe(0)
      expect(stderr).toBe('')
      const [before, sourced, after] = stdout.split('#\n')
      expect(sourced).toBe('')
      expect(after.split('\n')).toContain('redact')
      expect(after.split('\n').filter((line) => line !== 'redact')).toEqual(before.split('\n'))
      expect(readdirSync(cwd)).toEqual([])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
