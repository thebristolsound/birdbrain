// Deterministic JSON stringification following RFC 8785 (JCS): keys ordered by
// Unicode code point, all strings normalized to NFC, no whitespace. Produces
// stable bytes for hashing manifest entries across tools and platforms.
//
// Number serialization is intentionally left to JSON.stringify: the manifest
// body is integer-only by contract, so the ECMAScript Number formatting JCS
// mandates for non-integers does not apply. Adding any float/large-int field
// would require revisiting this.

// Compares two strings by Unicode code point rather than UTF-16 code unit, as
// JCS requires. Array.from iterates code points, so surrogate pairs (astral
// characters) compare by their true scalar value.
function compareByCodePoint(a: string, b: string): number {
  const ca = Array.from(a)
  const cb = Array.from(b)
  const len = Math.min(ca.length, cb.length)
  for (let i = 0; i < len; i += 1) {
    const da = ca[i].codePointAt(0) as number
    const db = cb[i].codePointAt(0) as number
    if (da !== db) return da - db
  }
  return ca.length - cb.length
}

export function canonicalStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'))
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (let i = 0; i < value.length; i += 1) {
      parts.push(i in value && value[i] !== undefined ? canonicalStringify(value[i]) : 'null')
    }
    return '[' + parts.join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const entries = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .map((k) => ({ key: k.normalize('NFC'), value: obj[k] }))
    .sort((a, b) => compareByCodePoint(a.key, b.key))
  const parts = entries.map((e) => JSON.stringify(e.key) + ':' + canonicalStringify(e.value))
  return '{' + parts.join(',') + '}'
}
