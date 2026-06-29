import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// PR1 guard (#122 §13): the verify-core must stay process-agnostic so the
// standalone verifier binary can bundle it. Anything under src/shared/verify
// that imports electron / src/main / native deps would drag the Electron
// runtime into the bundle; any renderer import of the core would drag Node
// crypto/fs into the browser bundle. Both directions are pinned here.

const ROOT = join(__dirname, '..', '..', '..')
const VERIFY_DIR = join(ROOT, 'src', 'shared', 'verify')
const RENDERER_DIR = join(ROOT, 'src', 'renderer')

const FORBIDDEN_IN_CORE = ['electron', 'better-sqlite3', 'keytar', 'hono']

function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const pattern = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    specs.push(match[1])
  }
  return specs
}

describe('verify-core import hygiene', () => {
  it('src/shared/verify imports no electron/main-process/native modules', () => {
    const files = readdirSync(VERIFY_DIR).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const specs = importSpecifiers(readFileSync(join(VERIFY_DIR, file), 'utf-8'))
      for (const spec of specs) {
        expect(FORBIDDEN_IN_CORE, `${file} imports forbidden module "${spec}"`).not.toContain(spec)
        expect(spec.startsWith('@main/'), `${file} imports main-process module "${spec}"`).toBe(
          false
        )
        expect(spec.includes('src/main'), `${file} imports main-process module "${spec}"`).toBe(
          false
        )
      }
    }
  })

  it('no renderer module imports the verify-core', () => {
    const entries = readdirSync(RENDERER_DIR, { recursive: true }) as string[]
    const offenders: string[] = []
    for (const entry of entries) {
      if (!/\.(ts|tsx)$/.test(entry)) continue
      const source = readFileSync(join(RENDERER_DIR, entry), 'utf-8')
      if (source.includes('@shared/verify')) offenders.push(entry)
    }
    expect(offenders).toEqual([])
  })
})
