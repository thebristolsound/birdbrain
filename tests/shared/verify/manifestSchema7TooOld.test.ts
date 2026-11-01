import { describe, it, expect, vi, beforeAll } from 'vitest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { buildSignedChain } from '../../helpers/egressPackage'
import { ENGINE_INVENTORY } from '../../helpers/captureEnginePackage'
import {
  LAUNCHED_CAPTURE_BODY,
  PASSIVE_CAPTURE_BODY,
  PERSONA_EXHIBIT_BODY,
  PERSONA_FIELDS,
  SCHEMA_2_CAPTURE_BODY,
  SCHEMA_6_ENGINE_BODY
} from '../../helpers/launchedBrowser'

// A schema-6 verifier meeting an entry that carries a schema-7 value: a
// launched method, the browser or passive rule fields, a stage-2 inventory
// value, or the Persona fields (ADR-0023 X25, ADR-0030 as amended on
// 2026-10-31). This file pins the read ceiling back to 6, the release before
// this one, and hands it a chain whose second entry carries the value under
// the stamp the writer gives it: the answer must be "verifier too old", never
// a broken chain. Its own file because the mock is module-wide; the re-import
// mirrors manifestSchema6TooOld.test.ts.
vi.mock('@shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/constants')>()
  return { ...actual, MANIFEST_SCHEMA_VERSION: 6 }
})

let verifyManifestChainText: typeof import('@shared/verify').verifyManifestChainText
let MANIFEST_SCHEMA_VERSION: number

beforeAll(async () => {
  vi.resetModules()
  ;({ verifyManifestChainText } = await import('@shared/verify'))
  ;({ MANIFEST_SCHEMA_VERSION } = await import('@shared/constants'))
})

function verify(lines: string[]) {
  return verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })
}

const tooOld = (entryType: string) => ({
  index: 1,
  entryType,
  schemaVersionSeen: 7,
  supportedSchemaVersion: 6
})

describe('a schema-6 verifier against entries carrying schema-7 values', () => {
  it('runs with the read ceiling pinned to 6', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(6)
  })

  it('verifies the chain up to the entry without them, a schema-6 entry included', () => {
    expect(verify(buildSignedChain([SCHEMA_2_CAPTURE_BODY, SCHEMA_6_ENGINE_BODY])).valid).toBe(true)
  })

  const entries: Array<[string, Record<string, unknown>]> = [
    ['the frozen launched entry', LAUNCHED_CAPTURE_BODY],
    ['the frozen launched-passive entry', PASSIVE_CAPTURE_BODY],
    [
      'a capture entry whose only new value is its method',
      { ...SCHEMA_2_CAPTURE_BODY, method: 'launched', schemaVersion: 7 }
    ],
    [
      'a capture entry whose only new value is an inventory reason',
      {
        ...SCHEMA_2_CAPTURE_BODY,
        inventory: {
          ...ENGINE_INVENTORY,
          transactionRecord: { present: false, reason: 'back-forward-cache' },
          pdf: { present: false, reason: 'not-taken' }
        },
        schemaVersion: 7
      }
    ],
    [
      'a capture entry whose only new fields are the Persona fields',
      { ...SCHEMA_2_CAPTURE_BODY, ...PERSONA_FIELDS, schemaVersion: 7 }
    ]
  ]

  for (const [label, body] of entries) {
    it(`reports ${label} as verifier too old, not as a broken chain`, () => {
      const result = verify(buildSignedChain([SCHEMA_2_CAPTURE_BODY, body]))
      expect(result.valid).toBe(false)
      expect(result.brokenAt).toBeUndefined()
      expect(result.unsupported).toEqual(tooOld('capture'))
      expect(result.reason).toContain('verifier too old')
      expect(result.reason).toContain('supports up to schema version 6')
    })
  }

  it('reports an exhibit entry carrying the Persona fields the same way', () => {
    const result = verify(buildSignedChain([SCHEMA_2_CAPTURE_BODY, PERSONA_EXHIBIT_BODY]))
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported).toEqual(tooOld('exhibit'))
  })

  it('still reports such an entry that fails its signature as tampering', () => {
    const lines = buildSignedChain([SCHEMA_2_CAPTURE_BODY, LAUNCHED_CAPTURE_BODY])
    const edited = JSON.parse(lines[1]) as Record<string, unknown>
    edited.signature = 'not-a-signature'
    const result = verify([lines[0], JSON.stringify(edited)])
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Invalid signature')
  })
})
