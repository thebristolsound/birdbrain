// Deterministic JSON stringification for hashing manifest entries: object keys
// sorted (JS default, i.e. UTF-16 code-unit order), undefined properties
// dropped, no whitespace, primitives via JSON.stringify.
//
// This is JCS-shaped (RFC 8785) but intentionally NOT a conformant JCS
// implementation. It deliberately does not Unicode-normalize strings — RFC 8785
// §3.1 also forbids altering string data, and forensically we must hash exactly
// what was captured — and it does not implement JCS number serialization.
// Determinism instead rests on two manifest invariants (guarded by tests):
//   - entry keys are fixed ASCII schema names, so JS code-unit sort, Unicode
//     code-point sort, and the runbook's `jq -cS` codepoint key sort are all
//     byte-identical, and
//   - entry values are integers, so JSON.stringify and `jq -c` emit the same
//     minimal form.
// The canonical, court-facing verification is the runbook recipe (`jq -cS` +
// sha256 + `openssl ts -verify`), not an off-the-shelf JCS library. Introducing
// a non-ASCII key or a non-integer field to a manifest body would break these
// invariants and must revisit this function and the runbook together.
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
