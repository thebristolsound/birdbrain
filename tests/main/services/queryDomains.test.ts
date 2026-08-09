import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { QUERY_DOMAINS } from '@main/services/logSafe'

const RENDERER_DIR = join(__dirname, '..', '..', '..', 'src', 'renderer')

// The first segment of a React Query key, in both forms the renderer uses:
// the queryKeys factory in lib/api/keys.ts (`foo: ['foo'] as const`) and inline
// declarations in components (`queryKey: ['foo', id]`).
const FACTORY_KEY = /\[\s*'([a-zA-Z]+)'/g
const INLINE_KEY = /queryKey:\s*\[\s*'([a-zA-Z]+)'/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(full) ? [full] : []
  })
}

const FACTORY_FILE = join('lib', 'api', 'keys.ts')

function domainsInSource(): { found: Set<string>; sawFactory: boolean } {
  const found = new Set<string>()
  let sawFactory = false
  for (const file of sourceFiles(RENDERER_DIR)) {
    const src = readFileSync(file, 'utf8')
    const isFactory = file.endsWith(FACTORY_FILE)
    if (isFactory) sawFactory = true
    for (const pattern of isFactory ? [FACTORY_KEY, INLINE_KEY] : [INLINE_KEY]) {
      for (const match of src.matchAll(pattern)) found.add(match[1])
    }
  }
  return { found, sawFactory }
}

describe('query domain allowlist', () => {
  // The factory path is hardcoded above, so moving keys.ts would otherwise
  // leave this guard scanning only the inline declarations and still passing.
  it('scans the queryKeys factory', () => {
    expect(domainsInSource().sawFactory).toBe(true)
  })

  // queryClient forwards queryKey[0] as the `domain` context value on a
  // query.failed entry. logSafe validates it against a closed vocabulary, so a
  // domain missing from that list is dropped — and `domain` is the only field
  // naming which subsystem failed. This guard exists because the list was first
  // derived from queries.ts alone and silently missed the three domains
  // declared inline in components.
  it('covers every query key used in the renderer', () => {
    const uncovered = [...domainsInSource().found]
      .filter((d) => !(QUERY_DOMAINS as readonly string[]).includes(d))
      .sort()

    expect(uncovered).toEqual([])
  })
})
