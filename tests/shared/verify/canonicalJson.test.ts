import { describe, it, expect } from 'vitest'
import { canonicalStringify } from '@shared/verify'

describe('canonicalStringify', () => {
  it('sorts object keys alphabetically', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('produces identical output regardless of insertion order', () => {
    const a = canonicalStringify({ b: 1, a: 2, c: 3 })
    const b = canonicalStringify({ c: 3, a: 2, b: 1 })
    expect(a).toBe(b)
  })

  it('handles nested objects deterministically', () => {
    expect(canonicalStringify({ y: { d: 1, c: 2 }, x: 1 })).toBe('{"x":1,"y":{"c":2,"d":1}}')
  })

  it('handles arrays preserving order', () => {
    expect(canonicalStringify({ items: [3, 1, 2] })).toBe('{"items":[3,1,2]}')
  })

  it('emits valid JSON for primitives', () => {
    expect(canonicalStringify('hi')).toBe('"hi"')
    expect(canonicalStringify(42)).toBe('42')
    expect(canonicalStringify(null)).toBe('null')
    expect(canonicalStringify(true)).toBe('true')
  })

  it('contains no whitespace', () => {
    const out = canonicalStringify({ a: 1, b: { c: 2 } })
    expect(out).not.toMatch(/\s/)
  })
})

// RFC 8785 / JCS conformance (G1): canonical output must order keys by Unicode
// code point (not UTF-16 code unit) and normalize all strings to NFC, so the
// same semantic content always produces identical bytes across tools/platforms.
describe('canonicalStringify RFC 8785/JCS conformance', () => {
  it('orders keys by Unicode code point, not UTF-16 code unit', () => {
    // U+1F600 (astral, surrogate pair 0xD83D 0xDE00) vs U+FF00 (BMP). By code
    // point 0xFF00 < 0x1F600, so "＀" sorts before the emoji. JS default
    // .sort() compares UTF-16 units and would place the high surrogate 0xD83D
    // before 0xFF00, giving the wrong order.
    const obj: Record<string, number> = { '\u{1F600}': 1, '＀': 2 }
    expect(canonicalStringify(obj)).toBe('{"＀":2,"\u{1F600}":1}')
  })

  it('normalizes string values to NFC (NFD input equals NFC input)', () => {
    const nfd = 'José' // J o s e + combining acute
    const nfc = 'José' // J o s é (precomposed)
    expect(nfd.normalize('NFC')).toBe(nfc) // sanity: they are the same under NFC
    expect(canonicalStringify({ operatorName: nfd })).toBe(
      canonicalStringify({ operatorName: nfc })
    )
    expect(canonicalStringify({ operatorName: nfd })).toBe(`{"operatorName":${JSON.stringify(nfc)}}`)
  })

  it('normalizes object keys to NFC', () => {
    const nfdKey = 'café' // café decomposed
    const nfcKey = 'café'
    expect(canonicalStringify({ [nfdKey]: 1 })).toBe(canonicalStringify({ [nfcKey]: 1 }))
    expect(canonicalStringify({ [nfdKey]: 1 })).toBe(`{${JSON.stringify(nfcKey)}:1}`)
  })

  it('NFC-normalizes keys before ordering them', () => {
    // Decomposed "é" (e + U+0301) must sort by its NFC form U+00E9, not by the
    // base ASCII 'e' of the decomposed sequence. "z" (U+007A) vs "é" (U+00E9):
    // after NFC, é (0xE9) sorts after z (0x7A).
    const out = canonicalStringify({ z: 1, ['é']: 2 })
    expect(out).toBe('{"z":1,"é":2}')
  })
})

// Golden vector (#122 PR1 guard): the exact canonical bytes for a
// representative manifest capture-entry body, frozen as a literal. Every
// entryHash in every signed manifest is sha256 over output like this — if this
// test ever fails, the change breaks verification of all previously signed
// manifests and must not ship. PR2's standalone binary re-runs this same
// vector via `--self-check` to prove the bundled core is byte-identical.
describe('canonicalStringify golden vector', () => {
  const GOLDEN_BODY = {
    // Deliberately listed in non-canonical order to exercise the sort.
    type: 'capture',
    url: 'https://example.com/page?q=a&b=c',
    captureId: '0196f7a2-aaaa-bbbb-cccc-000000000001',
    caseId: '0196f7a2-aaaa-bbbb-cccc-000000000002',
    timestamp: '2026-06-01T12:00:00.000Z',
    contentHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    sizeBytes: 123456,
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0',
    index: 3,
    prevHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    schemaVersion: 2
  }

  const GOLDEN_CANONICAL =
    '{"captureId":"0196f7a2-aaaa-bbbb-cccc-000000000001",' +
    '"caseId":"0196f7a2-aaaa-bbbb-cccc-000000000002",' +
    '"contentHash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",' +
    '"index":3,' +
    '"operatorId":"op-1",' +
    '"operatorName":"Casey Operator",' +
    '"prevHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",' +
    '"schemaVersion":2,' +
    '"sizeBytes":123456,' +
    '"timestamp":"2026-06-01T12:00:00.000Z",' +
    '"toolVersion":"0.4.0",' +
    '"type":"capture",' +
    '"url":"https://example.com/page?q=a&b=c"}'

  it('produces the frozen canonical bytes for the representative entry body', () => {
    expect(canonicalStringify(GOLDEN_BODY)).toBe(GOLDEN_CANONICAL)
  })

  it('drops undefined properties without disturbing the frozen bytes', () => {
    expect(canonicalStringify({ ...GOLDEN_BODY, screenshotHash: undefined })).toBe(GOLDEN_CANONICAL)
  })
})
