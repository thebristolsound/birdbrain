import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// Guard (#122 §9, §13): the standalone verifier CLI must stay fs+crypto only so
// the SEA binary never drags in Electron / the main process / native deps. It
// may import ONLY from @shared/verify/** and @shared/schemas. This is the
// static counterpart to the build script's bundle-content assertion.

const ROOT = join(__dirname, '..', '..')
const VERIFIER_DIR = join(ROOT, 'src', 'verifier')

const FORBIDDEN = ['electron', 'better-sqlite3', 'keytar', 'hono']
const ALLOWED_PREFIXES = ['@shared/verify', '@shared/schemas']

function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const pattern = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    specs.push(match[1])
  }
  return specs
}

function isNodeBuiltin(spec: string): boolean {
  return spec.startsWith('node:') || ['fs', 'crypto', 'path', 'os', 'stream'].includes(spec)
}

describe('verifier CLI import hygiene', () => {
  it('src/verifier imports only from @shared/verify, @shared/schemas, or node builtins', () => {
    const files = readdirSync(VERIFIER_DIR).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const specs = importSpecifiers(readFileSync(join(VERIFIER_DIR, file), 'utf-8'))
      for (const spec of specs) {
        expect(FORBIDDEN, `${file} imports forbidden module "${spec}"`).not.toContain(spec)
        expect(spec.includes('src/main'), `${file} imports main-process module "${spec}"`).toBe(
          false
        )
        expect(spec.startsWith('@main/'), `${file} imports main-process module "${spec}"`).toBe(
          false
        )
        if (isNodeBuiltin(spec) || spec.startsWith('.')) continue
        const allowed = ALLOWED_PREFIXES.some((p) => spec === p || spec.startsWith(p))
        expect(allowed, `${file} imports disallowed module "${spec}"`).toBe(true)
      }
    }
  })
})
