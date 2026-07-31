import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { QUERY_DOMAINS } from '@main/services/logSafe'

const RENDERER_DIR = join(__dirname, '..', '..', '..', 'src', 'renderer')

// The first segment of a React Query key, in both forms the renderer uses:
// the queryKeys factory in lib/queries.ts (`foo: ['foo'] as const`) and inline
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

function domainsInSource(): Set<string> {
  const found = new Set<string>()
  for (const file of sourceFiles(RENDERER_DIR)) {
    const src = readFileSync(file, 'utf8')
    const patterns = file.endsWith(join('lib', 'queries.ts')) ? [FACTORY_KEY, INLINE_KEY] : [INLINE_KEY]
    for (const pattern of patterns) {
      for (const match of src.matchAll(pattern)) found.add(match[1])
    }
  }
  return found
}

describe('query domain allowlist', () => {
  // queryClient forwards queryKey[0] as the `domain` context value on a
  // query.failed entry. logSafe validates it against a closed vocabulary, so a
  // domain missing from that list is dropped — and `domain` is the only field
  // naming which subsystem failed. This guard exists because the list was first
  // derived from queries.ts alone and silently missed the three domains
  // declared inline in components.
  it('covers every query key used in the renderer', () => {
    const uncovered = [...domainsInSource()]
      .filter((d) => !(QUERY_DOMAINS as readonly string[]).includes(d))
      .sort()

    expect(uncovered).toEqual([])
  })
})
