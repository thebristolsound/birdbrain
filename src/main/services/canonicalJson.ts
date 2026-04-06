// Deterministic JSON stringification: keys sorted alphabetically, no whitespace.
// Used to produce stable input for hashing manifest entries.
export function canonicalStringify(value: unknown): string {
  if (value === undefined) return 'null'
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
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k]))
  return '{' + parts.join(',') + '}'
}
