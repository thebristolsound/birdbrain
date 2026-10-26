import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'

const ROOT = resolve(__dirname, '..')
const LOGO = 'src/renderer/assets/logo.png'

interface Sources {
  css: string
  fonts: { src: string }[]
  fontLicense?: string
  assets: Record<string, { files: { src: string }[] }>
}

// A throwaway repository holding the producer and only the files sources.json names, so a
// test can change a source without touching the checkout.
function copyProducer(to: string): void {
  cpSync(join(ROOT, 'design-system'), join(to, 'design-system'), {
    recursive: true,
    filter: (src) => !src.startsWith(join(ROOT, 'design-system', 'dist'))
  })
  const sources = JSON.parse(
    readFileSync(join(ROOT, 'design-system', 'sources.json'), 'utf8')
  ) as Sources
  const files = [
    sources.css,
    ...sources.fonts.map(({ src }) => src),
    ...(sources.fontLicense ? [sources.fontLicense] : []),
    ...Object.values(sources.assets).flatMap(({ files }) => files.map(({ src }) => src))
  ]
  for (const file of files) {
    mkdirSync(dirname(join(to, file)), { recursive: true })
    cpSync(join(ROOT, file), join(to, file))
  }
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: to,
      stdio: 'ignore'
    })
  }
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'fixture')
}

function check(
  repo: string,
  env: NodeJS.ProcessEnv = process.env
): { status: number | null; stdout: string } {
  const { status, stdout } = spawnSync(
    process.execPath,
    [join(repo, 'design-system', 'build.mjs'), '--check', '--by', 'test'],
    { cwd: repo, encoding: 'utf8', env }
  )
  return { status, stdout }
}

describe('design-system/build.mjs --check', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'design-system-'))
    copyProducer(repo)
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('passes on the sources as committed', () => {
    const { status, stdout } = check(repo)
    expect(stdout).toContain('no findings')
    expect(status).toBe(0)
  })

  it('fails when a logo changes but keeps its size', () => {
    const logo = join(repo, LOGO)
    const bytes = readFileSync(logo)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(logo, bytes)

    const { status, stdout } = check(repo)
    // The full digest, since that is what the guide says to copy into sources.json.
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(stdout).toContain(`${LOGO} has changed since it was uploaded (sha256 ${digest},`)
    expect(status).toBe(1)
  })

  it('names the branch under review on a detached checkout, else only the commit', () => {
    execFileSync('git', ['checkout', '-q', '--detach'], { cwd: repo })
    const env = { ...process.env }
    delete env.GITHUB_HEAD_REF
    delete env.GITHUB_REF_NAME

    expect(check(repo, { ...env, GITHUB_HEAD_REF: 'feature/x' }).stdout).toMatch(
      /^design-system: feature\/x@[0-9a-f]+ /
    )
    expect(check(repo, env).stdout).toMatch(/^design-system: [0-9a-f]+ /)
  })

  it('empties the output folder before writing it', () => {
    const stale = join(repo, 'design-system', 'dist', 'project', 'components', 'Gone', 'README.md')
    mkdirSync(dirname(stale), { recursive: true })
    writeFileSync(stale, 'removed component')

    check(repo)
    expect(() => readFileSync(stale)).toThrow()
  })
})
