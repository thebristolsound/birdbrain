// Deterministic JSON stringification: keys sorted alphabetically, no whitespace.
// Used to produce stable input for hashing manifest entries.
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k]))
  return '{' + parts.join(',') + '}'
}
